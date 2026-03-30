package domain

import "time"

// ── Meeting Status Constants ──────────────────────────────────

const (
	MeetingStatusRecording   = "recording"
	MeetingStatusTranscribing = "transcribing"
	MeetingStatusAnalyzing   = "analyzing"
	MeetingStatusGenerating   = "generating"
	MeetingStatusReady        = "ready"
	MeetingStatusError       = "error"
)

// ── Core Types ────────────────────────────────────────────────

type Meeting struct {
	ID               string    `json:"id"`
	PageID           string    `json:"pageId"`
	NotebookID       string    `json:"notebookId"`
	Title            string    `json:"title"`
	Date             time.Time `json:"date"`
	Duration         string    `json:"duration"`
	Participants     []string  `json:"participants"`
	AudioPath        string    `json:"audioPath"`
	TranscriptJSON   string    `json:"transcriptJson"`
	AnalysisJSON     string    `json:"analysisJson"`
	RefinementChat   string    `json:"refinementChat"`
	Status           string    `json:"status"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

type RecordingStatus struct {
	Active     bool      `json:"active"`
	MeetingID  string    `json:"meetingId"`
	Title      string    `json:"title"`
	StartedAt  time.Time `json:"startedAt"`
	ElapsedSecs int     `json:"elapsedSecs"`
	AudioLevel float64   `json:"audioLevel"`
	FileSizeMB float64   `json:"fileSizeMb"`
	Error      string    `json:"error,omitempty"`
}

// ── Transcript Types ──────────────────────────────────────────

type TranscriptSegment struct {
	Speaker   string  `json:"speaker"`
	Text      string  `json:"text"`
	StartTime float64 `json:"startTime"`
	EndTime   float64 `json:"endTime"`
}

// ── Analysis Types (populated in Phase 2) ─────────────────────

type MeetingAnalysis struct {
	Title           string              `json:"title"`
	Date            string              `json:"date"`
	Duration        string              `json:"duration"`
	Participants    []string            `json:"participants"`
	Summary         string              `json:"summary"`
	KeyDecisions    []Decision          `json:"key_decisions"`
	ActionItems     []ActionItem        `json:"action_items"`
	MyCommitments   []Commitment        `json:"my_commitments"`
	FollowUps       []FollowUp          `json:"follow_ups"`
	TopicsDiscussed []string            `json:"topics_discussed"`
	MyParticipation Participation       `json:"my_participation"`
	Transcript      []TranscriptSegment `json:"transcript"`
}

type ActionItem struct {
	Text        string `json:"text"`
	Assignee    string `json:"assignee"`
	Due         string `json:"due"`
	DueSource   string `json:"due_source"`
	Confidence  string `json:"confidence"`
	SourceQuote string `json:"source_quote"`
}

type FollowUp struct {
	Person  string `json:"person"`
	Topic   string `json:"topic"`
	Context string `json:"context"`
}

type Decision struct {
	Text    string `json:"text"`
	Context string `json:"context"`
}

type Commitment struct {
	Text        string `json:"text"`
	ToWhom      string `json:"to_whom"`
	Due         string `json:"due"`
	SourceQuote string `json:"source_quote"`
}

type Participation struct {
	Spoke         bool     `json:"spoke"`
	TopicsRaised  []string `json:"topics_i_raised"`
	OpinionsGiven []string `json:"opinions_i_gave"`
}

// ── Chat Types ────────────────────────────────────────────────

type ChatMessage struct {
	Role    string `json:"role"`    // "user" or "assistant"
	Content string `json:"content"`
}

type RefinementChatData struct {
	SessionID string        `json:"session_id"`
	Messages  []ChatMessage `json:"messages"`
}

// ── Store Interface ───────────────────────────────────────────

type MeetingStore interface {
	Insert(m *Meeting) error
	Update(m *Meeting) error
	GetByID(id string) (*Meeting, error)
	ListByDate(date string) ([]*Meeting, error)
}
