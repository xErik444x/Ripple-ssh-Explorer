package app

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func withTempConfigDir(t *testing.T) string {
	t.Helper()
	tmpDir := t.TempDir()
	orig := userConfigDir
	userConfigDir = func() (string, error) { return tmpDir, nil }
	t.Cleanup(func() { userConfigDir = orig })
	return tmpDir
}

func TestGetConfigDir(t *testing.T) {
	a := &App{}
	tmpDir := withTempConfigDir(t)

	dir, err := a.GetConfigDir()
	if err != nil {
		t.Fatalf("GetConfigDir() error: %v", err)
	}
	expected := filepath.Join(tmpDir, "ripple-ssh")
	if dir != expected {
		t.Errorf("GetConfigDir() = %q, want %q", dir, expected)
	}
	info, err := os.Stat(dir)
	if err != nil {
		t.Fatalf("GetConfigDir() dir stat error: %v", err)
	}
	if !info.IsDir() {
		t.Fatal("GetConfigDir() path is not a directory")
	}
}

func TestSaveAndLoadProfiles(t *testing.T) {
	a := &App{}
	withTempConfigDir(t)

	profileData := `[{"id":"1","name":"test","host":"example.com","port":"22","username":"user"}]`
	if err := a.SaveProfiles(profileData); err != nil {
		t.Fatalf("SaveProfiles() error: %v", err)
	}

	loaded, err := a.LoadProfiles()
	if err != nil {
		t.Fatalf("LoadProfiles() error: %v", err)
	}
	if loaded != profileData {
		t.Errorf("LoadProfiles() = %q, want %q", loaded, profileData)
	}
}

func TestSaveAndLoadSettings(t *testing.T) {
	a := &App{}
	withTempConfigDir(t)

	settingsData := `{"fontSize":16,"lineHeight":1.5,"fontFamily":"Fira Code"}`
	if err := a.SaveSettings(settingsData); err != nil {
		t.Fatalf("SaveSettings() error: %v", err)
	}

	loaded, err := a.LoadSettings()
	if err != nil {
		t.Fatalf("LoadSettings() error: %v", err)
	}
	if loaded != settingsData {
		t.Errorf("LoadSettings() = %q, want %q", loaded, settingsData)
	}
}

func TestLoadProfiles_NotExist(t *testing.T) {
	a := &App{}
	withTempConfigDir(t)

	loaded, err := a.LoadProfiles()
	if err != nil {
		t.Fatalf("LoadProfiles() on missing file error: %v", err)
	}
	if loaded != "[]" {
		t.Errorf("LoadProfiles() on missing file = %q, want %q", loaded, "[]")
	}
}

func TestLoadSettings_NotExist(t *testing.T) {
	a := &App{}
	withTempConfigDir(t)

	loaded, err := a.LoadSettings()
	if err != nil {
		t.Fatalf("LoadSettings() on missing file error: %v", err)
	}
	if loaded != "{}" {
		t.Errorf("LoadSettings() on missing file = %q, want %q", loaded, "{}")
	}
}

func TestSaveProfiles_CreatesDir(t *testing.T) {
	a := &App{}
	tmpDir := withTempConfigDir(t)

	profileData := `[]`
	if err := a.SaveProfiles(profileData); err != nil {
		t.Fatalf("SaveProfiles() error: %v", err)
	}

	configPath := filepath.Join(tmpDir, "ripple-ssh", "profiles.json")
	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		t.Fatal("SaveProfiles() did not create profiles.json")
	}
}

func TestSaveProfiles_Permissions(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("permission checks not applicable on Windows")
	}
	a := &App{}
	tmpDir := withTempConfigDir(t)

	if err := a.SaveProfiles(`[]`); err != nil {
		t.Fatal(err)
	}

	configPath := filepath.Join(tmpDir, "ripple-ssh", "profiles.json")
	info, err := os.Stat(configPath)
	if err != nil {
		t.Fatal(err)
	}
	mode := info.Mode().Perm()
	if mode > 0600 {
		t.Errorf("profiles.json permissions = %o, want <= 0600", mode)
	}
}

func TestRoundTripProfiles(t *testing.T) {
	a := &App{}
	withTempConfigDir(t)

	input := `[{"id":"1","name":"test","host":"example.com","port":"22","username":"user","authType":"password","credentials":{"host":"example.com","port":"22","username":"user","password":"secret"}}]`
	if err := a.SaveProfiles(input); err != nil {
		t.Fatal(err)
	}

	output, err := a.LoadProfiles()
	if err != nil {
		t.Fatal(err)
	}
	if output != input {
		t.Errorf("round-trip mismatch:\n  got:  %s\n  want: %s", output, input)
	}
}

func TestGetConfigDir_CreatesParent(t *testing.T) {
	a := &App{}
	tmpDir := t.TempDir()
	deepDir := filepath.Join(tmpDir, "deep", "nested")
	orig := userConfigDir
	userConfigDir = func() (string, error) { return deepDir, nil }
	t.Cleanup(func() { userConfigDir = orig })

	dir, err := a.GetConfigDir()
	if err != nil {
		t.Fatalf("GetConfigDir() error: %v", err)
	}

	expected := filepath.Join(deepDir, "ripple-ssh")
	if dir != expected {
		t.Errorf("GetConfigDir() = %q, want %q", dir, expected)
	}
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		t.Fatal("GetConfigDir() did not create nested directory")
	}
}
