package meeting

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"

	"notes/internal/domain"
)

// Transcriber wraps whisper.cpp for audio transcription.
type Transcriber struct {
	binaryPath string // path to whisper-cli binary
	modelPath  string // path to the .bin model file
	language   string // language hint: "pt", "es", "auto"
}

// NewTranscriber creates a Transcriber.
func NewTranscriber(binaryPath, modelPath, language string) *Transcriber {
	return &Transcriber{
		binaryPath: binaryPath,
		modelPath:  modelPath,
		language:   language,
	}
}

// Transcribe runs whisper.cpp on an audio file and returns transcript segments.
// Automatically converts M4A/AAC to WAV since whisper.cpp only supports wav/mp3/ogg/flac.
func (t *Transcriber) Transcribe(ctx context.Context, audioPath string) ([]domain.TranscriptSegment, error) {
	if _, err := os.Stat(audioPath); os.IsNotExist(err) {
		return nil, fmt.Errorf("audio file not found: %s", audioPath)
	}

	if _, err := exec.LookPath(t.binaryPath); err != nil {
		return nil, fmt.Errorf("whisper binary not found at %q: %w", t.binaryPath, err)
	}

	// Create temp dir for conversion and output
	tmpDir, err := os.MkdirTemp("", "whisper-*")
	if err != nil {
		return nil, fmt.Errorf("create temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	// Convert M4A → WAV if needed (whisper.cpp doesn't support M4A)
	inputPath := audioPath
	ext := strings.ToLower(filepath.Ext(audioPath))
	if ext == ".m4a" || ext == ".aac" || ext == ".mp4" {
		wavPath := filepath.Join(tmpDir, "audio.wav")
		// Use macOS native afconvert (no ffmpeg dependency)
		conv := exec.CommandContext(ctx, "afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", audioPath, wavPath)
		if out, err := conv.CombinedOutput(); err != nil {
			return nil, fmt.Errorf("convert to wav: %w\noutput: %s", err, string(out))
		}
		inputPath = wavPath
	}

	outputBase := filepath.Join(tmpDir, "output")

	// Build whisper.cpp command
	args := []string{
		"-m", t.modelPath,
		"-f", inputPath,
		"-l", t.language,
		"--output-json",
		"-of", outputBase,
		"--no-prints",
	}

	cmd := exec.CommandContext(ctx, t.binaryPath, args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("whisper failed: %w\noutput: %s", err, string(output))
	}

	// Read JSON output (whisper appends .json to the output path)
	jsonPath := outputBase + ".json"
	data, err := os.ReadFile(jsonPath)
	if err != nil {
		return nil, fmt.Errorf("read whisper output: %w", err)
	}

	var whisperOutput whisperJSON
	if err := json.Unmarshal(data, &whisperOutput); err != nil {
		return nil, fmt.Errorf("parse whisper JSON: %w", err)
	}

	segments := make([]domain.TranscriptSegment, 0, len(whisperOutput.Transcription))
	for _, seg := range whisperOutput.Transcription {
		text := strings.TrimSpace(seg.Text)
		if text == "" {
			continue
		}
		segments = append(segments, domain.TranscriptSegment{
			Text:      text,
			StartTime: timeToSeconds(seg.Timestamps.From),
			EndTime:   timeToSeconds(seg.Timestamps.To),
		})
	}

	return segments, nil
}

// TranscribeDualTrack transcribes system and mic audio separately,
// tags speakers, and merges by timestamp.
func (t *Transcriber) TranscribeDualTrack(ctx context.Context, systemPath, micPath string) ([]domain.TranscriptSegment, error) {
	var systemSegments, micSegments []domain.TranscriptSegment

	// Transcribe system audio (other participants)
	if hasAudioContent(systemPath) {
		segs, err := t.Transcribe(ctx, systemPath)
		if err != nil {
			return nil, fmt.Errorf("transcribe system audio: %w", err)
		}
		for i := range segs {
			segs[i].Speaker = "outros"
		}
		systemSegments = segs
	}

	// Transcribe mic audio (user)
	if hasAudioContent(micPath) {
		segs, err := t.Transcribe(ctx, micPath)
		if err != nil {
			return nil, fmt.Errorf("transcribe mic audio: %w", err)
		}
		for i := range segs {
			segs[i].Speaker = "eu"
		}
		micSegments = segs
	}

	// Merge and sort by start time
	all := append(systemSegments, micSegments...)
	sort.Slice(all, func(i, j int) bool {
		return all[i].StartTime < all[j].StartTime
	})

	return all, nil
}

// hasAudioContent returns true if the file exists and is not empty.
func hasAudioContent(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return info.Size() > 0
}

// ── whisper.cpp JSON output types ─────────────────────────────

type whisperJSON struct {
	Transcription []whisperSegment `json:"transcription"`
}

type whisperSegment struct {
	Timestamps whisperTimestamps `json:"timestamps"`
	Text       string            `json:"text"`
}

type whisperTimestamps struct {
	From string `json:"from"`
	To   string `json:"to"`
}

// timeToSeconds converts "HH:MM:SS.mmm" to seconds as float64.
func timeToSeconds(ts string) float64 {
	// Format: "00:00:05.320" or "00:05.320"
	parts := strings.Split(ts, ":")
	var hours, minutes, seconds float64
	switch len(parts) {
	case 3:
		fmt.Sscanf(parts[0], "%f", &hours)
		fmt.Sscanf(parts[1], "%f", &minutes)
		fmt.Sscanf(parts[2], "%f", &seconds)
	case 2:
		fmt.Sscanf(parts[0], "%f", &minutes)
		fmt.Sscanf(parts[1], "%f", &seconds)
	default:
		fmt.Sscanf(ts, "%f", &seconds)
	}
	return hours*3600 + minutes*60 + seconds
}
