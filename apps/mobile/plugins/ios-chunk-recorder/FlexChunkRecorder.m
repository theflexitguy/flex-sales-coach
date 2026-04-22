// FlexChunkRecorder — native AVAudioRecorder lifecycle + chunk rotation.
//
// WHY THIS EXISTS:
// The JS-driven ChunkManager relied on a setInterval timer to rotate
// chunks every N minutes. iOS throttles JS timers aggressively when the
// app is backgrounded — enough that a 4-hour multi-door recording can
// end up as a single monster chunk (or nothing at all). The JS
// setInterval might fire once every few minutes instead of every
// CHUNK_DURATION_MS.
//
// This module owns the recording lifecycle natively:
//   1. AVAudioRecorder configured for AAC at the same settings as the
//      old expo-audio path.
//   2. DispatchSourceTimer on a serial GCD queue for rotation. That
//      timer is a native OS primitive and fires reliably regardless
//      of JavaScript runtime state.
//   3. AVAudioSession interruption observer — finalizes the paused
//      chunk and starts a fresh one when the phone call / Siri ends.
//   4. Emits `chunkFinalized` to JS so the upload queue can kick off
//      each chunk's upload as soon as it lands on disk.
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <AVFoundation/AVFoundation.h>

extern void RCTRegisterModule(Class);

static NSString *const kEventChunkFinalized = @"chunkFinalized";
static NSString *const kEventRecorderStatus = @"recorderStatus";
static NSString *const kEventRecorderError = @"recorderError";

@interface FlexChunkRecorder : RCTEventEmitter <AVAudioRecorderDelegate>
@property(nonatomic, strong, nullable) AVAudioRecorder *recorder;
@property(nonatomic, strong, nullable) dispatch_source_t rotateTimer;
@property(nonatomic, strong, nullable) NSString *sessionId;
@property(nonatomic, assign) NSInteger chunkIndex;
@property(nonatomic, assign) NSTimeInterval chunkStartedAt;
@property(nonatomic, assign) NSTimeInterval chunkDurationSeconds;
@property(nonatomic, assign) BOOL hasListeners;
// Monotonic rotation counter surfaced through recorderStatus events.
// Lets us tell from the Diagnostics ring buffer "rotation fired 12
// times but only 2 chunks landed" vs "rotation stopped firing at 2".
@property(nonatomic, assign) NSInteger rotationAttemptCount;
@property(nonatomic, assign) NSInteger rotationSuccessCount;
@end

@implementation FlexChunkRecorder

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

- (instancetype)init {
  if ((self = [super init])) {
    _chunkIndex = 0;
    NSNotificationCenter *nc = [NSNotificationCenter defaultCenter];
    [nc addObserver:self
           selector:@selector(handleInterruption:)
               name:AVAudioSessionInterruptionNotification
             object:nil];
    [nc addObserver:self
           selector:@selector(handleMediaServicesReset:)
               name:AVAudioSessionMediaServicesWereResetNotification
             object:nil];
  }
  return self;
}

- (void)dealloc {
  [[NSNotificationCenter defaultCenter] removeObserver:self];
}

- (NSArray<NSString *> *)supportedEvents {
  return @[
    kEventChunkFinalized,
    kEventRecorderStatus,
    kEventRecorderError,
  ];
}

- (void)startObserving {
  _hasListeners = YES;
}

- (void)stopObserving {
  _hasListeners = NO;
}

#pragma mark - Storage layout

- (NSString *)chunksRootDir {
  NSArray *paths = NSSearchPathForDirectoriesInDomains(
      NSDocumentDirectory, NSUserDomainMask, YES);
  NSString *root = [paths.firstObject stringByAppendingPathComponent:@"flex-chunks"];
  [[NSFileManager defaultManager] createDirectoryAtPath:root
                            withIntermediateDirectories:YES
                                             attributes:nil
                                                  error:nil];
  return root;
}

- (NSString *)chunkPathForSession:(NSString *)sessionId
                            index:(NSInteger)index {
  NSString *sessionDir =
      [[self chunksRootDir] stringByAppendingPathComponent:sessionId];
  [[NSFileManager defaultManager] createDirectoryAtPath:sessionDir
                            withIntermediateDirectories:YES
                                             attributes:nil
                                                  error:nil];
  return [sessionDir
      stringByAppendingPathComponent:[NSString
                                         stringWithFormat:@"%ld.m4a",
                                                          (long)index]];
}

#pragma mark - Session / recorder

- (BOOL)configureAudioSessionWithError:(NSError **)error {
  AVAudioSession *session = [AVAudioSession sharedInstance];
  AVAudioSessionCategoryOptions options =
      AVAudioSessionCategoryOptionMixWithOthers |
      AVAudioSessionCategoryOptionAllowBluetooth |
      AVAudioSessionCategoryOptionDefaultToSpeaker;
  if (![session setCategory:AVAudioSessionCategoryPlayAndRecord
                withOptions:options
                      error:error]) {
    return NO;
  }
  return [session setActive:YES error:error];
}

