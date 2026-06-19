#if TARGET_OS_OSX
#import <AppKit/AppKit.h>
#import <WebRTC/RTCVideoRenderer.h>

/**
 * Fallback video renderer for macOS using AVSampleBufferDisplayLayer.
 * Used when RTCMTLNSVideoView is not available in the WebRTC framework binary.
 */
@interface RTCMacOSVideoView : NSView<RTCVideoRenderer>

@property(nonatomic, weak) id<RTCVideoViewDelegate> delegate;
@property(nonatomic, copy) NSString *videoGravity;

@end
#endif
