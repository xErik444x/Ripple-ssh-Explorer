package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

func (a *App) ListDirectory(tabId, path string) (string, error) {
	a.log(fmt.Sprintf("ListDirectory: %s (tab: %s)", path, tabId))
	tab := a.getTab(tabId)
	if tab == nil || tab.SFTPClient == nil {
		return "[]", fmt.Errorf("SFTP not connected")
	}
	client := tab.SFTPClient

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

func (a *App) DownloadFile(tabId, remotePath, localPath string) error {
	tab := a.getTab(tabId)
	if tab == nil || tab.SFTPClient == nil {
		return fmt.Errorf("SFTP not connected")
	}
	client := tab.SFTPClient

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
				"tabId":       tabId,
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

func (a *App) UploadFile(tabId, localPath, remotePath string) error {
	tab := a.getTab(tabId)
	if tab == nil || tab.SFTPClient == nil {
		return fmt.Errorf("SFTP not connected")
	}
	client := tab.SFTPClient

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
				"tabId":       tabId,
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

func (a *App) DeleteFile(tabId, path string, isDir bool) error {
	tab := a.getTab(tabId)
	if tab == nil || tab.SFTPClient == nil {
		return fmt.Errorf("SFTP not connected")
	}
	client := tab.SFTPClient

	if isDir {
		return client.RemoveDirectory(path)
	}
	return client.Remove(path)
}

func (a *App) RenameFile(tabId, src, dest string) error {
	tab := a.getTab(tabId)
	if tab == nil || tab.SFTPClient == nil {
		return fmt.Errorf("SFTP not connected")
	}
	client := tab.SFTPClient

	return client.Rename(src, dest)
}

func (a *App) Mkdir(tabId, path string) error {
	tab := a.getTab(tabId)
	if tab == nil || tab.SFTPClient == nil {
		return fmt.Errorf("SFTP not connected")
	}
	client := tab.SFTPClient

	return client.Mkdir(path)
}

func (a *App) DownloadToTemp(tabId, remotePath, safeName string) (string, error) {
	tab := a.getTab(tabId)
	if tab == nil || tab.SFTPClient == nil {
		return "", fmt.Errorf("SFTP not connected")
	}
	client := tab.SFTPClient

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
