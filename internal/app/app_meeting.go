package app

// ─────────────────────────────────────────────────────────────
// Meeting Recording Handlers — thin delegates to MeetingService
// ─────────────────────────────────────────────────────────────

import "notes/internal/domain"

func (a *App) StartMeetingRecording(title string, participants []string) error {
	return a.meeting.StartRecording(title, participants)
}

func (a *App) StopMeetingRecording() (*domain.Meeting, error) {
	return a.meeting.StopRecording()
}

func (a *App) GetRecordingStatus() *domain.RecordingStatus {
	return a.meeting.GetRecordingStatus()
}

func (a *App) GetMeeting(meetingID string) (*domain.Meeting, error) {
	return a.meeting.GetMeeting(meetingID)
}

func (a *App) ListMeetings(date string) ([]*domain.Meeting, error) {
	return a.meeting.ListMeetings(date)
}

func (a *App) RefineMeetingNote(meetingID, message string) (string, error) {
	return a.meeting.RefineMeetingNote(meetingID, message)
}

func (a *App) GetMeetingRefinementChat(meetingID string) ([]domain.ChatMessage, error) {
	return a.meeting.GetMeetingRefinementChat(meetingID)
}

func (a *App) GetMeetingByPageID(pageID string) (*domain.Meeting, error) {
	return a.meeting.GetMeetingByPageID(pageID)
}
