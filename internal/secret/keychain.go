package secret

import (
	"fmt"
	"os/exec"
	"strings"
)

const keychainService = "notes-db-plugin"

// KeychainStore implements SecretStore using the macOS Keychain
// via the `security` CLI tool.
type KeychainStore struct{}

// NewKeychainStore creates a new KeychainStore.
func NewKeychainStore() *KeychainStore {
	return &KeychainStore{}
}

// Set stores a secret in the macOS Keychain.
// If the key already exists, it updates the value.
func (k *KeychainStore) Set(key string, value []byte) error {
	// Try to delete existing entry first (ignore errors if it doesn't exist)
	k.Delete(key)

	cmd := exec.Command("security", "add-generic-password",
		"-a", key,
		"-s", keychainService,
		"-w", string(value),
		"-U", // update if exists
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("keychain set: %s: %w", strings.TrimSpace(string(out)), err)
	}
	return nil
}

// Get retrieves a secret from the macOS Keychain.
// Returns empty slice and nil error if the key doesn't exist.
func (k *KeychainStore) Get(key string) ([]byte, error) {
	cmd := exec.Command("security", "find-generic-password",
		"-a", key,
		"-s", keychainService,
		"-w", // output only the password
	)
	out, err := cmd.Output()
	if err != nil {
		// "security" returns exit code 44 when item not found
		if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == 44 {
			return nil, nil
		}
		return nil, nil // treat any error as "not found" for resilience
	}
	return []byte(strings.TrimSpace(string(out))), nil
}

// Delete removes a secret from the macOS Keychain.
func (k *KeychainStore) Delete(key string) error {
	cmd := exec.Command("security", "delete-generic-password",
		"-a", key,
		"-s", keychainService,
	)
	cmd.Run() // ignore errors — item may not exist
	return nil
}
