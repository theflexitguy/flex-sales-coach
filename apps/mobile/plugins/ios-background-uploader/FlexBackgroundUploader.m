// FlexBackgroundUploader — native iOS background chunk uploader.
//
// WHY THIS EXISTS:
// JavaScript-driven uploads via fetch() stop the moment iOS suspends the
// app (typically ~30 seconds after backgrounding with no audio activity).
// For a rep who hits Stop at end-of-day and walks to their truck, that
// strands dozens of chunks in the in-memory queue. The JS upload queue
// in services/recording/UploadQueue.ts is a decent retry loop but only
// runs while JS can run.
//
// URLSession with a background configuration hands the uploads off to
// the OS. iOS continues uploads even if the app is suspended or killed
// — and relaunches the app in the background to deliver completion
// events. This is the same mechanism Siro's native SDK uses.
//
// Constraints imposed by URLSession.background:
//   - only uploadTaskWithRequest:fromFile: works (no fromData)
//   - session identifier must be stable across launches
//   - the task delegate must be the session delegate, not a per-task
//     delegate
//   - completion handlers must be called from
//     application:handleEventsForBackgroundURLSession:completionHandler:
//     so iOS knows we're done processing
#import "FlexBackgroundUploader.h"
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <UIKit/UIKit.h>

extern void RCTRegisterModule(Class);

static NSString *const kSessionIdentifier =
    @"com.flexpestcontrol.salescoach.bgupload";
static NSString *const kMetadataFileName = @"flex-bg-uploads.json";
static NSString *const kEventCompleted = @"uploadCompleted";
static NSString *const kEventFailed = @"uploadFailed";

// Shared completion-handler registry keyed by session identifier. The
// AppDelegate stashes handlers here from
// application:handleEventsForBackgroundURLSession:completionHandler:;
// the URLSession delegate consumes them.
static NSMutableDictionary<NSString *, void (^)(void)> *sCompletionHandlers;
static dispatch_queue_t sCompletionHandlersQueue;

@interface FlexBackgroundUploader () <
    NSURLSessionDelegate,
    NSURLSessionTaskDelegate>
@property(nonatomic, strong) NSURLSession *session;
@property(nonatomic, strong)
    NSMutableDictionary<NSString *, NSDictionary *> *taskMetadata;
@property(nonatomic, assign) BOOL hasListeners;
@end

// React Native bridge class that inherits from RCTEventEmitter. The
// actual uploader logic lives on the public-interface class so it's
// accessible to Swift AppDelegate via the bridging header.
@interface FlexBackgroundUploaderRCT : RCTEventEmitter
@end

static FlexBackgroundUploaderRCT *sUploaderInstance;

@implementation FlexBackgroundUploader

+ (NSString *)sessionIdentifier {
  return kSessionIdentifier;
}

+ (void)initialize {
  if (self == [FlexBackgroundUploader class]) {
    sCompletionHandlers = [NSMutableDictionary dictionary];
    sCompletionHandlersQueue = dispatch_queue_create(
        "com.flexpestcontrol.salescoach.bgupload.handlers", DISPATCH_QUEUE_SERIAL);
  }
}

+ (void)storeCompletionHandler:(void (^)(void))handler
                 forIdentifier:(NSString *)identifier {
  if (!handler || !identifier) return;
  dispatch_sync(sCompletionHandlersQueue, ^{
    sCompletionHandlers[identifier] = [handler copy];
  });
}

+ (void (^_Nullable)(void))consumeCompletionHandlerForIdentifier:
    (NSString *)identifier {
  __block void (^handler)(void) = nil;
  dispatch_sync(sCompletionHandlersQueue, ^{
    handler = sCompletionHandlers[identifier];
    [sCompletionHandlers removeObjectForKey:identifier];
  });
  return handler;
}

@end

@implementation FlexBackgroundUploaderRCT

RCT_EXPORT_MODULE(FlexBackgroundUploader)

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

- (instancetype)init {
  if ((self = [super init])) {
    sUploaderInstance = self;
    _taskMetadata = [[self loadMetadataFromDisk] mutableCopy]
                        ?: [NSMutableDictionary dictionary];
    NSURLSessionConfiguration *config = [NSURLSessionConfiguration
        backgroundSessionConfigurationWithIdentifier:kSessionIdentifier];
    config.sessionSendsLaunchEvents = YES;
    config.discretionary = NO;
    config.allowsCellularAccess = YES;
    // Timeouts: give the OS room to upload over flaky cell. iOS will
    // retry internally across network availability changes.
    config.timeoutIntervalForRequest = 120;
    config.timeoutIntervalForResource = 60 * 60 * 6;
    _session = [NSURLSession sessionWithConfiguration:config
                                              delegate:self
                                         delegateQueue:nil];
  }
  return self;
}

- (NSArray<NSString *> *)supportedEvents {
  return @[kEventCompleted, kEventFailed];
}

- (void)startObserving {
  _hasListeners = YES;
}

- (void)stopObserving {
  _hasListeners = NO;
}

#pragma mark - React methods

