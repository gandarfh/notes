package storage

import (
	"encoding/json"
	"fmt"
	"time"

	"notes/internal/domain"
)

// MeetingStore implements domain.MeetingStore using SQLite.
type MeetingStore struct {
	db *DB
}

func NewMeetingStore(db *DB) *MeetingStore {
	return &MeetingStore{db: db}
}

func (s *MeetingStore) Insert(m *domain.Meeting) error {
	now := time.Now()
	m.CreatedAt = now
	m.UpdatedAt = now

	participantsJSON, err := json.Marshal(m.Participants)
	if err != nil {
		return fmt.Errorf("marshal participants: %w", err)
	}

	_, err = s.db.Conn().Exec(
		`INSERT INTO meetings (id, page_id, notebook_id, title, date, duration,
			participants_json, audio_path, transcript_json, analysis_json,
			refinement_chat_json, status, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		m.ID, m.PageID, m.NotebookID, m.Title, m.Date, m.Duration,
		string(participantsJSON), m.AudioPath, m.TranscriptJSON, m.AnalysisJSON,
		m.RefinementChat, m.Status, m.CreatedAt, m.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("insert meeting: %w", err)
	}
	return nil
}

func (s *MeetingStore) Update(m *domain.Meeting) error {
	m.UpdatedAt = time.Now()

	participantsJSON, err := json.Marshal(m.Participants)
	if err != nil {
		return fmt.Errorf("marshal participants: %w", err)
	}

	_, err = s.db.Conn().Exec(
		`UPDATE meetings SET
			page_id = ?, notebook_id = ?, title = ?, date = ?, duration = ?,
			participants_json = ?, audio_path = ?, transcript_json = ?,
			analysis_json = ?, refinement_chat_json = ?, status = ?,
			updated_at = ?
		WHERE id = ?`,
		m.PageID, m.NotebookID, m.Title, m.Date, m.Duration,
		string(participantsJSON), m.AudioPath, m.TranscriptJSON,
		m.AnalysisJSON, m.RefinementChat, m.Status,
		m.UpdatedAt, m.ID,
	)
	if err != nil {
		return fmt.Errorf("update meeting: %w", err)
	}
	return nil
}

func (s *MeetingStore) GetByID(id string) (*domain.Meeting, error) {
	m := &domain.Meeting{}
	var participantsJSON string

	err := s.db.Conn().QueryRow(
		`SELECT id, page_id, notebook_id, title, date, duration,
			participants_json, audio_path, transcript_json, analysis_json,
			refinement_chat_json, status, created_at, updated_at
		FROM meetings WHERE id = ?`, id,
	).Scan(
		&m.ID, &m.PageID, &m.NotebookID, &m.Title, &m.Date, &m.Duration,
		&participantsJSON, &m.AudioPath, &m.TranscriptJSON, &m.AnalysisJSON,
		&m.RefinementChat, &m.Status, &m.CreatedAt, &m.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("get meeting: %w", err)
	}

	if err := json.Unmarshal([]byte(participantsJSON), &m.Participants); err != nil {
		m.Participants = []string{}
	}
	return m, nil
}

func (s *MeetingStore) ListByDate(date string) ([]*domain.Meeting, error) {
	rows, err := s.db.Conn().Query(
		`SELECT id, page_id, notebook_id, title, date, duration,
			participants_json, audio_path, transcript_json, analysis_json,
			refinement_chat_json, status, created_at, updated_at
		FROM meetings
		WHERE date(date) = ?
		ORDER BY date DESC`, date,
	)
	if err != nil {
		return nil, fmt.Errorf("list meetings: %w", err)
	}
	defer rows.Close()

	var meetings []*domain.Meeting
	for rows.Next() {
		m := &domain.Meeting{}
		var participantsJSON string
		if err := rows.Scan(
			&m.ID, &m.PageID, &m.NotebookID, &m.Title, &m.Date, &m.Duration,
			&participantsJSON, &m.AudioPath, &m.TranscriptJSON, &m.AnalysisJSON,
			&m.RefinementChat, &m.Status, &m.CreatedAt, &m.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan meeting: %w", err)
		}
		if err := json.Unmarshal([]byte(participantsJSON), &m.Participants); err != nil {
			m.Participants = []string{}
		}
		meetings = append(meetings, m)
	}
	return meetings, rows.Err()
}

func (s *MeetingStore) GetByPageID(pageID string) (*domain.Meeting, error) {
	m := &domain.Meeting{}
	var participantsJSON string

	err := s.db.Conn().QueryRow(
		`SELECT id, page_id, notebook_id, title, date, duration,
			participants_json, audio_path, transcript_json, analysis_json,
			refinement_chat_json, status, created_at, updated_at
		FROM meetings WHERE page_id = ?`, pageID,
	).Scan(
		&m.ID, &m.PageID, &m.NotebookID, &m.Title, &m.Date, &m.Duration,
		&participantsJSON, &m.AudioPath, &m.TranscriptJSON, &m.AnalysisJSON,
		&m.RefinementChat, &m.Status, &m.CreatedAt, &m.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("get meeting by page: %w", err)
	}

	if err := json.Unmarshal([]byte(participantsJSON), &m.Participants); err != nil {
		m.Participants = []string{}
	}
	return m, nil
}
