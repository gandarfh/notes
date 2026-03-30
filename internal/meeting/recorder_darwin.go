//go:build darwin

package meeting

/*
#cgo CFLAGS: -x objective-c -mmacosx-version-min=15.0
#cgo LDFLAGS: -framework Foundation -framework ScreenCaptureKit -framework AVFoundation -framework CoreMedia -framework CoreAudio -framework AudioToolbox -framework CoreGraphics

#include "recorder_darwin.h"
*/
import "C"

import (
	"fmt"
	"os"
	"sync"
	"time"

	"notes/internal/domain"
)

// DarwinRecorder implements Recorder using ScreenCaptureKit + AVFoundation on macOS.
type DarwinRecorder struct {
	mu         sync.Mutex
	recording  bool
	meetingID  string
	title      string
	systemPath string
	micPath    string
	startedAt  time.Time
	lastError  string
}

func NewRecorder() Recorder {
	return &DarwinRecorder{}
}

func (r *DarwinRecorder) Start(systemPath, micPath string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.recording {
		return fmt.Errorf("already recording")
	}

	result := C.RecorderStart(C.CString(systemPath), C.CString(micPath))
	if result != 0 {
		errMsg := C.GoString(C.RecorderGetError())
		r.lastError = errMsg
		return fmt.Errorf("recorder start failed (code %d): %s", int(result), errMsg)
	}

	r.recording = true
	r.systemPath = systemPath
	r.micPath = micPath
	r.startedAt = time.Now()
	r.lastError = ""
	return nil
}

func (r *DarwinRecorder) Stop() (string, string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if !r.recording {
		return "", "", fmt.Errorf("not recording")
	}

	result := C.RecorderStop()
	r.recording = false

	if result != 0 {
		errMsg := C.GoString(C.RecorderGetError())
		r.lastError = errMsg
		return "", "", fmt.Errorf("recorder stop failed (code %d): %s", int(result), errMsg)
	}

	return r.systemPath, r.micPath, nil
}

func (r *DarwinRecorder) Status() domain.RecordingStatus {
	r.mu.Lock()
	defer r.mu.Unlock()

	if !r.recording {
		errStr := r.lastError
		return domain.RecordingStatus{
			Active: false,
			Error:  errStr,
		}
	}

	elapsed := int(time.Since(r.startedAt).Seconds())

	// File size: sum both output files
	var totalSize float64
	if info, err := os.Stat(r.systemPath); err == nil {
		totalSize += float64(info.Size()) / (1024 * 1024)
	}
	if info, err := os.Stat(r.micPath); err == nil {
		totalSize += float64(info.Size()) / (1024 * 1024)
	}

	// Audio levels from ObjC
	sysLevel := float64(C.RecorderGetSystemLevel())
	micLvl := float64(C.RecorderGetMicLevel())
	// Use the higher level for the combined indicator
	audioLevel := sysLevel
	if micLvl > audioLevel {
		audioLevel = micLvl
	}

	// Check for errors from ObjC side
	errMsg := C.GoString(C.RecorderGetError())

	return domain.RecordingStatus{
		Active:      true,
		MeetingID:   r.meetingID,
		Title:       r.title,
		StartedAt:   r.startedAt,
		ElapsedSecs: elapsed,
		AudioLevel:  audioLevel,
		FileSizeMB:  totalSize,
		Error:       errMsg,
	}
}

func (r *DarwinRecorder) IsRecording() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.recording
}

// SetMeetingInfo stores meeting metadata for status reporting.
func (r *DarwinRecorder) SetMeetingInfo(meetingID, title string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.meetingID = meetingID
	r.title = title
}