- (AVAudioRecorder *)buildRecorderAtPath:(NSString *)path
                                   error:(NSError **)error {
  NSURL *url = [NSURL fileURLWithPath:path];
  NSDictionary *settings = @{
    AVFormatIDKey : @(kAudioFormatMPEG4AAC),
    AVSampleRateKey : @44100.0,
    AVNumberOfChannelsKey : @1,
    AVEncoderBitRateKey : @64000,
    AVEncoderAudioQualityKey : @(AVAudioQualityMedium),
  };
  AVAudioRecorder *recorder =
      [[AVAudioRecorder alloc] initWithURL:url settings:settings error:error];
  recorder.meteringEnabled = YES;
  return recorder;
}

/**
 * Initial-chunk bring-up only. For rotation (chunk N → N+1) we use the
 * seamless path below that overlaps old + new recorders. Starting
 * chunk 0 is the one case where there's no "old" recorder to overlap
 * with, so a plain start is fine here.
 */
- (BOOL)startFirstChunkWithError:(NSError **)error {
  NSError *sessionErr = nil;
  if (![[AVAudioSession sharedInstance] setActive:YES error:&sessionErr]) {
    if (error) *error = sessionErr;
    return NO;
  }
  NSString *path =
      [self chunkPathForSession:self.sessionId index:self.chunkIndex];
  NSError *err = nil;
  AVAudioRecorder *recorder = [self buildRecorderAtPath:path error:&err];
  if (!recorder || err) {
    if (error) *error = err;
    return NO;
  }
  recorder.delegate = self;
  if (![recorder prepareToRecord]) {
    if (error) {
      *error = [NSError errorWithDomain:@"FlexChunkRecorder"
                                   code:1
                               userInfo:@{NSLocalizedDescriptionKey : @"prepareToRecord failed"}];
    }
    return NO;
  }
  if (![recorder record]) {
    if (error) {
      *error = [NSError errorWithDomain:@"FlexChunkRecorder"
                                   code:2
                               userInfo:@{NSLocalizedDescriptionKey : @"record() returned NO"}];
    }
    return NO;
  }
  self.recorder = recorder;
  self.chunkStartedAt = [[NSDate date] timeIntervalSince1970];
  return YES;
}

/**
 * Seamless chunk rotation (Phase 2 of the mic-indicator fix).
 *
 * The old rotation order was:
 *   1. [current stop]        ← no active AVAudioRecorder
 *   2. [self.recorder = nil]
 *   3. start a new recorder  ← 50-150ms gap
 *
 * In deep-background, iOS would observe the empty gap, deactivate our
 * audio session, and the new recorder's record() returned NO. Every
 * subsequent 5-min tick hit the same dead session and failed too, so
 * sessions silently capped at 2 chunks (the first rotation, from a
 * still-fresh session, worked; every rotation after that didn't).
 *
 * New order:
 *   1. UIApplication beginBackgroundTask — tell iOS we're working so
 *      suspension can't hit during the transition.
 *   2. AVAudioSession setActive:YES — defensive; cheap, idempotent.
 *   3. Build + prepareToRecord + record on the NEW recorder.
 *   4. Stop the OLD recorder.
 *   5. Swap self.recorder, emit chunkFinalized for the old chunk.
 *   6. endBackgroundTask.
 *
 * Between 3 and 4 there are briefly TWO active AVAudioRecorders on the
 * same AVAudioSession. That's supported on iOS — both capture the
 * shared mic input, the tiny overlap (< one block of samples in
 * practice) is trimmed by EDGE_SILENCE_TRIM_S on the server. What we
 * gain is that there's NEVER a moment without an active recorder, so
 * iOS has no reason to tear the session down.
 *
 * On failure, retry after 500ms (up to MAX_ROTATION_RETRIES) instead
 * of waiting for the next 5-min timer tick.
 */
static const NSInteger kMaxRotationRetries = 10;
static const int64_t kRotationRetryNsec = 500 * NSEC_PER_MSEC;

- (void)rotateChunk {
  // DispatchSourceTimer fires on its own queue. Hop to main for
  // UIApplication + to serialise all rotation work on one thread.
  dispatch_async(dispatch_get_main_queue(), ^{
    [self rotateChunkAttempt:0];
  });
}

