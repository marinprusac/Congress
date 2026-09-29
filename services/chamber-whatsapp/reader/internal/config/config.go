// Package config reads wa-reader's settings from the environment (the
// Chamber's own .env, loaded by systemd's EnvironmentFile).
package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type Config struct {
	SessionDB     string
	MessagesDB    string
	Socket        string
	SocketMode    os.FileMode
	MediaMaxBytes int64
	LogLevel      string
	DeviceName    string
	FullHistory   bool
}

func Load() (Config, error) {
	c := Config{
		SessionDB:     path("WA_SESSION_DB", "./data/session.sqlite3"),
		MessagesDB:    path("WA_MESSAGES_DB", "./data/messages.sqlite3"),
		Socket:        str("WA_READER_SOCKET", "/run/wa-reader/api.sock"),
		SocketMode:    0o660,
		MediaMaxBytes: 25 << 20,
		LogLevel:      strings.ToUpper(str("WA_LOG_LEVEL", "INFO")),
		DeviceName:    str("WA_DEVICE_NAME", "Congress"),
		FullHistory:   str("WA_FULL_HISTORY", "true") == "true",
	}
	if v := os.Getenv("WA_MEDIA_MAX_BYTES"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n <= 0 {
			return c, fmt.Errorf("WA_MEDIA_MAX_BYTES: %q is not a positive integer", v)
		}
		c.MediaMaxBytes = n
	}
	if v := os.Getenv("WA_SOCKET_MODE"); v != "" {
		n, err := strconv.ParseUint(v, 8, 32)
		if err != nil {
			return c, fmt.Errorf("WA_SOCKET_MODE: %q is not an octal mode", v)
		}
		c.SocketMode = os.FileMode(n)
	}
	return c, nil
}

func str(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

// Relative paths resolve against the working directory (the Chamber's folder under systemd).
func path(key, def string) string {
	p := str(key, def)
	if abs, err := filepath.Abs(p); err == nil {
		return abs
	}
	return p
}
