package app

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

func (a *App) ListDirectory(path string) (string, error) {
	a.log(fmt.Sprintf("ListDirectory: %s", path))
	a.mu.Lock()
	client := a.sftpClient
	a.mu.Unlock()

	if client == nil {
		a.log("ListDirectory: SFTP not connected")
		return "[]", fmt.Errorf("SFTP not connected")
	}

	if path == "" {
		path = "."
	}

	entries, err := client.ReadDir(path)
	if err != nil {
		a.log(fmt.Sprintf("ListDirectory error: %s", err.Error()))
		return "[]", err
	}

	files := make([]FileEntry, 0)
	for _, entry := range entries {
		name := entry.Name()
		if name == "." || name == ".." {
			continue
		}
		files = append(files, FileEntry{
			Name:  name,
			Size:  entry.Size(),
			IsDir: entry.IsDir(),
		})
	}

	a.log(fmt.Sprintf("ListDirectory: found %d files", len(files)))
	result, _ := json.Marshal(files)
	return string(result), nil
}

func (a *App) DownloadFile(remotePath, localPath string) error {
	a.mu.Lock()
	client := a.sftpClient
	a.mu.Unlock()

	if client == nil {
		return fmt.Errorf("SFTP not connected")
	}

	os.MkdirAll(filepath.Dir(localPath), 0755)

	remoteFile, err := client.Open(remotePath)
	if err != nil {
		return err
	}
	defer remoteFile.Close()

	stat, err := remoteFile.Stat()
	if err != nil {
		return err
	}
	totalSize := stat.Size()

	localFile, err := os.Create(localPath)
	if err != nil {
		return err
	}
	defer localFile.Close()

	buf := make([]byte, 32*1024)
	var transferred int64
	for {
		n, readErr := remoteFile.Read(buf)
		if n > 0 {
			localFile.Write(buf[:n])
			transferred += int64(n)
			percent := 0
			if totalSize > 0 {
				percent = int((transferred * 100) / totalSize)
			}
			a.app.Event.Emit("sftp.progress", map[string]interface{}{
				"action":      "download",
				"transferred": transferred,
				"total":       totalSize,
				"percent":     percent,
			})
		}
		if readErr != nil {
			break
		}
	}

	return nil
}

func (a *App) UploadFile(localPath, remotePath string) error {
	a.mu.Lock()
	client := a.sftpClient
	a.mu.Unlock()

	if client == nil {
		return fmt.Errorf("SFTP not connected")
	}

	localFile, err := os.Open(localPath)
	if err != nil {
		return err
	}
	defer localFile.Close()

	stat, err := localFile.Stat()
	if err != nil {
		return err
	}
	totalSize := stat.Size()

	remoteFile, err := client.Create(remotePath)
	if err != nil {
		return err
	}
	defer remoteFile.Close()

	buf := make([]byte, 32*1024)
	var transferred int64
	for {
		n, readErr := localFile.Read(buf)
		if n > 0 {
			remoteFile.Write(buf[:n])
			transferred += int64(n)
			percent := 0
			if totalSize > 0 {
				percent = int((transferred * 100) / totalSize)
			}
			a.app.Event.Emit("sftp.progress", map[string]interface{}{
				"action":      "upload",
				"transferred": transferred,
				"total":       totalSize,
				"percent":     percent,
			})
		}
		if readErr != nil {
			break
		}
	}

	return nil
}

func (a *App) DeleteFile(path string, isDir bool) error {
	a.mu.Lock()
	client := a.sftpClient
	a.mu.Unlock()

	if client == nil {
		return fmt.Errorf("SFTP not connected")
	}

	if isDir {
		return client.RemoveDirectory(path)
	}
	return client.Remove(path)
}

func (a *App) RenameFile(src, dest string) error {
	a.mu.Lock()
	client := a.sftpClient
	a.mu.Unlock()

	if client == nil {
		return fmt.Errorf("SFTP not connected")
	}

	return client.Rename(src, dest)
}

func (a *App) Mkdir(path string) error {
	a.mu.Lock()
	client := a.sftpClient
	a.mu.Unlock()

	if client == nil {
		return fmt.Errorf("SFTP not connected")
	}

	return client.Mkdir(path)
}

func (a *App) DownloadToTemp(remotePath, safeName string) (string, error) {
	a.mu.Lock()
	client := a.sftpClient
	a.mu.Unlock()

	if client == nil {
		return "", fmt.Errorf("SFTP not connected")
	}

	tmpDir := os.TempDir()
	localPath := filepath.Join(tmpDir, "ripple_preview_"+safeName)

	remoteFile, err := client.Open(remotePath)
	if err != nil {
		return "", err
	}
	defer remoteFile.Close()

	localFile, err := os.Create(localPath)
	if err != nil {
		return "", err
	}
	defer localFile.Close()

	_, err = io.Copy(localFile, remoteFile)
	if err != nil {
		os.Remove(localPath)
		return "", err
	}

	return localPath, nil
}
