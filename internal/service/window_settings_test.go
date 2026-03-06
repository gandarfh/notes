package service

import (
	"testing"

	"notes/internal/testutil"
)

func TestWindowSettingsService_DefaultsWithNilDB(t *testing.T) {
	svc := NewWindowSettingsService(nil)
	size := svc.LoadWindowSize()

	if size.Width != 1280 {
		t.Errorf("width = %d, want 1280", size.Width)
	}
	if size.Height != 800 {
		t.Errorf("height = %d, want 800", size.Height)
	}
}

func TestWindowSettingsService_SaveAndLoad(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewWindowSettingsService(db)

	// LoadWindowSize creates the app_settings table lazily
	svc.LoadWindowSize()

	if err := svc.SaveWindowSize(1920, 1080); err != nil {
		t.Fatalf("save: %v", err)
	}

	size := svc.LoadWindowSize()
	if size.Width != 1920 {
		t.Errorf("width = %d, want 1920", size.Width)
	}
	if size.Height != 1080 {
		t.Errorf("height = %d, want 1080", size.Height)
	}
}

func TestWindowSettingsService_SaveOverwrite(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewWindowSettingsService(db)

	svc.LoadWindowSize() // creates table
	svc.SaveWindowSize(1920, 1080)
	svc.SaveWindowSize(2560, 1440)

	size := svc.LoadWindowSize()
	if size.Width != 2560 {
		t.Errorf("width = %d, want 2560", size.Width)
	}
	if size.Height != 1440 {
		t.Errorf("height = %d, want 1440", size.Height)
	}
}

func TestWindowSettingsService_MinimumSize(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewWindowSettingsService(db)

	svc.LoadWindowSize() // creates table
	// Save values below minimum
	svc.SaveWindowSize(400, 300)

	size := svc.LoadWindowSize()
	// Should enforce minimums: width >= 800 → defaults to 1280, height >= 600 → defaults to 800
	if size.Width < 800 {
		t.Errorf("width = %d, should be >= 800", size.Width)
	}
	if size.Height < 600 {
		t.Errorf("height = %d, should be >= 600", size.Height)
	}
}

func TestWindowSettingsService_LoadDefaults(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewWindowSettingsService(db)

	// First load without saving — should return defaults
	size := svc.LoadWindowSize()
	if size.Width != 1280 {
		t.Errorf("width = %d, want 1280", size.Width)
	}
	if size.Height != 800 {
		t.Errorf("height = %d, want 800", size.Height)
	}
}

func TestWindowSettingsService_SaveWithNilDB(t *testing.T) {
	svc := NewWindowSettingsService(nil)

	err := svc.SaveWindowSize(1920, 1080)
	if err == nil {
		t.Fatal("expected error with nil DB")
	}
}
