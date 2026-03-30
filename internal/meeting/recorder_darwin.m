#import <Foundation/Foundation.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <AVFoundation/AVFoundation.h>
#import <CoreMedia/CoreMedia.h>
#import <AudioToolbox/AudioToolbox.h>

#include "recorder_darwin.h"

// ── State ─────────────────────────────────────────────────────

static SCStream *activeStream = nil;
static AVAssetWriter *systemWriter = nil;
static AVAssetWriter *micWriter = nil;
static AVAssetWriterInput *systemInput = nil;
static AVAssetWriterInput *micInput = nil;
static dispatch_queue_t captureQueue = nil;

static BOOL isActive = NO;
static BOOL systemSessionStarted = NO;
static BOOL micSessionStarted = NO;
static float systemLevel = 0.0f;
static float micLevel = 0.0f;
static NSString *lastError = @"";

// ── Audio Level Computation ───────────────────────────────────

static float computeRMSLevel(CMSampleBufferRef sampleBuffer) {
    CMBlockBufferRef blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer);
    if (!blockBuffer) return 0.0f;

    size_t length = 0;
    char *dataPtr = NULL;
    OSStatus status = CMBlockBufferGetDataPointer(blockBuffer, 0, NULL, &length, &dataPtr);
    if (status != kCMBlockBufferNoErr || !dataPtr || length == 0) return 0.0f;

    float *samples = (float *)dataPtr;
    int sampleCount = (int)(length / sizeof(float));
    if (sampleCount == 0) return 0.0f;

    float sumSquares = 0.0f;
    for (int i = 0; i < sampleCount; i++) {
        sumSquares += samples[i] * samples[i];
    }
    float rms = sqrtf(sumSquares / sampleCount);
    float db = 20.0f * log10f(fmaxf(rms, 1e-10f));
    // Normalize: -60dB → 0.0, 0dB → 1.0
    return fmaxf(0.0f, fminf(1.0f, (db + 60.0f) / 60.0f));
}

// ── Stream Output Delegate ────────────────────────────────────

@interface NotesAudioStreamOutput : NSObject <SCStreamOutput>
@end

@implementation NotesAudioStreamOutput

- (void)stream:(SCStream *)stream
    didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer
    ofType:(SCStreamOutputType)type {

    @autoreleasepool {
        if (!CMSampleBufferDataIsReady(sampleBuffer)) return;

        if (type == SCStreamOutputTypeAudio) {
            // System audio
            systemLevel = computeRMSLevel(sampleBuffer);

            if (systemWriter.status == AVAssetWriterStatusWriting) {
                if (!systemSessionStarted) {
                    CMTime pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer);
                    [systemWriter startSessionAtSourceTime:pts];
                    systemSessionStarted = YES;
                }
                if (systemInput.readyForMoreMediaData) {
                    [systemInput appendSampleBuffer:sampleBuffer];
                }
            }
        } else if (type == SCStreamOutputTypeMicrophone) {
            // Microphone
            micLevel = computeRMSLevel(sampleBuffer);

            if (micWriter.status == AVAssetWriterStatusWriting) {
                if (!micSessionStarted) {
                    CMTime pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer);
                    [micWriter startSessionAtSourceTime:pts];
                    micSessionStarted = YES;
                }
                if (micInput.readyForMoreMediaData) {
                    [micInput appendSampleBuffer:sampleBuffer];
                }
            }
        }
    }
}

- (void)stream:(SCStream *)stream didStopWithError:(NSError *)error {
    lastError = [error localizedDescription] ?: @"Unknown stream error";
    isActive = NO;
}

@end

static NotesAudioStreamOutput *streamOutput = nil;

// ── AVAssetWriter Setup ───────────────────────────────────────

static AVAssetWriter *createWriter(NSString *path, AVAssetWriterInput **inputOut) {
    NSError *error = nil;
    NSURL *url = [NSURL fileURLWithPath:path];

    // Remove existing file if present
    [[NSFileManager defaultManager] removeItemAtURL:url error:nil];

    AVAssetWriter *writer = [[AVAssetWriter alloc] initWithURL:url
                                                      fileType:AVFileTypeAppleM4A
                                                         error:&error];
    if (error) {
        lastError = [error localizedDescription];
        return nil;
    }

    NSDictionary *settings = @{
        AVFormatIDKey: @(kAudioFormatMPEG4AAC),
        AVSampleRateKey: @48000,
        AVNumberOfChannelsKey: @2,
        AVEncoderBitRateKey: @128000,
    };

    AVAssetWriterInput *input = [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeAudio
                                                                  outputSettings:settings];
    input.expectsMediaDataInRealTime = YES;

    if ([writer canAddInput:input]) {
        [writer addInput:input];
    } else {
        lastError = @"Cannot add audio input to writer";
        return nil;
    }

    *inputOut = input;
    return writer;
}

// ── Public API ────────────────────────────────────────────────

