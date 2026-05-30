package app

import (
	"fmt"
	"os"
	"path/filepath"
)

// userConfigDir is overridable in tests.
var userConfigDir = os.UserConfigDir

// GetConfigDir returns the config directory path (~/.config/ripple-ssh), creating it if needed.
func (a *App) GetConfigDir() (string, error) {
	dir, err := userConfigDir()
	if err != nil {
		return "", err
	}
	configDir := filepath.Join(dir, "ripple-ssh")
	err = os.MkdirAll(configDir, 0750)
	return configDir, err
}

// SaveProfiles writes the profiles JSON to the config directory.
func (a *App) SaveProfiles(data string) error {
	dir, err := a.GetConfigDir()
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "profiles.json"), []byte(data), 0600)
}

// LoadProfiles reads the profiles JSON from the config directory.
// Returns "[]" if no profiles exist yet.
func (a *App) LoadProfiles() (string, error) {
	dir, err := a.GetConfigDir()
	if err != nil {
		return "[]", nil
	}
	data, err := os.ReadFile(filepath.Join(dir, "profiles.json"))
	if err != nil {
		if os.IsNotExist(err) {
			return "[]", nil
		}
		return "[]", fmt.Errorf("read profiles: %w", err)
	}
	return string(data), nil
}

// SaveSettings writes the settings JSON to the config directory.
func (a *App) SaveSettings(data string) error {
	dir, err := a.GetConfigDir()
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "settings.json"), []byte(data), 0600)
}

// LoadSettings reads the settings JSON from the config directory.
// Returns "{}" if no settings exist yet.
func (a *App) LoadSettings() (string, error) {
	dir, err := a.GetConfigDir()
	if err != nil {
		return "{}", nil
	}
	data, err := os.ReadFile(filepath.Join(dir, "settings.json"))
	if err != nil {
		if os.IsNotExist(err) {
			return "{}", nil
		}
		return "{}", fmt.Errorf("read settings: %w", err)
	}
	return string(data), nil
}
