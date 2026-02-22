package secret

// SecretStore provides a pluggable interface for storing sensitive data
// such as database passwords. The initial implementation uses macOS Keychain,
// but can be swapped for Vault, env vars, etc.
type SecretStore interface {
	// Set stores a secret value under the given key.
	Set(key string, value []byte) error

	// Get retrieves the secret value for the given key.
	// Returns empty slice and nil error if key does not exist.
	Get(key string) ([]byte, error)

	// Delete removes the secret for the given key.
	Delete(key string) error
}
