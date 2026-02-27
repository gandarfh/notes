package service

import (
	"database/sql"
	"fmt"

	"notes/internal/storage"
)

// ─────────────────────────────────────────────────────────────
// Window Size Persistence
// ─────────────────────────────────────────────────────────────
//
// Saves and restores the main Wails window size between sessions.
// Stored in SQLite as a simple key-value row in app_settings.
//
// The app_settings table is created via the storage layer migration.

// WindowSize holds the saved window dimensions.
type WindowSize struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

// WindowSettingsService persists window size between sessions.
type WindowSettingsService struct {
	db *storage.DB
}

// NewWindowSettingsService creates a WindowSettingsService.
func NewWindowSettingsService(db *storage.DB) *WindowSettingsService {
	return &WindowSettingsService{db: db}
}

const (
	settingWindowWidth  = "window_width"
	settingWindowHeight = "window_height"
	defaultWindowWidth  = 1280
	defaultWindowHeight = 800
)

// LoadWindowSize returns the saved window dimensions, or sensible defaults.
func (s *WindowSettingsService) LoadWindowSize() WindowSize {
	if s.db == nil {
		return WindowSize{Width: defaultWindowWidth, Height: defaultWindowHeight}
	}
	conn := s.db.Conn()
	// Try to create settings table (idempotent)
	conn.Exec(`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')`)

	w := defaultWindowWidth
	h := defaultWindowHeight
	row := conn.QueryRow(`SELECT value FROM app_settings WHERE key = ?`, settingWindowWidth)
	row.Scan(&w)
	row = conn.QueryRow(`SELECT value FROM app_settings WHERE key = ?`, settingWindowHeight)
	row.Scan(&h)

	if w < 800 {
		w = defaultWindowWidth
	}
	if h < 600 {
		h = defaultWindowHeight
	}
	return WindowSize{Width: w, Height: h}
}

// SaveWindowSize persists the current window dimensions.
func (s *WindowSettingsService) SaveWindowSize(width, height int) error {
	if s.db == nil {
		return fmt.Errorf("window settings: no db")
	}
	conn := s.db.Conn()
	if err := upsertSetting(conn, settingWindowWidth, width); err != nil {
		return err
	}
	return upsertSetting(conn, settingWindowHeight, height)
}

func upsertSetting(conn *sql.DB, key string, value int) error {
	_, err := conn.Exec(
		`INSERT INTO app_settings (key, value) VALUES (?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
		key, value,
	)
	return err
}
