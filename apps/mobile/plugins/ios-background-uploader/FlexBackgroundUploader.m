// FlexBackgroundUploader — native iOS background chunk uploader.
//
// WHY THIS EXISTS:
// JavaScript-driven uploads via fetch() stop the moment iOS suspends the
// app (typically ~30 seconds after backgrounding with no audio activity).
// For a rep who hits Stop at end-of-day and walks to their truck, that
// strands dozens of chunks in the in-memory queue.
//
// URLSession with a background configuration hands the uploads off to
// the OS. iOS continues uploads even if the app is suspended or killed
// — and relaunches the app in the background to deliver completion
// events. This is the same mechanism Siro's native SDK uses.
//
// Architecture:
//   - FlexBackgroundUploader: tiny plain-ObjC class with class methods
//     only. AppDelegate.swift (Swift) calls these to hand off iOS's
//     background-events completion handler. Static storage survives
//     even when the React Native bridge is torn down and rebuilt.
//   - FlexBackgroundUploaderRCT: RCTEventEmitter subclass that owns
//     the NSURLSession instance, the in-flight task metadata, and all
//     React Native exported methods. Registered under the exported
//     module name "FlexBackgroundUploader" so JS finds it.
#import "FlexBackgroundUploader.h"
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <UIKit/UIKit.h>

extern void RCTRegisterModule(Class);

static NSString *const kSessionIdentifier =
    @"com.flexpestcontrol.salescoach.bgupload";
static NSString *const kMetadataFileName = @"flex-bg-uploads.json";
static NSString *const kPendingEventsFileName = @"flex-bg-upload-events.json";
static NSString *const kEventCompleted = @"uploadCompleted";
static NSString *const kEventFailed = @"uploadFailed";

// Shared completion-handler registry keyed by session identifier. The
// AppDelegate stashes handlers here from
// application:handleEventsForBackgroundURLSession:completionHandler:;
// the URLSession delegate consumes them.
static NSMutableDictionary<NSString *, void (^)(void)> *sCompletionHandlers;
static dispatch_queue_t sCompletionHandlersQueue;

@implementation FlexBackgroundUploader

+ (NSString *)sessionIdentifier {
  return kSessionIdentifier;
}

+ (void)initialize {
  if (self == [FlexBackgroundUploader class]) {
    sCompletionHandlers = [NSMutableDictionary dictionary];
    sCompletionHandlersQueue = dispatch_queue_create(
        "com.flexpestcontrol.salescoach.bgupload.handlers",
        DISPATCH_QUEUE_SERIAL);
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

#pragma mark - React Native module

@interface FlexBackgroundUploaderRCT : RCTEventEmitter <
    NSURLSessionDelegate,
    NSURLSessionTaskDelegate>
@property(nonatomic, strong) NSURLSession *session;
@property(nonatomic, strong)
    NSMutableDictionary<NSString *, NSDictionary *> *taskMetadata;
@property(nonatomic, assign) BOOL hasListeners;
@end

@implementation FlexBackgroundUploaderRCT

RCT_EXPORT_MODULE(FlexBackgroundUploader)

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

- (instancetype)init {
  if ((self = [super init])) {
    _taskMetadata = [[self loadMetadataFromDisk] mutableCopy]
                        ?: [NSMutableDictionary dictionary];
    NSURLSessionConfiguration *config = [NSURLSessionConfiguration
        backgroundSessionConfigurationWithIdentifier:kSessionIdentifier];
    config.sessionSendsLaunchEvents = YES;
    config.discretionary = NO;
    config.allowsCellularAccess = YES;
    // Give the OS room to upload over flaky cell. iOS retries internally
    // across network availability changes.
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
  // Supabase createSignedUploadUrl issues URLs that require PUT.
  req.HTTPMethod = @"PUT";
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
  [self.session getAllTasksWithCompletionHandler:^(
                    NSArray<__kindof NSURLSessionTask *> *tasks) {
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

RCT_EXPORT_METHOD(getActiveTaskIds
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject) {
  [self.session getAllTasksWithCompletionHandler:^(
                    NSArray<__kindof NSURLSessionTask *> *tasks) {
    NSMutableArray *ids = [NSMutableArray arrayWithCapacity:tasks.count];
    for (NSURLSessionTask *t in tasks) {
      [ids addObject:@(t.taskIdentifier)];
    }
    resolve(ids);
  }];
}

RCT_EXPORT_METHOD(drainEvents
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject) {
  NSArray *pending = [self loadPendingEventsFromDisk];
  [self persistPendingEvents:@[]];
  resolve(pending ?: @[]);
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

- (NSString *)pendingEventsFilePath {
  NSArray<NSString *> *paths = NSSearchPathForDirectoriesInDomains(
      NSApplicationSupportDirectory, NSUserDomainMask, YES);
  NSString *dir = paths.firstObject;
  [[NSFileManager defaultManager] createDirectoryAtPath:dir
                            withIntermediateDirectories:YES
                                             attributes:nil
                                                  error:nil];
  return [dir stringByAppendingPathComponent:kPendingEventsFileName];
}

- (NSArray *)loadPendingEventsFromDisk {
  NSData *data = [NSData dataWithContentsOfFile:[self pendingEventsFilePath]];
  if (!data) return @[];
  NSError *err = nil;
  id obj = [NSJSONSerialization JSONObjectWithData:data options:0 error:&err];
  if (err || ![obj isKindOfClass:[NSArray class]]) return @[];
  return obj;
}

- (void)persistPendingEvents:(NSArray *)events {
  NSError *err = nil;
  NSData *data = [NSJSONSerialization dataWithJSONObject:events
                                                 options:0
                                                   error:&err];
  if (err || !data) return;
  [data writeToFile:[self pendingEventsFilePath] atomically:YES];
}

- (void)emitOrPersistEvent:(NSString *)eventName payload:(NSDictionary *)payload {
  if (self.hasListeners) {
    [self sendEventWithName:eventName body:payload];
    return;
  }

  NSMutableDictionary *storedPayload = [payload mutableCopy];
  storedPayload[@"eventName"] = eventName;
  NSMutableArray *pending = [[self loadPendingEventsFromDisk] mutableCopy];
  [pending addObject:storedPayload];
  [self persistPendingEvents:pending];
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

  [self emitOrPersistEvent:eventName payload:payload];
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
