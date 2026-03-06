package storage

import (
	"testing"

	"notes/internal/domain"
)

func newDBConnectionStore(t *testing.T) *DBConnectionStore {
	t.Helper()
	return NewDBConnectionStore(newTestDB(t))
}

func TestDBConnectionStore_CreateAndGet(t *testing.T) {
	s := newDBConnectionStore(t)

	c := &domain.DatabaseConnection{
		ID:        "conn-1",
		Name:      "My Postgres",
		Driver:    domain.DatabaseDriverPostgres,
		Host:      "localhost",
		Port:      5432,
		Database:  "mydb",
		Username:  "user",
		SSLMode:   "disable",
		ExtraJSON: "{}",
	}
	if err := s.CreateConnection(c); err != nil {
		t.Fatalf("create: %v", err)
	}

	if c.CreatedAt.IsZero() {
		t.Error("CreatedAt not set")
	}

	got, err := s.GetConnection("conn-1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Name != "My Postgres" {
		t.Errorf("name = %q", got.Name)
	}
	if got.Driver != domain.DatabaseDriverPostgres {
		t.Errorf("driver = %v", got.Driver)
	}
	if got.Host != "localhost" {
		t.Errorf("host = %q", got.Host)
	}
	if got.Port != 5432 {
		t.Errorf("port = %d", got.Port)
	}
	if got.Database != "mydb" {
		t.Errorf("database = %q", got.Database)
	}
}

func TestDBConnectionStore_GetNotFound(t *testing.T) {
	s := newDBConnectionStore(t)
	_, err := s.GetConnection("nonexistent")
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestDBConnectionStore_ListConnections(t *testing.T) {
	s := newDBConnectionStore(t)

	// Create in non-alphabetical order
	for _, name := range []string{"Charlie", "Alpha", "Bravo"} {
		c := &domain.DatabaseConnection{
			ID: name, Name: name, Driver: domain.DatabaseDriverSQLite, ExtraJSON: "{}",
		}
		s.CreateConnection(c)
	}

	list, err := s.ListConnections()
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 3 {
		t.Fatalf("len = %d, want 3", len(list))
	}

	// Should be ordered by name
	if list[0].Name != "Alpha" || list[1].Name != "Bravo" || list[2].Name != "Charlie" {
		t.Errorf("not sorted by name: %q, %q, %q", list[0].Name, list[1].Name, list[2].Name)
	}
}

func TestDBConnectionStore_UpdateConnection(t *testing.T) {
	s := newDBConnectionStore(t)

	c := &domain.DatabaseConnection{
		ID: "conn-1", Name: "Old", Driver: domain.DatabaseDriverMySQL,
		Host: "old-host", Port: 3306, ExtraJSON: "{}",
	}
	s.CreateConnection(c)

	c.Name = "New"
	c.Host = "new-host"
	c.Port = 3307
	c.Driver = domain.DatabaseDriverPostgres
	if err := s.UpdateConnection(c); err != nil {
		t.Fatalf("update: %v", err)
	}

	got, _ := s.GetConnection("conn-1")
	if got.Name != "New" {
		t.Errorf("name = %q", got.Name)
	}
	if got.Host != "new-host" {
		t.Errorf("host = %q", got.Host)
	}
	if got.Port != 3307 {
		t.Errorf("port = %d", got.Port)
	}
}

func TestDBConnectionStore_DeleteConnection(t *testing.T) {
	s := newDBConnectionStore(t)

	c := &domain.DatabaseConnection{ID: "conn-1", Name: "Test", Driver: domain.DatabaseDriverSQLite, ExtraJSON: "{}"}
	s.CreateConnection(c)

	if err := s.DeleteConnection("conn-1"); err != nil {
		t.Fatalf("delete: %v", err)
	}

	_, err := s.GetConnection("conn-1")
	if err == nil {
		t.Fatal("expected error after delete")
	}
}
