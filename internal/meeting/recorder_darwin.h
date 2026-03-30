#ifndef RECORDER_DARWIN_H
#define RECORDER_DARWIN_H

#include <stdbool.h>

// StartRecording begins capturing system audio and microphone.
// systemPath: output path for system audio M4A file.
// micPath: output path for microphone M4A file.
// Returns 0 on success, non-zero on error.
int RecorderStart(const char *systemPath, const char *micPath);

// StopRecording stops the active recording session.
// Returns 0 on success, non-zero on error.
int RecorderStop(void);

// RecorderIsActive returns true if a recording session is active.
bool RecorderIsActive(void);

// RecorderGetSystemLevel returns the current system audio RMS level (0.0–1.0).
float RecorderGetSystemLevel(void);

// RecorderGetMicLevel returns the current microphone RMS level (0.0–1.0).
float RecorderGetMicLevel(void);

// RecorderGetError returns the last error message, or empty string.
const char *RecorderGetError(void);

#endif /* RECORDER_DARWIN_H */
