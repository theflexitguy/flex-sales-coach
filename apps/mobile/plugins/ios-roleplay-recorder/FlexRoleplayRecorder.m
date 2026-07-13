#import <React/RCTBridgeModule.h>
#import <ReplayKit/ReplayKit.h>
#import <AVFoundation/AVFoundation.h>

extern void RCTRegisterModule(Class);

@interface FlexRoleplayRecorder : NSObject <RCTBridgeModule>
@end

@implementation FlexRoleplayRecorder {
  dispatch_queue_t _writerQueue;
  AVAssetWriter *_appWriter;
  AVAssetWriterInput *_appInput;
  AVAssetWriter *_micWriter;
  AVAssetWriterInput *_micInput;
  NSURL *_appURL;
  NSURL *_micURL;
  NSURL *_outputURL;
  BOOL _recording;
}

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup {
  return YES;
}

- (instancetype)init {
  if ((self = [super init])) {
    _writerQueue = dispatch_queue_create("com.flexpestcontrol.roleplay-recorder", DISPATCH_QUEUE_SERIAL);
  }
  return self;
}

- (NSURL *)recordingsDirectory {
  NSURL *documents = [[[NSFileManager defaultManager]
      URLsForDirectory:NSDocumentDirectory
             inDomains:NSUserDomainMask] firstObject];
  NSURL *directory = [documents URLByAppendingPathComponent:@"roleplay-recordings" isDirectory:YES];
  [[NSFileManager defaultManager] createDirectoryAtURL:directory
                           withIntermediateDirectories:YES
                                            attributes:nil
                                                 error:nil];
  return directory;
}

- (void)removeURL:(NSURL *)url {
  if (url) [[NSFileManager defaultManager] removeItemAtURL:url error:nil];
}

- (BOOL)prepareWriterForSample:(CMSampleBufferRef)sampleBuffer
                            url:(NSURL *)url
                         writer:(AVAssetWriter **)writerOut
                          input:(AVAssetWriterInput **)inputOut {
  CMFormatDescriptionRef format = CMSampleBufferGetFormatDescription(sampleBuffer);
  const AudioStreamBasicDescription *asbd = format
      ? CMAudioFormatDescriptionGetStreamBasicDescription(format)
      : NULL;
  if (!asbd) return NO;

  NSError *error = nil;
  AVAssetWriter *writer = [[AVAssetWriter alloc] initWithURL:url
                                                   fileType:AVFileTypeAppleM4A
                                                      error:&error];
  if (!writer || error) return NO;

  NSInteger channels = MAX(1, MIN(2, (NSInteger)asbd->mChannelsPerFrame));
  double sampleRate = asbd->mSampleRate > 0 ? asbd->mSampleRate : 48000;
  NSDictionary *settings = @{
    AVFormatIDKey: @(kAudioFormatMPEG4AAC),
    AVSampleRateKey: @(sampleRate),
    AVNumberOfChannelsKey: @(channels),
    AVEncoderBitRateKey: @(96000),
  };
  AVAssetWriterInput *input = [AVAssetWriterInput
      assetWriterInputWithMediaType:AVMediaTypeAudio
                     outputSettings:settings
                   sourceFormatHint:format];
  input.expectsMediaDataInRealTime = YES;
  if (![writer canAddInput:input]) return NO;
  [writer addInput:input];
  if (![writer startWriting]) return NO;
  [writer startSessionAtSourceTime:CMSampleBufferGetPresentationTimeStamp(sampleBuffer)];

  *writerOut = writer;
  *inputOut = input;
  return YES;
}

