package meeting

import (
	"notes/internal/domain"
)

// Recorder captures system audio and microphone on macOS.
// Platform-specific implementation in recorder_darwin.go.
type Recorder interface {
	// Start begins recording system audio and microphone to separate files.
	Start(systemPath, micPath string) error

	// Stop ends the recording and returns the paths to the audio files.
	Stop() (systemAudioPath string, micAudioPath string, err error)

	// Status returns the current recording status.
	Status() domain.RecordingStatus

	// IsRecording returns true if a recording session is active.
	IsRecording() bool

	// SetMeetingInfo stores meeting metadata for status reporting.
	SetMeetingInfo(meetingID, title string)
}
