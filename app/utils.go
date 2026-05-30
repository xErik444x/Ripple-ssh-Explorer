package app

import (
	"encoding/base64"
	"os"
	"os/exec"
	"runtime"
)

// GetOS returns the runtime OS name.
func (a *App) GetOS() string {
	return runtime.GOOS
}

// OpenFileWithDefaultApp opens a file with the OS default application.
func (a *App) OpenFileWithDefaultApp(path string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", "", path)
	case "darwin":
		cmd = exec.Command("open", path)
	default:
		cmd = exec.Command("xdg-open", path)
	}
	return cmd.Start()
}

// DeleteLocalFile removes a file from the local filesystem.
func (a *App) DeleteLocalFile(path string) error {
	return os.Remove(path)
}

// ReadFileAsBase64 reads a file and returns its contents as a base64 string.
func (a *App) ReadFileAsBase64(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

// GetFileStats returns the size of a file in bytes.
func (a *App) GetFileStats(path string) (int64, error) {
	info, err := os.Stat(path)
	if err != nil {
		return 0, err
	}
	return info.Size(), nil
}