int RecorderStart(const char *systemPath, const char *micPath) {
    if (isActive) return -1;

    lastError = @"";
    systemSessionStarted = NO;
    micSessionStarted = NO;
    systemLevel = 0.0f;
    micLevel = 0.0f;

    // Request microphone permission (macOS shows dialog on first call)
    if (@available(macOS 14.0, *)) {
        dispatch_semaphore_t micSem = dispatch_semaphore_create(0);
        [AVCaptureDevice requestAccessForMediaType:AVMediaTypeAudio completionHandler:^(BOOL granted) {
            if (!granted) {
                lastError = @"Microphone permission denied";
            }
            dispatch_semaphore_signal(micSem);
        }];
        dispatch_semaphore_wait(micSem, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));
    }

    NSString *sysPathStr = [NSString stringWithUTF8String:systemPath];
    NSString *micPathStr = [NSString stringWithUTF8String:micPath];

    // Create writers
    systemWriter = createWriter(sysPathStr, &systemInput);
    if (!systemWriter) return -2;

    micWriter = createWriter(micPathStr, &micInput);
    if (!micWriter) return -3;

    // Create capture queue
    captureQueue = dispatch_queue_create("com.notes.meeting.capture", DISPATCH_QUEUE_SERIAL);

    // Get shareable content and start stream
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    __block int result = 0;

    [SCShareableContent getShareableContentWithCompletionHandler:^(SCShareableContent *content, NSError *error) {
        if (error || content.displays.count == 0) {
            lastError = error ? [error localizedDescription] : @"No displays found";
            result = -4;
            dispatch_semaphore_signal(sem);
            return;
        }

        // Use first display for content filter (required even for audio-only)
        SCDisplay *display = content.displays.firstObject;
        SCContentFilter *filter = [[SCContentFilter alloc] initWithDisplay:display
                                                          excludingWindows:@[]];

        // Configure for audio-only capture
        SCStreamConfiguration *config = [[SCStreamConfiguration alloc] init];
        config.capturesAudio = YES;
        config.excludesCurrentProcessAudio = YES;
        config.sampleRate = 48000;
        config.channelCount = 2;

        // Microphone capture (macOS 15+)
        if (@available(macOS 15.0, *)) {
            config.captureMicrophone = YES;
            // Use default microphone
            AVCaptureDevice *defaultMic = [AVCaptureDevice defaultDeviceWithMediaType:AVMediaTypeAudio];
            if (defaultMic) {
                config.microphoneCaptureDeviceID = defaultMic.uniqueID;
            }
        }

        // Minimize video overhead (required by SCStream but we only want audio)
        config.width = 2;
        config.height = 2;
        config.minimumFrameInterval = CMTimeMake(1, 1); // 1 fps

        activeStream = [[SCStream alloc] initWithFilter:filter configuration:config delegate:nil];

        // Create output delegate
        streamOutput = [[NotesAudioStreamOutput alloc] init];

        NSError *addError = nil;
        // Add system audio output
        [activeStream addStreamOutput:streamOutput type:SCStreamOutputTypeAudio
                   sampleHandlerQueue:captureQueue error:&addError];
        if (addError) {
            lastError = [addError localizedDescription];
            result = -5;
            dispatch_semaphore_signal(sem);
            return;
        }

        // Add microphone output (macOS 15+)
        if (@available(macOS 15.0, *)) {
            [activeStream addStreamOutput:streamOutput type:SCStreamOutputTypeMicrophone
                       sampleHandlerQueue:captureQueue error:&addError];
            if (addError) {
                lastError = [addError localizedDescription];
                result = -6;
                dispatch_semaphore_signal(sem);
                return;
            }
        }

        // Start writers
        [systemWriter startWriting];
        [micWriter startWriting];

        // Start capture
        [activeStream startCaptureWithCompletionHandler:^(NSError *startError) {
            if (startError) {
                lastError = [startError localizedDescription];
                result = -7;
            } else {
                isActive = YES;
            }
            dispatch_semaphore_signal(sem);
        }];
    }];

    dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));
    return result;
}

int RecorderStop(void) {
    if (!isActive) return -1;

    isActive = NO;

    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    __block int result = 0;

    [activeStream stopCaptureWithCompletionHandler:^(NSError *error) {
        if (error) {
            lastError = [error localizedDescription];
            result = -1;
        }

        // Finalize writers on capture queue to ensure all buffers are flushed
        dispatch_async(captureQueue, ^{
            dispatch_group_t group = dispatch_group_create();

            if (systemWriter.status == AVAssetWriterStatusWriting) {
                [systemInput markAsFinished];
                dispatch_group_enter(group);
                [systemWriter finishWritingWithCompletionHandler:^{
                    dispatch_group_leave(group);
                }];
            }

            if (micWriter.status == AVAssetWriterStatusWriting) {
                [micInput markAsFinished];
                dispatch_group_enter(group);
                [micWriter finishWritingWithCompletionHandler:^{
                    dispatch_group_leave(group);
                }];
            }

            dispatch_group_wait(group, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC));

            // Cleanup
            activeStream = nil;
            streamOutput = nil;
            systemWriter = nil;
            micWriter = nil;
            systemInput = nil;
            micInput = nil;
            systemLevel = 0.0f;
            micLevel = 0.0f;

            dispatch_semaphore_signal(sem);
        });
    }];

    dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));
    return result;
}

bool RecorderIsActive(void) {
    return isActive;
}

float RecorderGetSystemLevel(void) {
    return systemLevel;
}

float RecorderGetMicLevel(void) {
    return micLevel;
}

const char *RecorderGetError(void) {
    return [lastError UTF8String];
}
