package dbclient

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"os"

	"notes/internal/domain"

	"github.com/go-sql-driver/mysql"
)

// buildMySQLDSN constructs a MySQL DSN from a DatabaseConnection.
func buildMySQLDSN(conn *domain.DatabaseConnection, password string) string {
	port := conn.Port
	if port == 0 {
		port = 3306
	}
	// Format: user:password@tcp(host:port)/dbname?parseTime=true
	dsn := fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?parseTime=true&charset=utf8mb4",
		conn.Username, password, conn.Host, port, conn.Database,
	)

	if conn.SSLMode != "require" {
		return dsn
	}

	// Parse ExtraJSON for certificate paths.
	var extras map[string]string
	if conn.ExtraJSON != "" && conn.ExtraJSON != "{}" {
		_ = json.Unmarshal([]byte(conn.ExtraJSON), &extras)
	}

	hasCerts := extras["sslRootCert"] != "" || extras["sslCert"] != ""
	if !hasCerts {
		// Simple TLS without custom certs — skip server cert verification.
		dsn += "&tls=skip-verify"
		return dsn
	}

	// Register a custom TLS config with the provided certificates.
	tlsCfg := &tls.Config{}

	if caPath := extras["sslRootCert"]; caPath != "" {
		caCert, err := os.ReadFile(caPath)
		if err == nil {
			pool := x509.NewCertPool()
			pool.AppendCertsFromPEM(caCert)
			tlsCfg.RootCAs = pool
		}
	}

	if certPath, keyPath := extras["sslCert"], extras["sslKey"]; certPath != "" && keyPath != "" {
		cert, err := tls.LoadX509KeyPair(certPath, keyPath)
		if err == nil {
			tlsCfg.Certificates = []tls.Certificate{cert}
		}
	}

	configName := "custom-" + conn.ID
	_ = mysql.RegisterTLSConfig(configName, tlsCfg)
	dsn += "&tls=" + configName

	return dsn
}