- (void)rotateChunkAttempt:(NSInteger)attempt {
  if (!self.sessionId) return;

  self.rotationAttemptCount += 1;

  UIBackgroundTaskIdentifier bgTask = UIBackgroundTaskInvalid;
  if ([NSThread isMainThread]) {
    bgTask = [[UIApplication sharedApplication]
        beginBackgroundTaskWithName:@"FlexChunkRotation"
                  expirationHandler:^{
                    // iOS is about to terminate us. Nothing we can do
                    // beyond letting the task end gracefully.
                  }];
  }

  // Defensive session reactivation. Cheap, idempotent, and fixes the
  // deep-background failure mode.
  NSError *sessionErr = nil;
  [[AVAudioSession sharedInstance] setActive:YES error:&sessionErr];

  // Build + start the NEW recorder before stopping the old one.
  NSInteger nextIndex = self.chunkIndex + 1;
  NSString *newPath = [self chunkPathForSession:self.sessionId
                                          index:nextIndex];
  NSError *buildErr = nil;
  AVAudioRecorder *newRecorder = [self buildRecorderAtPath:newPath
                                                     error:&buildErr];
  NSString *failReason = nil;
  if (!newRecorder || buildErr) {
    failReason = [NSString
        stringWithFormat:@"build failed: %@",
                         buildErr.localizedDescription ?: @"unknown"];
  } else {
    newRecorder.delegate = self;
    if (![newRecorder prepareToRecord]) {
      failReason = @"prepareToRecord returned NO";
    } else if (![newRecorder record]) {
      failReason = [NSString
          stringWithFormat:@"record() returned NO; session setActive err=%@",
                           sessionErr.localizedDescription ?: @"none"];
    }
  }

  if (failReason) {
    if (self.hasListeners) {
      [self sendEventWithName:kEventRecorderError
                         body:@{
                           @"phase" : @"rotate",
                           @"attempt" : @(attempt),
                           @"message" : failReason,
                           @"rotationAttempts" : @(self.rotationAttemptCount),
                           @"rotationSuccesses" : @(self.rotationSuccessCount),
                         }];
    }
    if (bgTask != UIBackgroundTaskInvalid) {
      [[UIApplication sharedApplication] endBackgroundTask:bgTask];
    }
    if (attempt < kMaxRotationRetries) {
      dispatch_after(
          dispatch_time(DISPATCH_TIME_NOW, kRotationRetryNsec),
          dispatch_get_main_queue(), ^{
            [self rotateChunkAttempt:attempt + 1];
          });
    }
    return;
  }

  // New recorder is active. Now finalize the old one.
  AVAudioRecorder *old = self.recorder;
  NSInteger finalizedIndex = self.chunkIndex;
  NSString *finalizedPath = old.url.path;
  NSTimeInterval durationSec =
      [[NSDate date] timeIntervalSince1970] - self.chunkStartedAt;

  if (old) {
    [old stop];
  }

  self.recorder = newRecorder;
  self.chunkIndex = nextIndex;
  self.chunkStartedAt = [[NSDate date] timeIntervalSince1970];
  self.rotationSuccessCount += 1;

  if (finalizedPath && self.hasListeners) {
    [self sendEventWithName:kEventChunkFinalized
                       body:@{
                         @"sessionId" : self.sessionId ?: @"",
                         @"chunkIndex" : @(finalizedIndex),
                         @"filePath" : finalizedPath,
                         @"durationSeconds" : @(durationSec),
                         @"rotationAttempts" : @(self.rotationAttemptCount),
                         @"rotationSuccesses" : @(self.rotationSuccessCount),
                       }];
  }

  if (bgTask != UIBackgroundTaskInvalid) {
    [[UIApplication sharedApplication] endBackgroundTask:bgTask];
  }
}

- (void)startRotateTimer {
  [self stopRotateTimer];
  dispatch_queue_t queue = dispatch_queue_create(
      "com.flexpestcontrol.salescoach.chunkrotate", DISPATCH_QUEUE_SERIAL);
  dispatch_source_t timer =
      dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, queue);
  int64_t interval = (int64_t)(self.chunkDurationSeconds * NSEC_PER_SEC);
  dispatch_source_set_timer(
      timer, dispatch_time(DISPATCH_TIME_NOW, interval), interval,
      (uint64_t)(1 * NSEC_PER_SEC));
  __weak typeof(self) weakSelf = self;
  dispatch_source_set_event_handler(timer, ^{
    [weakSelf rotateChunk];
  });
  dispatch_resume(timer);
  self.rotateTimer = timer;
}

- (void)stopRotateTimer {
  if (self.rotateTimer) {
    dispatch_source_cancel(self.rotateTimer);
    self.rotateTimer = nil;
  }
}

#pragma mark - Interruption handling

