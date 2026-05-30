package app

import (
	"os"
	"path/filepath"
)

func (a *App) GetConfigDir() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	configDir := filepath.Join(dir, "ripple-ssh")
	err = os.MkdirAll(configDir, 0755)
	return configDir, err
}

func (a *App) SaveProfiles(data string) error {
	dir, err := a.GetConfigDir()
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "profiles.json"), []byte(data), 0600)
}

func (a *App) LoadProfiles() (string, error) {
	dir, err := a.GetConfigDir()
	if err != nil {
		return "[]", nil
	}
	data, err := os.ReadFile(filepath.Join(dir, "profiles.json"))
	if err != nil {
		return "[]", nil
	}
	return string(data), nil
}

func (a *App) SaveSettings(data string) error {
	dir, err := a.GetConfigDir()
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "settings.json"), []byte(data), 0600)
}

func (a *App) LoadSettings() (string, error) {
	dir, err := a.GetConfigDir()
	if err != nil {
		return "{}", nil
	}
	data, err := os.ReadFile(filepath.Join(dir, "settings.json"))
	if err != nil {
		return "{}", nil
	}
	return string(data), nil
}
