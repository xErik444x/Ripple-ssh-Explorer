package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestGetOS(t *testing.T) {
	a := &App{}
	osName := a.GetOS()
	if osName == "" {
		t.Error("GetOS() returned empty string")
	}
	valid := []string{"windows", "linux", "darwin", "freebsd", "openbsd", "netbsd"}
	found := false
	for _, v := range valid {
		if osName == v {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("GetOS() returned unexpected value: %s", osName)
	}
}

func TestDeleteLocalFile(t *testing.T) {
	a := &App{}
	tmpFile := filepath.Join(t.TempDir(), "test-delete.txt")
	if err := os.WriteFile(tmpFile, []byte("hello"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := a.DeleteLocalFile(tmpFile); err != nil {
		t.Errorf("DeleteLocalFile() error: %v", err)
	}
	if _, err := os.Stat(tmpFile); !os.IsNotExist(err) {
		t.Error("DeleteLocalFile() did not remove the file")
	}
}

func TestDeleteLocalFile_NotExists(t *testing.T) {
	a := &App{}
	err := a.DeleteLocalFile(filepath.Join(t.TempDir(), "nonexistent.txt"))
	if err == nil {
		t.Error("DeleteLocalFile() should error on non-existent file")
	}
}

func TestReadFileAsBase64(t *testing.T) {
	a := &App{}
	tmpFile := filepath.Join(t.TempDir(), "test-base64.txt")
	content := "hello world"
	if err := os.WriteFile(tmpFile, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}

	b64, err := a.ReadFileAsBase64(tmpFile)
	if err != nil {
		t.Errorf("ReadFileAsBase64() error: %v", err)
	}
	if b64 == "" {
		t.Error("ReadFileAsBase64() returned empty string")
	}
	if !strings.Contains(b64, "aGVsbG8gd29ybGQ=") {
		t.Errorf("ReadFileAsBase64() unexpected output: %s", b64)
	}
}

func TestReadFileAsBase64_NotExists(t *testing.T) {
	a := &App{}
	_, err := a.ReadFileAsBase64(filepath.Join(t.TempDir(), "nonexistent.txt"))
	if err == nil {
		t.Error("ReadFileAsBase64() should error on non-existent file")
	}
}

func TestGetFileStats(t *testing.T) {
	a := &App{}
	tmpFile := filepath.Join(t.TempDir(), "test-stats.txt")
	content := []byte("1234567890")
	if err := os.WriteFile(tmpFile, content, 0600); err != nil {
		t.Fatal(err)
	}

	size, err := a.GetFileStats(tmpFile)
	if err != nil {
		t.Errorf("GetFileStats() error: %v", err)
	}
	if size != 10 {
		t.Errorf("GetFileStats() = %d, want 10", size)
	}
}

func TestGetFileStats_NotExists(t *testing.T) {
	a := &App{}
	_, err := a.GetFileStats(filepath.Join(t.TempDir(), "nonexistent.txt"))
	if err == nil {
		t.Error("GetFileStats() should error on non-existent file")
	}
}

func TestReadFileAsBase64_EmptyFile(t *testing.T) {
	a := &App{}
	tmpFile := filepath.Join(t.TempDir(), "test-empty.txt")
	if err := os.WriteFile(tmpFile, []byte{}, 0600); err != nil {
		t.Fatal(err)
	}
	b64, err := a.ReadFileAsBase64(tmpFile)
	if err != nil {
		t.Errorf("ReadFileAsBase64() error on empty file: %v", err)
	}
	if b64 != "" {
		t.Errorf("ReadFileAsBase64() on empty file = %q, want empty", b64)
	}
}

func TestGetFileStats_Directory(t *testing.T) {
	a := &App{}
	tmpDir := t.TempDir()
	_, err := a.GetFileStats(tmpDir)
	if err != nil {
		t.Errorf("GetFileStats() on dir error: %v", err)
	}
}