- (void)appendSample:(CMSampleBufferRef)sampleBuffer appAudio:(BOOL)isAppAudio {
  if (!_recording || !CMSampleBufferDataIsReady(sampleBuffer)) return;

  if (isAppAudio && !_appWriter) {
    AVAssetWriter *writer = nil;
    AVAssetWriterInput *input = nil;
    if (![self prepareWriterForSample:sampleBuffer url:_appURL writer:&writer input:&input]) return;
    _appWriter = writer;
    _appInput = input;
  } else if (!isAppAudio && !_micWriter) {
    AVAssetWriter *writer = nil;
    AVAssetWriterInput *input = nil;
    if (![self prepareWriterForSample:sampleBuffer url:_micURL writer:&writer input:&input]) return;
    _micWriter = writer;
    _micInput = input;
  }

  AVAssetWriter *writer = isAppAudio ? _appWriter : _micWriter;
  AVAssetWriterInput *input = isAppAudio ? _appInput : _micInput;
  if (writer.status == AVAssetWriterStatusWriting && input.readyForMoreMediaData) {
    [input appendSampleBuffer:sampleBuffer];
  }
}

RCT_REMAP_METHOD(start,
                 startWithSessionId:(NSString *)sessionId
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    RPScreenRecorder *recorder = [RPScreenRecorder sharedRecorder];
    if (self->_recording || recorder.isRecording) {
      reject(@"E_ALREADY_RECORDING", @"A roleplay recording is already active", nil);
      return;
    }
    if (!recorder.isAvailable) {
      reject(@"E_UNAVAILABLE", @"Roleplay audio recording is unavailable on this device", nil);
      return;
    }

    NSString *safeId = [[sessionId componentsSeparatedByCharactersInSet:
        [[NSCharacterSet alphanumericCharacterSet] invertedSet]] componentsJoinedByString:@"-"];
    NSURL *directory = [self recordingsDirectory];
    self->_appURL = [directory URLByAppendingPathComponent:[NSString stringWithFormat:@"%@-app.m4a", safeId]];
    self->_micURL = [directory URLByAppendingPathComponent:[NSString stringWithFormat:@"%@-mic.m4a", safeId]];
    self->_outputURL = [directory URLByAppendingPathComponent:[NSString stringWithFormat:@"%@.m4a", safeId]];
    [self removeURL:self->_appURL];
    [self removeURL:self->_micURL];
    [self removeURL:self->_outputURL];
    self->_appWriter = nil;
    self->_appInput = nil;
    self->_micWriter = nil;
    self->_micInput = nil;
    self->_recording = YES;
    recorder.microphoneEnabled = YES;

    [recorder startCaptureWithHandler:^(CMSampleBufferRef sampleBuffer, RPSampleBufferType type, NSError *error) {
      if (error || !self->_recording) return;
      if (type != RPSampleBufferTypeAudioApp && type != RPSampleBufferTypeAudioMic) return;
      CFRetain(sampleBuffer);
      dispatch_async(self->_writerQueue, ^{
        [self appendSample:sampleBuffer appAudio:type == RPSampleBufferTypeAudioApp];
        CFRelease(sampleBuffer);
      });
    } completionHandler:^(NSError *error) {
      if (error) {
        self->_recording = NO;
        reject(@"E_START_FAILED", error.localizedDescription, error);
      } else {
        resolve(@{ @"started": @YES });
      }
    }];
  });
}

- (void)finishWriter:(AVAssetWriter *)writer
                input:(AVAssetWriterInput *)input
                group:(dispatch_group_t)group {
  if (!writer || writer.status != AVAssetWriterStatusWriting) return;
  [input markAsFinished];
  dispatch_group_enter(group);
  [writer finishWritingWithCompletionHandler:^{ dispatch_group_leave(group); }];
}

