package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// ListDirectory returns a JSON array of FileEntry for the given remote path.
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
	result, err := json.Marshal(files)
	if err != nil {
		return "[]", fmt.Errorf("marshal error: %w", err)
	}
	return string(result), nil
}

// DownloadFile streams a remote file to a local path with progress events.
func (a *App) DownloadFile(remotePath, localPath string) error {
	a.mu.Lock()
	client := a.sftpClient
	a.mu.Unlock()

	if client == nil {
		return fmt.Errorf("SFTP not connected")
	}

	if err := os.MkdirAll(filepath.Dir(localPath), 0700); err != nil {
		return fmt.Errorf("mkdir %s: %w", filepath.Dir(localPath), err)
	}

	remoteFile, err := client.Open(remotePath)
	if err != nil {
		return err
	}
	defer func() {
		if cerr := remoteFile.Close(); cerr != nil {
			a.log(fmt.Sprintf("remoteFile close error: %v", cerr))
		}
	}()

	stat, err := remoteFile.Stat()
	if err != nil {
		return err
	}
	totalSize := stat.Size()

	localFile, err := os.Create(localPath)
	if err != nil {
		return err
	}
	defer func() {
		if cerr := localFile.Close(); cerr != nil {
			a.log(fmt.Sprintf("localFile close error: %v", cerr))
		}
	}()

	buf := make([]byte, 32*1024)
	var transferred int64
	for {
		n, readErr := remoteFile.Read(buf)
		if n > 0 {
			if _, werr := localFile.Write(buf[:n]); werr != nil {
				return fmt.Errorf("write error: %w", werr)
			}
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
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			return fmt.Errorf("read error: %w", readErr)
		}
	}

	return nil
}

// UploadFile streams a local file to a remote path with progress events.
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
	defer func() {
		if cerr := localFile.Close(); cerr != nil {
			a.log(fmt.Sprintf("localFile close error: %v", cerr))
		}
	}()

	stat, err := localFile.Stat()
	if err != nil {
		return err
	}
	totalSize := stat.Size()

	remoteFile, err := client.Create(remotePath)
	if err != nil {
		return err
	}
	defer func() {
		if cerr := remoteFile.Close(); cerr != nil {
			a.log(fmt.Sprintf("remoteFile close error: %v", cerr))
		}
	}()

	buf := make([]byte, 32*1024)
	var transferred int64
	for {
		n, readErr := localFile.Read(buf)
		if n > 0 {
			if _, werr := remoteFile.Write(buf[:n]); werr != nil {
				return fmt.Errorf("write error: %w", werr)
			}
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
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			return fmt.Errorf("read error: %w", readErr)
		}
	}

	return nil
}

// DeleteFile removes a remote file or directory.
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

// RenameFile moves or renames a remote file.
func (a *App) RenameFile(src, dest string) error {
	a.mu.Lock()
	client := a.sftpClient
	a.mu.Unlock()

	if client == nil {
		return fmt.Errorf("SFTP not connected")
	}

	return client.Rename(src, dest)
}

// Mkdir creates a remote directory.
func (a *App) Mkdir(path string) error {
	a.mu.Lock()
	client := a.sftpClient
	a.mu.Unlock()

	if client == nil {
		return fmt.Errorf("SFTP not connected")
	}

	return client.Mkdir(path)
}

// DownloadToTemp downloads a remote file to a temp directory for preview.
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
	defer func() {
		if cerr := remoteFile.Close(); cerr != nil {
			a.log(fmt.Sprintf("remoteFile close: %v", cerr))
		}
	}()

	localFile, err := os.Create(localPath)
	if err != nil {
		return "", err
	}
	defer func() {
		if cerr := localFile.Close(); cerr != nil {
			a.log(fmt.Sprintf("localFile close: %v", cerr))
		}
	}()

	_, err = io.Copy(localFile, remoteFile)
	if err != nil {
		if rerr := os.Remove(localPath); rerr != nil {
			a.log(fmt.Sprintf("cleanup remove error: %v", rerr))
		}
		return "", err
	}

	return localPath, nil
}