- (void)handleInterruption:(NSNotification *)notification {
  if (!self.sessionId) return;

  NSNumber *typeValue = notification.userInfo[AVAudioSessionInterruptionTypeKey];
  if (!typeValue) return;

  AVAudioSessionInterruptionType type =
      (AVAudioSessionInterruptionType)typeValue.unsignedIntegerValue;

  if (type == AVAudioSessionInterruptionTypeBegan) {
    if (self.hasListeners) {
      [self sendEventWithName:kEventRecorderStatus
                         body:@{@"state" : @"paused"}];
    }
    return;
  }

  if (type == AVAudioSessionInterruptionTypeEnded) {
    // Re-activate the session and rotate to a fresh chunk. We don't try
    // to resume the paused AVAudioRecorder because its state is
    // fragile after an interruption — simpler and more reliable to
    // finalize the partial chunk and start clean.
    NSError *err = nil;
    [[AVAudioSession sharedInstance] setActive:YES error:&err];
    [self rotateChunk];
    if (self.hasListeners) {
      [self sendEventWithName:kEventRecorderStatus
                         body:@{@"state" : @"recording"}];
    }
  }
}

- (void)handleMediaServicesReset:(NSNotification *)__unused notification {
  if (!self.sessionId) return;
  // iOS reset the audio backend. Rebuild the session + recorder from
  // scratch and rotate so the partial/corrupt chunk is replaced.
  NSError *err = nil;
  [self configureAudioSessionWithError:&err];
  [self rotateChunk];
  if (self.hasListeners) {
    [self sendEventWithName:kEventRecorderStatus
                       body:@{@"state" : @"recording", @"reason" : @"mediaServicesReset"}];
  }
}

#pragma mark - Exported methods

RCT_EXPORT_METHOD(startSession
                  : (NSString *)sessionId chunkDurationSeconds
                  : (nonnull NSNumber *)chunkDurationSeconds resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject) {
  if (self.sessionId) {
    reject(@"already_recording", @"Session already in progress", nil);
    return;
  }
  self.sessionId = sessionId;
  self.chunkIndex = 0;
  self.chunkDurationSeconds = [chunkDurationSeconds doubleValue];
  if (self.chunkDurationSeconds < 5) {
    self.chunkDurationSeconds = 5;
  }

  NSError *err = nil;
  if (![self configureAudioSessionWithError:&err]) {
    self.sessionId = nil;
    reject(@"audio_session",
           err.localizedDescription ?: @"AVAudioSession config failed",
           err);
    return;
  }

  if (![self startFirstChunkWithError:&err]) {
    self.sessionId = nil;
    reject(@"recorder_start",
           err.localizedDescription ?: @"recorder failed to start",
           err);
    return;
  }

  self.rotationAttemptCount = 0;
  self.rotationSuccessCount = 0;
  [self startRotateTimer];
  resolve(@{@"ok" : @YES});
}

RCT_EXPORT_METHOD(stopSession
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject) {
  if (!self.sessionId) {
    resolve(@{});
    return;
  }
  [self stopRotateTimer];

  AVAudioRecorder *current = self.recorder;
  NSInteger finalIndex = self.chunkIndex;
  NSString *finalPath = current.url.path;
  NSTimeInterval durationSec =
      [[NSDate date] timeIntervalSince1970] - self.chunkStartedAt;

  if (current) {
    [current stop];
  }
  self.recorder = nil;

  if (finalPath && self.hasListeners) {
    [self sendEventWithName:kEventChunkFinalized
                       body:@{
                         @"sessionId" : self.sessionId ?: @"",
                         @"chunkIndex" : @(finalIndex),
                         @"filePath" : finalPath,
                         @"durationSeconds" : @(durationSec),
                         @"final" : @YES,
                       }];
  }

  self.sessionId = nil;

  NSError *err = nil;
  [[AVAudioSession sharedInstance]
       setActive:NO
      withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation
            error:&err];
  resolve(@{@"finalIndex" : @(finalIndex)});
}

RCT_EXPORT_METHOD(getStatus
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject) {
  if (!self.recorder || !self.sessionId) {
    resolve(@{@"isRecording" : @NO});
    return;
  }
  [self.recorder updateMeters];
  float db = [self.recorder averagePowerForChannel:0];
  NSTimeInterval elapsedMs =
      ([[NSDate date] timeIntervalSince1970] - self.chunkStartedAt) * 1000.0;
  resolve(@{
    @"isRecording" : @(self.recorder.isRecording),
    @"metering" : @(db),
    @"chunkElapsedMs" : @(elapsedMs),
    @"chunkIndex" : @(self.chunkIndex),
  });
}

#pragma mark - AVAudioRecorderDelegate

- (void)audioRecorderEncodeErrorDidOccur:(AVAudioRecorder *)__unused recorder
                                   error:(NSError *)error {
  if (self.hasListeners) {
    [self sendEventWithName:kEventRecorderError
                       body:@{
                         @"phase" : @"encode",
                         @"message" : error.localizedDescription ?: @"encode error",
                       }];
  }
}

@end

__attribute__((constructor))
static void FlexChunkRecorderRegister(void) {
  RCTRegisterModule([FlexChunkRecorder class]);
}