- (void)finishWithResolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_group_t group = dispatch_group_create();
  [self finishWriter:_appWriter input:_appInput group:group];
  [self finishWriter:_micWriter input:_micInput group:group];

  dispatch_group_notify(group, _writerQueue, ^{
    NSMutableArray<NSURL *> *sources = [NSMutableArray array];
    if (self->_appWriter.status == AVAssetWriterStatusCompleted) [sources addObject:self->_appURL];
    if (self->_micWriter.status == AVAssetWriterStatusCompleted) [sources addObject:self->_micURL];
    if (sources.count == 0) {
      reject(@"E_NO_AUDIO", @"No roleplay audio samples were captured", nil);
      return;
    }

    [self removeURL:self->_outputURL];
    if (sources.count == 1) {
      NSError *copyError = nil;
      [[NSFileManager defaultManager] copyItemAtURL:sources.firstObject
                                              toURL:self->_outputURL
                                              error:&copyError];
      if (copyError) {
        reject(@"E_SAVE_FAILED", copyError.localizedDescription, copyError);
      } else {
        resolve(@{ @"uri": self->_outputURL.absoluteString, @"path": self->_outputURL.path });
      }
      [self removeURL:self->_appURL];
      [self removeURL:self->_micURL];
      return;
    }

    AVMutableComposition *composition = [AVMutableComposition composition];
    NSMutableArray<AVAudioMixInputParameters *> *parameters = [NSMutableArray array];
    NSArray<NSNumber *> *volumes = @[ @0.72, @0.9 ];
    for (NSUInteger index = 0; index < sources.count; index++) {
      AVURLAsset *asset = [AVURLAsset URLAssetWithURL:sources[index] options:nil];
      AVAssetTrack *sourceTrack = [[asset tracksWithMediaType:AVMediaTypeAudio] firstObject];
      if (!sourceTrack) continue;
      AVMutableCompositionTrack *track = [composition addMutableTrackWithMediaType:AVMediaTypeAudio
                                                                  preferredTrackID:kCMPersistentTrackID_Invalid];
      NSError *insertError = nil;
      [track insertTimeRange:CMTimeRangeMake(kCMTimeZero, asset.duration)
                     ofTrack:sourceTrack
                      atTime:kCMTimeZero
                       error:&insertError];
      if (insertError) continue;
      AVMutableAudioMixInputParameters *inputParameters =
          [AVMutableAudioMixInputParameters audioMixInputParametersWithTrack:track];
      [inputParameters setVolume:volumes[index].floatValue atTime:kCMTimeZero];
      [parameters addObject:inputParameters];
    }

    if (parameters.count == 0) {
      reject(@"E_MIX_FAILED", @"Roleplay audio tracks could not be mixed", nil);
      return;
    }

    AVMutableAudioMix *mix = [AVMutableAudioMix audioMix];
    mix.inputParameters = parameters;
    AVAssetExportSession *exporter = [[AVAssetExportSession alloc]
        initWithAsset:composition
           presetName:AVAssetExportPresetAppleM4A];
    exporter.outputURL = self->_outputURL;
    exporter.outputFileType = AVFileTypeAppleM4A;
    exporter.audioMix = mix;
    exporter.shouldOptimizeForNetworkUse = YES;
    [exporter exportAsynchronouslyWithCompletionHandler:^{
      [self removeURL:self->_appURL];
      [self removeURL:self->_micURL];
      if (exporter.status == AVAssetExportSessionStatusCompleted) {
        resolve(@{ @"uri": self->_outputURL.absoluteString, @"path": self->_outputURL.path });
      } else {
        reject(@"E_MIX_FAILED", exporter.error.localizedDescription ?: @"Roleplay audio mix failed", exporter.error);
      }
    }];
  });
}

RCT_REMAP_METHOD(stop,
                 stopWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (!self->_recording) {
      reject(@"E_NOT_RECORDING", @"No roleplay recording is active", nil);
      return;
    }
    self->_recording = NO;
    [[RPScreenRecorder sharedRecorder] stopCaptureWithHandler:^(NSError *error) {
      if (error) {
        reject(@"E_STOP_FAILED", error.localizedDescription, error);
        return;
      }
      dispatch_async(self->_writerQueue, ^{ [self finishWithResolve:resolve reject:reject]; });
    }];
  });
}

RCT_EXPORT_METHOD(cancel) {
  dispatch_async(dispatch_get_main_queue(), ^{
    self->_recording = NO;
    if ([RPScreenRecorder sharedRecorder].isRecording) {
      [[RPScreenRecorder sharedRecorder] stopCaptureWithHandler:^(__unused NSError *error) {}];
    }
  });
}

@end

__attribute__((constructor))
static void FlexRoleplayRecorderRegister(void) {
  RCTRegisterModule([FlexRoleplayRecorder class]);
}
