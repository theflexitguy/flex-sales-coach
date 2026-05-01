// FlexBackgroundLocation - native CLLocationManager sampling for active
// recording sessions. JS timers are throttled in the background, so this
// module persists location points natively and lets JS drain them later.
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <CoreLocation/CoreLocation.h>

extern void RCTRegisterModule(Class);

static NSString *const kPendingPointsFileName = @"flex-bg-location-points.json";
static NSString *const kEventLocationPoint = @"locationPoint";

@interface FlexBackgroundLocation : RCTEventEmitter <CLLocationManagerDelegate>
@property(nonatomic, strong) CLLocationManager *manager;
@property(nonatomic, copy, nullable) NSString *sessionId;
@property(nonatomic, assign) NSTimeInterval startedAtMs;
@property(nonatomic, assign) BOOL hasListeners;
@end

@implementation FlexBackgroundLocation

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup {
  return YES;
}

- (instancetype)init {
  if ((self = [super init])) {
    _manager = [CLLocationManager new];
    _manager.delegate = self;
    _manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters;
    _manager.distanceFilter = 10;
    _manager.pausesLocationUpdatesAutomatically = NO;
    if ([_manager respondsToSelector:@selector(setAllowsBackgroundLocationUpdates:)]) {
      _manager.allowsBackgroundLocationUpdates = YES;
    }
    if ([_manager respondsToSelector:@selector(setShowsBackgroundLocationIndicator:)]) {
      _manager.showsBackgroundLocationIndicator = YES;
    }
  }
  return self;
}

- (NSArray<NSString *> *)supportedEvents {
  return @[kEventLocationPoint];
}

- (void)startObserving {
  self.hasListeners = YES;
}

- (void)stopObserving {
  self.hasListeners = NO;
}

- (NSString *)pendingPointsFilePath {
  NSArray<NSString *> *paths = NSSearchPathForDirectoriesInDomains(
      NSApplicationSupportDirectory, NSUserDomainMask, YES);
  NSString *dir = paths.firstObject;
  [[NSFileManager defaultManager] createDirectoryAtPath:dir
                            withIntermediateDirectories:YES
                                             attributes:nil
                                                  error:nil];
  return [dir stringByAppendingPathComponent:kPendingPointsFileName];
}

- (NSArray *)loadPendingPointsFromDisk {
  NSData *data = [NSData dataWithContentsOfFile:[self pendingPointsFilePath]];
  if (!data) return @[];
  NSError *err = nil;
  id obj = [NSJSONSerialization JSONObjectWithData:data options:0 error:&err];
  if (err || ![obj isKindOfClass:[NSArray class]]) return @[];
  return obj;
}

- (void)persistPendingPoints:(NSArray *)points {
  NSError *err = nil;
  NSData *data = [NSJSONSerialization dataWithJSONObject:points
                                                 options:0
                                                   error:&err];
  if (err || !data) return;
  [data writeToFile:[self pendingPointsFilePath] atomically:YES];
}

- (NSString *)isoStringForDate:(NSDate *)date {
  static NSDateFormatter *formatter;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    formatter = [NSDateFormatter new];
    formatter.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
    formatter.timeZone = [NSTimeZone timeZoneForSecondsFromGMT:0];
    formatter.dateFormat = @"yyyy-MM-dd'T'HH:mm:ss.SSS'Z'";
  });
  return [formatter stringFromDate:date];
}

- (void)storePointForLocation:(CLLocation *)location {
  if (!self.sessionId) return;
  NSTimeInterval capturedMs = [location.timestamp timeIntervalSince1970] * 1000.0;
  NSInteger elapsedS = MAX(0, (NSInteger)llround((capturedMs - self.startedAtMs) / 1000.0));
  NSDictionary *point = @{
    @"id" : [NSUUID UUID].UUIDString,
    @"sessionId" : self.sessionId,
    @"elapsedS" : @(elapsedS),
    @"latitude" : @(location.coordinate.latitude),
    @"longitude" : @(location.coordinate.longitude),
    @"capturedAt" : [self isoStringForDate:location.timestamp],
  };
  NSMutableArray *pending = [[self loadPendingPointsFromDisk] mutableCopy];
  [pending addObject:point];
  [self persistPendingPoints:pending];
  if (self.hasListeners) {
    [self sendEventWithName:kEventLocationPoint body:point];
  }
}

RCT_EXPORT_METHOD(startSession
                  : (NSString *)sessionId startedAtMs
                  : (nonnull NSNumber *)startedAtMs resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    self.sessionId = sessionId;
    self.startedAtMs = [startedAtMs doubleValue];
    CLAuthorizationStatus status;
    if (@available(iOS 14.0, *)) {
      status = self.manager.authorizationStatus;
    } else {
      status = [CLLocationManager authorizationStatus];
    }
    if (status == kCLAuthorizationStatusNotDetermined ||
        status == kCLAuthorizationStatusAuthorizedWhenInUse) {
      [self.manager requestAlwaysAuthorization];
    }
    [self.manager startUpdatingLocation];
    resolve(@{@"ok" : @YES});
  });
}

RCT_EXPORT_METHOD(stopSession
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    [self.manager stopUpdatingLocation];
    self.sessionId = nil;
    NSArray *points = [self loadPendingPointsFromDisk];
    [self persistPendingPoints:@[]];
    resolve(points ?: @[]);
  });
}

RCT_EXPORT_METHOD(drainPoints
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject) {
  NSArray *points = [self loadPendingPointsFromDisk];
  [self persistPendingPoints:@[]];
  resolve(points ?: @[]);
}

- (void)locationManager:(CLLocationManager *)manager
     didUpdateLocations:(NSArray<CLLocation *> *)locations {
  for (CLLocation *location in locations) {
    if (location.horizontalAccuracy < 0) continue;
    [self storePointForLocation:location];
  }
}

@end

__attribute__((constructor))
static void FlexBackgroundLocationRegister(void) {
  RCTRegisterModule([FlexBackgroundLocation class]);
}