RCT_EXPORT_METHOD(enqueueUpload
                  : (NSString *)localFilePath uploadUrl
                  : (NSString *)uploadUrl headers
                  : (NSDictionary *)headers metadata
                  : (NSDictionary *)metadata resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject) {
  if (![[NSFileManager defaultManager] fileExistsAtPath:localFilePath]) {
    reject(@"file_missing",
           [NSString stringWithFormat:@"File missing at %@", localFilePath],
           nil);
    return;
  }
  NSURL *url = [NSURL URLWithString:uploadUrl];
  if (!url) {
    reject(@"invalid_url", @"uploadUrl not a valid URL", nil);
    return;
  }
  NSURL *fileURL = [NSURL fileURLWithPath:localFilePath];
  NSMutableURLRequest *req = [NSMutableURLRequest requestWithURL:url];
  req.HTTPMethod = @"POST";
  for (NSString *name in headers) {
    id value = headers[name];
    if ([value isKindOfClass:[NSString class]]) {
      [req setValue:(NSString *)value forHTTPHeaderField:name];
    }
  }
  NSURLSessionUploadTask *task = [self.session uploadTaskWithRequest:req
                                                            fromFile:fileURL];
  NSString *key = [@(task.taskIdentifier) stringValue];
  @synchronized(self.taskMetadata) {
    self.taskMetadata[key] = metadata ?: @{};
    [self persistMetadataToDisk];
  }
  [task resume];
  resolve(@{@"taskId" : @(task.taskIdentifier)});
}

RCT_EXPORT_METHOD(cancelAll
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject) {
  [self.session
      getAllTasksWithCompletionHandler:^(NSArray<__kindof NSURLSessionTask *> *tasks) {
        for (NSURLSessionTask *t in tasks) {
          [t cancel];
        }
        @synchronized(self.taskMetadata) {
          [self.taskMetadata removeAllObjects];
          [self persistMetadataToDisk];
        }
        resolve(@(tasks.count));
      }];
}

RCT_EXPORT_METHOD(getPendingCount
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject) {
  [self.session getAllTasksWithCompletionHandler:^(
                    NSArray<__kindof NSURLSessionTask *> *tasks) {
    resolve(@(tasks.count));
  }];
}

#pragma mark - Metadata persistence

- (NSString *)metadataFilePath {
  NSArray<NSString *> *paths = NSSearchPathForDirectoriesInDomains(
      NSApplicationSupportDirectory, NSUserDomainMask, YES);
  NSString *dir = paths.firstObject;
  [[NSFileManager defaultManager] createDirectoryAtPath:dir
                            withIntermediateDirectories:YES
                                             attributes:nil
                                                  error:nil];
  return [dir stringByAppendingPathComponent:kMetadataFileName];
}

- (NSDictionary *)loadMetadataFromDisk {
  NSData *data = [NSData dataWithContentsOfFile:[self metadataFilePath]];
  if (!data) return @{};
  NSError *err = nil;
  id obj = [NSJSONSerialization JSONObjectWithData:data options:0 error:&err];
  if (err || ![obj isKindOfClass:[NSDictionary class]]) return @{};
  return obj;
}

- (void)persistMetadataToDisk {
  NSError *err = nil;
  NSData *data = [NSJSONSerialization dataWithJSONObject:self.taskMetadata
                                                 options:0
                                                   error:&err];
  if (err || !data) return;
  [data writeToFile:[self metadataFilePath] atomically:YES];
}

#pragma mark - NSURLSession delegate

- (void)URLSession:(NSURLSession *)session
                    task:(NSURLSessionTask *)task
    didCompleteWithError:(nullable NSError *)error {
  NSString *key = [@(task.taskIdentifier) stringValue];
  NSDictionary *meta = nil;
  @synchronized(self.taskMetadata) {
    meta = self.taskMetadata[key];
    [self.taskMetadata removeObjectForKey:key];
    [self persistMetadataToDisk];
  }
  NSHTTPURLResponse *response =
      [task.response isKindOfClass:[NSHTTPURLResponse class]]
          ? (NSHTTPURLResponse *)task.response
          : nil;
  NSInteger status = response ? response.statusCode : 0;

  NSMutableDictionary *payload = [NSMutableDictionary dictionary];
  payload[@"metadata"] = meta ?: @{};
  payload[@"status"] = @(status);
  payload[@"taskId"] = @(task.taskIdentifier);

  NSString *eventName;
  if (error) {
    eventName = kEventFailed;
    payload[@"error"] = error.localizedDescription ?: @"unknown";
  } else if (status >= 200 && status < 300) {
    eventName = kEventCompleted;
  } else {
    eventName = kEventFailed;
    payload[@"error"] =
        [NSString stringWithFormat:@"HTTP %ld", (long)status];
  }

  if (self.hasListeners) {
    [self sendEventWithName:eventName body:payload];
  }
}

- (void)URLSessionDidFinishEventsForBackgroundURLSession:(NSURLSession *)session {
  NSString *identifier = session.configuration.identifier ?: kSessionIdentifier;
  void (^handler)(void) =
      [FlexBackgroundUploader consumeCompletionHandlerForIdentifier:identifier];
  if (handler) {
    dispatch_async(dispatch_get_main_queue(), handler);
  }
}

@end

__attribute__((constructor))
static void FlexBackgroundUploaderRegister(void) {
  RCTRegisterModule([FlexBackgroundUploaderRCT class]);
}
