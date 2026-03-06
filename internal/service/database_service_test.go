package service

import (
	"testing"

	"notes/internal/storage"
	"notes/internal/testutil"
)

// mockSecretStore is a simple in-memory secret store for testing.
type mockSecretStore struct {
	secrets map[string][]byte
}

func newMockSecretStore() *mockSecretStore {
	return &mockSecretStore{secrets: make(map[string][]byte)}
}

func (m *mockSecretStore) Set(key string, value []byte) error {
	m.secrets[key] = value
	return nil
}

func (m *mockSecretStore) Get(key string) ([]byte, error) {
	return m.secrets[key], nil
}

func (m *mockSecretStore) Delete(key string) error {
	delete(m.secrets, key)
	return nil
}

func newDatabaseService(t *testing.T) (*DatabaseService, *mockSecretStore) {
	t.Helper()
	db := testutil.NewTestDB(t)
	connStore := storage.NewDBConnectionStore(db)
	blockStore := storage.NewBlockStore(db)
	secrets := newMockSecretStore()
	svc := NewDatabaseService(connStore, secrets, blockStore)
	t.Cleanup(func() { svc.Close() })
	return svc, secrets
}

func TestDatabaseService_CreateConnection(t *testing.T) {
	svc, secrets := newDatabaseService(t)

	input := CreateDBConnInput{
		Name:     "My Postgres",
		Driver:   "postgres",
		Host:     "localhost",
		Port:     5432,
		Database: "mydb",
		Username: "user",
		Password: "secret123",
		SSLMode:  "disable",
	}

	conn, err := svc.CreateConnection(input)
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if conn.ID == "" {
		t.Error("ID should be set")
	}
	if conn.Name != "My Postgres" {
		t.Errorf("name = %q", conn.Name)
	}

	// Password should be stored in secrets
	pw, _ := secrets.Get("db:" + conn.ID)
	if string(pw) != "secret123" {
		t.Errorf("password = %q, want secret123", string(pw))
	}
}

func TestDatabaseService_CreateConnection_NoPassword(t *testing.T) {
	svc, secrets := newDatabaseService(t)

	input := CreateDBConnInput{
		Name:   "SQLite",
		Driver: "sqlite",
		Host:   "/tmp/test.db",
	}

	conn, err := svc.CreateConnection(input)
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// No password should be stored
	pw, _ := secrets.Get("db:" + conn.ID)
	if pw != nil {
		t.Errorf("password should be nil, got %q", string(pw))
	}
}

func TestDatabaseService_ListConnections(t *testing.T) {
	svc, _ := newDatabaseService(t)

	svc.CreateConnection(CreateDBConnInput{Name: "A", Driver: "postgres"})
	svc.CreateConnection(CreateDBConnInput{Name: "B", Driver: "mysql"})

	list, err := svc.ListConnections()
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("len = %d, want 2", len(list))
	}
}

func TestDatabaseService_UpdateConnection(t *testing.T) {
	svc, secrets := newDatabaseService(t)

	conn, _ := svc.CreateConnection(CreateDBConnInput{
		Name: "Old", Driver: "postgres", Password: "oldpw",
	})

	err := svc.UpdateConnection(conn.ID, CreateDBConnInput{
		Name: "New", Driver: "mysql", Password: "newpw",
	})
	if err != nil {
		t.Fatalf("update: %v", err)
	}

	list, _ := svc.ListConnections()
	if list[0].Name != "New" {
		t.Errorf("name = %q", list[0].Name)
	}

	// Password should be updated
	pw, _ := secrets.Get("db:" + conn.ID)
	if string(pw) != "newpw" {
		t.Errorf("password = %q, want newpw", string(pw))
	}
}

func TestDatabaseService_DeleteConnection(t *testing.T) {
	svc, secrets := newDatabaseService(t)

	conn, _ := svc.CreateConnection(CreateDBConnInput{
		Name: "Test", Driver: "postgres", Password: "pw",
	})

	if err := svc.DeleteConnection(conn.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}

	list, _ := svc.ListConnections()
	if len(list) != 0 {
		t.Errorf("len = %d, want 0", len(list))
	}

	// Password should be deleted from secrets
	pw, _ := secrets.Get("db:" + conn.ID)
	if pw != nil {
		t.Errorf("password should be nil after delete")
	}
}

func TestDatabaseService_CachedResult(t *testing.T) {
	svc, _ := newDatabaseService(t)

	// No cached result
	if result := svc.GetCachedResult("block-1"); result != nil {
		t.Error("expected nil for uncached block")
	}

	// ClearCachedResult should not panic on missing key
	svc.ClearCachedResult("block-1")
}

func TestDatabaseService_Close(t *testing.T) {
	svc, _ := newDatabaseService(t)

	// Close should not panic with no active connectors
	svc.Close()
}
