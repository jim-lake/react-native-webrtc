#if TARGET_OS_OSX
#import "RTCMacOSVideoView.h"

#import <AVFoundation/AVFoundation.h>
#import <CoreMedia/CoreMedia.h>
#import <WebRTC/RTCVideoFrame.h>
#import <WebRTC/RTCCVPixelBuffer.h>
#import <React/RCTLog.h>

@implementation RTCMacOSVideoView {
    AVSampleBufferDisplayLayer *_displayLayer;
    CGSize _videoSize;
}

- (instancetype)initWithFrame:(NSRect)frame {
    if (self = [super initWithFrame:frame]) {
        self.wantsLayer = YES;
        _displayLayer = [[AVSampleBufferDisplayLayer alloc] init];
        _displayLayer.videoGravity = AVLayerVideoGravityResizeAspectFill;
        [self.layer addSublayer:_displayLayer];
        _videoSize = CGSizeZero;
        RCTLog(@"RTCMacOSVideoView: initialized AVSampleBufferDisplayLayer renderer");
    }
    return self;
}

- (void)setVideoGravity:(NSString *)videoGravity {
    _displayLayer.videoGravity = videoGravity;
}

- (void)layout {
    [super layout];
    _displayLayer.frame = self.bounds;
}

#pragma mark - RTCVideoRenderer

- (void)setSize:(CGSize)size {
    if (!CGSizeEqualToSize(_videoSize, size)) {
        RCTLog(@"RTCMacOSVideoView: video size changed to %dx%d", (int)size.width, (int)size.height);
        _videoSize = size;
        dispatch_async(dispatch_get_main_queue(), ^{
            if (self.delegate) {
                [self.delegate videoView:(id)self didChangeVideoSize:size];
            }
        });
    }
}

- (void)renderFrame:(RTCVideoFrame *)frame {
    if (!frame) {
        return;
    }

    id<RTCVideoFrameBuffer> buffer = frame.buffer;
    CVPixelBufferRef pixelBuffer = nil;

    if ([buffer isKindOfClass:[RTCCVPixelBuffer class]]) {
        pixelBuffer = ((RTCCVPixelBuffer *)buffer).pixelBuffer;
    } else {
        RCTLogWarn(@"RTCMacOSVideoView: non-CVPixelBuffer frame received, skipping");
        return;
    }

    CMVideoFormatDescriptionRef formatDesc = NULL;
    OSStatus status = CMVideoFormatDescriptionCreateForImageBuffer(NULL, pixelBuffer, &formatDesc);
    if (status != noErr) {
        RCTLogWarn(@"RTCMacOSVideoView: CMVideoFormatDescriptionCreate failed: %d", (int)status);
        return;
    }

    CMSampleTimingInfo timing = {
        .duration = kCMTimeInvalid,
        .presentationTimeStamp = CMTimeMake(frame.timeStampNs, 1000000000),
        .decodeTimeStamp = kCMTimeInvalid
    };

    CMSampleBufferRef sampleBuffer = NULL;
    status = CMSampleBufferCreateReadyWithImageBuffer(NULL, pixelBuffer, formatDesc, &timing, &sampleBuffer);
    CFRelease(formatDesc);

    if (status != noErr || !sampleBuffer) {
        RCTLogWarn(@"RTCMacOSVideoView: CMSampleBufferCreate failed: %d", (int)status);
        return;
    }

    CFArrayRef attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, YES);
    if (attachments && CFArrayGetCount(attachments) > 0) {
        CFMutableDictionaryRef dict = (CFMutableDictionaryRef)CFArrayGetValueAtIndex(attachments, 0);
        CFDictionarySetValue(dict, kCMSampleAttachmentKey_DisplayImmediately, kCFBooleanTrue);
    }

    dispatch_async(dispatch_get_main_queue(), ^{
        if (self->_displayLayer.status == AVQueuedSampleBufferRenderingStatusFailed) {
            RCTLogWarn(@"RTCMacOSVideoView: display layer failed, flushing. Error: %@", self->_displayLayer.error);
            [self->_displayLayer flush];
        }
        [self->_displayLayer enqueueSampleBuffer:sampleBuffer];
        CFRelease(sampleBuffer);
    });
}

@end
#endif
