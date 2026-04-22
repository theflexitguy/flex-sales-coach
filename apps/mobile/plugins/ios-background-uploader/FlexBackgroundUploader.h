// Public header — exposes the background URLSession identifier and
// the completion-handler sink so AppDelegate.swift can hand off
// iOS's background-events completion handler without needing to know
// about the RCTEventEmitter details.
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface FlexBackgroundUploader : NSObject
/** Stable identifier for the URLSessionConfiguration.background session. */
+ (NSString *)sessionIdentifier;
/**
 * Store the iOS-provided completion handler so the URLSession delegate
 * can call it when all events have been delivered (avoids the app
 * lingering in a background-launched state).
 */
+ (void)storeCompletionHandler:(void (^)(void))handler
                 forIdentifier:(NSString *)identifier;
@end

NS_ASSUME_NONNULL_END
