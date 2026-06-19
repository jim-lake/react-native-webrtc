#if TARGET_OS_OSX
#import "RTCMacOSVideoView.h"

#import <AVFoundation/AVFoundation.h>
#import <CoreMedia/CoreMedia.h>
#import <React/RCTLog.h>
#import <WebRTC/RTCCVPixelBuffer.h>
#import <WebRTC/RTCI420Buffer.h>
#import <WebRTC/RTCVideoFrame.h>

@implementation RTCMacOSVideoView {
    AVSampleBufferDisplayLayer *_displayLayer;
    CGSize _videoSize;
    CMVideoFormatDescriptionRef _formatDesc;
    int _fmtWidth;
    int _fmtHeight;
    OSType _fmtPixelFormat;
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

- (void)dealloc {
    if (_formatDesc)
        CFRelease(_formatDesc);
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
    if (!frame)
        return;

    id<RTCVideoFrameBuffer> buffer = frame.buffer;
    CVPixelBufferRef pixelBuffer = nil;
    BOOL needsRelease = NO;

    if ([buffer isKindOfClass:[RTCCVPixelBuffer class]]) {
        pixelBuffer = ((RTCCVPixelBuffer *)buffer).pixelBuffer;
    } else {
        id<RTCI420Buffer> i420 = [buffer toI420];
        if (!i420) {
            RCTLogWarn(@"RTCMacOSVideoView: toI420 returned nil, buffer class=%@", NSStringFromClass([buffer class]));
            return;
        }
        pixelBuffer = [self createPixelBufferFromI420:i420];
        if (!pixelBuffer) {
            RCTLogWarn(@"RTCMacOSVideoView: createPixelBufferFromI420 failed %dx%d", i420.width, i420.height);
            return;
        }
        needsRelease = YES;
    }

    // Cache format description
    int width = (int)CVPixelBufferGetWidth(pixelBuffer);
    int height = (int)CVPixelBufferGetHeight(pixelBuffer);
    OSType pixelFormat = CVPixelBufferGetPixelFormatType(pixelBuffer);

    if (!_formatDesc || width != _fmtWidth || height != _fmtHeight || pixelFormat != _fmtPixelFormat) {
        if (_formatDesc)
            CFRelease(_formatDesc);
        _formatDesc = NULL;
        CMVideoFormatDescriptionCreateForImageBuffer(NULL, pixelBuffer, &_formatDesc);
        _fmtWidth = width;
        _fmtHeight = height;
        _fmtPixelFormat = pixelFormat;
    }
    if (!_formatDesc) {
        RCTLogWarn(@"RTCMacOSVideoView: CMVideoFormatDescriptionCreateForImageBuffer failed %dx%d fmt=%d",
                   width,
                   height,
                   (int)pixelFormat);
        if (needsRelease)
            CVPixelBufferRelease(pixelBuffer);
        return;
    }

    CMSampleTimingInfo timing = {kCMTimeInvalid, kCMTimeInvalid, kCMTimeInvalid};
    CMSampleBufferRef sampleBuffer = NULL;
    OSStatus status = CMSampleBufferCreateReadyWithImageBuffer(NULL, pixelBuffer, _formatDesc, &timing, &sampleBuffer);
    if (needsRelease)
        CVPixelBufferRelease(pixelBuffer);
    if (status != noErr || !sampleBuffer) {
        RCTLogWarn(@"RTCMacOSVideoView: CMSampleBufferCreateReadyWithImageBuffer failed: %d", (int)status);
        return;
    }

    CFArrayRef attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, YES);
    if (attachments && CFArrayGetCount(attachments) > 0) {
        CFMutableDictionaryRef dict = (CFMutableDictionaryRef)CFArrayGetValueAtIndex(attachments, 0);
        CFDictionarySetValue(dict, kCMSampleAttachmentKey_DisplayImmediately, kCFBooleanTrue);
    } else {
        RCTLogWarn(@"RTCMacOSVideoView: renderFrame no attachments");
    }

    if (self->_displayLayer.status == AVQueuedSampleBufferRenderingStatusFailed ||
        self->_displayLayer.requiresFlushToResumeDecoding) {
        [self->_displayLayer flush];
    }
    if (self->_displayLayer.isReadyForMoreMediaData) {
        [self->_displayLayer enqueueSampleBuffer:sampleBuffer];
    }

    CFRelease(sampleBuffer);
}

#pragma mark - I420 conversion

- (CVPixelBufferRef)createPixelBufferFromI420:(id<RTCI420Buffer>)i420 {
    int width = i420.width;
    int height = i420.height;
    CVPixelBufferRef pixelBuffer = NULL;
    NSDictionary *attrs = @{(NSString *)kCVPixelBufferIOSurfacePropertiesKey : @{}};
    CVReturn ret = CVPixelBufferCreate(NULL,
                                       width,
                                       height,
                                       kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
                                       (__bridge CFDictionaryRef)attrs,
                                       &pixelBuffer);
    if (ret != kCVReturnSuccess) {
        RCTLogWarn(@"RTCMacOSVideoView: CVPixelBufferCreate failed: %d for %dx%d", ret, width, height);
        return nil;
    }

    CVPixelBufferLockBaseAddress(pixelBuffer, 0);
    uint8_t *yDest = CVPixelBufferGetBaseAddressOfPlane(pixelBuffer, 0);
    size_t yStride = CVPixelBufferGetBytesPerRowOfPlane(pixelBuffer, 0);
    for (int row = 0; row < height; row++) {
        memcpy(yDest + row * yStride, i420.dataY + row * i420.strideY, width);
    }
    uint8_t *uvDest = CVPixelBufferGetBaseAddressOfPlane(pixelBuffer, 1);
    size_t uvStride = CVPixelBufferGetBytesPerRowOfPlane(pixelBuffer, 1);
    int cw = (width + 1) / 2;
    int ch = (height + 1) / 2;
    for (int row = 0; row < ch; row++) {
        uint8_t *dst = uvDest + row * uvStride;
        const uint8_t *u = i420.dataU + row * i420.strideU;
        const uint8_t *v = i420.dataV + row * i420.strideV;
        for (int col = 0; col < cw; col++) {
            dst[col * 2] = u[col];
            dst[col * 2 + 1] = v[col];
        }
    }
    CVPixelBufferUnlockBaseAddress(pixelBuffer, 0);
    return pixelBuffer;
}

@end
#endif
