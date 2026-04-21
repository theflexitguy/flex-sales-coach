// FlexRecordingMonitor — native observer of iOS audio-session interruptions.
//
// WHY THIS EXISTS:
// React Native's JavaScript runtime is aggressively throttled while the
// app is backgrounded — setInterval barely fires, so the JS watchdog
// that's supposed to restart a dead recorder can't. iOS, however,
// delivers AVAudioSession notifications to native code instantly even
// while the app is backgrounded. This module listens natively and:
//
//   1. Re-activates AVAudioSession the moment an interruption ends,
//      synchronously, in native code — before JS wakes up.
//   2. Emits events to JS so the ChunkManager's recovery path fires as
//      soon as the runtime gets CPU again.
//
// Without this, a phone call / Siri / BT route change while the rep is
// in another app kills the recorder and it stays dead for hours —
// exactly what Peyton's all-day recordings hit. The JS-only watchdog
// cannot solve that because JS can't run reliably in background.
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <AVFoundation/AVFoundation.h>

// Some RN versions don't re-export this from RCTBridgeModule.h. Declaring
// it explicitly keeps the file compiling regardless of header path noise.
extern void RCTRegisterModule(Class);

@interface FlexRecordingMonitor : RCTEventEmitter
@end

@implementation FlexRecordingMonitor {
  BOOL _hasListeners;
}

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

- (instancetype)init {
  if ((self = [super init])) {
    [self setupObservers];
  }
  return self;
}

- (void)dealloc {
  [[NSNotificationCenter defaultCenter] removeObserver:self];
}

- (NSArray<NSString *> *)supportedEvents {
  return @[
    @"interruptionBegan",
    @"interruptionEnded",
    @"routeChanged",
    @"mediaServicesReset",
  ];
}

- (void)startObserving {
  _hasListeners = YES;
}

- (void)stopObserving {
  _hasListeners = NO;
}

- (void)setupObservers {
  NSNotificationCenter *nc = [NSNotificationCenter defaultCenter];
  [nc addObserver:self
         selector:@selector(handleInterruption:)
             name:AVAudioSessionInterruptionNotification
           object:nil];
  [nc addObserver:self
         selector:@selector(handleRouteChange:)
             name:AVAudioSessionRouteChangeNotification
           object:nil];
  [nc addObserver:self
         selector:@selector(handleMediaServicesReset:)
             name:AVAudioSessionMediaServicesWereResetNotification
           object:nil];
}

- (void)handleInterruption:(NSNotification *)notification {
  NSDictionary *info = notification.userInfo;
  NSNumber *typeValue = info[AVAudioSessionInterruptionTypeKey];
  if (typeValue == nil) return;

  AVAudioSessionInterruptionType type =
      (AVAudioSessionInterruptionType)typeValue.unsignedIntegerValue;
  NSTimeInterval now = [[NSDate date] timeIntervalSince1970];

  if (type == AVAudioSessionInterruptionTypeBegan) {
    if (_hasListeners) {
      [self sendEventWithName:@"interruptionBegan" body:@{@"at": @(now)}];
    }
    return;
  }

  if (type == AVAudioSessionInterruptionTypeEnded) {
    // Re-activate the audio session NATIVELY. If this works, any
    // recorder that was paused by the interruption becomes eligible
    // to resume without JS having to do anything.
    NSError *error = nil;
    BOOL reactivated = [[AVAudioSession sharedInstance] setActive:YES
                                                            error:&error];

    BOOL shouldResume = NO;
    NSNumber *optionsValue = info[AVAudioSessionInterruptionOptionKey];
    if (optionsValue != nil) {
      AVAudioSessionInterruptionOptions options =
          (AVAudioSessionInterruptionOptions)optionsValue.unsignedIntegerValue;
      shouldResume = (options & AVAudioSessionInterruptionOptionShouldResume) != 0;
    }

    if (_hasListeners) {
      [self sendEventWithName:@"interruptionEnded"
                         body:@{
                           @"at": @(now),
                           @"shouldResume": @(shouldResume),
                           @"reactivated": @(reactivated),
                           @"error": error.localizedDescription ?: [NSNull null],
                         }];
    }
  }
}

- (void)handleRouteChange:(NSNotification *)notification {
  NSDictionary *info = notification.userInfo;
  NSNumber *reasonValue = info[AVAudioSessionRouteChangeReasonKey];
  NSTimeInterval now = [[NSDate date] timeIntervalSince1970];
  NSUInteger reason = reasonValue ? reasonValue.unsignedIntegerValue : 0;

  // Always try to re-assert the session after a route change. AirPods
  // disconnecting / connecting to CarPlay / switching output can
  // silently stop recording otherwise.
  if (reason == AVAudioSessionRouteChangeReasonOldDeviceUnavailable ||
      reason == AVAudioSessionRouteChangeReasonNewDeviceAvailable ||
      reason == AVAudioSessionRouteChangeReasonOverride) {
    NSError *error = nil;
    [[AVAudioSession sharedInstance] setActive:YES error:&error];
  }

  if (_hasListeners) {
    [self sendEventWithName:@"routeChanged"
                       body:@{@"at": @(now), @"reason": @(reason)}];
  }
}

- (void)handleMediaServicesReset:(NSNotification *)__unused notification {
  // Rare but catastrophic — iOS reset the audio backend. Everything
  // recording-related needs to be re-created from scratch.
  NSTimeInterval now = [[NSDate date] timeIntervalSince1970];
  if (_hasListeners) {
    [self sendEventWithName:@"mediaServicesReset" body:@{@"at": @(now)}];
  }
}

@end

// Belt-and-suspenders: RCT_EXPORT_MODULE already generates +load, but
// our autolinking setup has dropped modules on the floor before. An
// explicit constructor guarantees the class is registered even if the
// macro's +load gets stripped or missed by the bridge scan.
__attribute__((constructor))
static void FlexRecordingMonitorRegister(void) {
  RCTRegisterModule([FlexRecordingMonitor class]);
}
