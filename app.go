package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"time"

	"github.com/pkg/sftp"
	"github.com/wailsapp/wails/v3/pkg/application"
	"golang.org/x/crypto/ssh"
)

type App struct {
	app      *application.App
	sshClient  *ssh.Client
	sftpClient *sftp.Client
	mu         sync.Mutex

	terminalSession *terminalSession
	logFile         *os.File
}

type terminalSession struct {
	stdin  io.WriteCloser
	stdout io.Reader
	done   chan struct{}
}

type FileEntry struct {
	Name  string `json:"name"`
	Size  int64  `json:"size"`
	IsDir bool   `json:"isDir"`
}

func NewApp() *App {
	return &App{}
}

func (a *App) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	a.app = application.Get()
	return nil
}

func (a *App) ServiceShutdown() {
	a.DisconnectSSH()
	if a.logFile != nil {
		a.log("=== App shutting down ===")
		a.logFile.Close()
	}
}

func (a *App) log(msg string) {
	if a.logFile != nil {
		a.logFile.WriteString(fmt.Sprintf("[%s] %s\n", time.Now().Format("15:04:05"), msg))
		a.logFile.Sync()
	}
}

// GetConfigDir returns the OS config directory for persistent storage
func (a *App) GetConfigDir() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	configDir := filepath.Join(dir, "ripple-ssh")
	err = os.MkdirAll(configDir, 0755)
	return configDir, err
}

// SaveProfiles saves SSH profiles to disk
func (a *App) SaveProfiles(data string) error {
	dir, err := a.GetConfigDir()
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "profiles.json"), []byte(data), 0600)
}

// LoadProfiles loads SSH profiles from disk
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

// SaveSettings saves terminal settings to disk
func (a *App) SaveSettings(data string) error {
	dir, err := a.GetConfigDir()
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "settings.json"), []byte(data), 0600)
}

// LoadSettings loads terminal settings from disk
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

// ConnectSSH connects to a remote SSH server (non-blocking)
func (a *App) ConnectSSH(host, port, username, password, privateKeyText, passphrase string) {
	go a.connectSSHAsync(host, port, username, password, privateKeyText, passphrase)
}

func (a *App) connectSSHAsync(host, port, username, password, privateKeyText, passphrase string) {
	a.log(fmt.Sprintf("Connecting to %s:%s as %s", host, port, username))
	if port == "" {
		port = "22"
	}
	addr := fmt.Sprintf("%s:%s", host, port)

	config := &ssh.ClientConfig{
		User:            username,
		Auth:            []ssh.AuthMethod{},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
	}

	if password != "" {
		config.Auth = append(config.Auth, ssh.Password(password))
	}

	if privateKeyText != "" {
		signer, err := parsePrivateKey(privateKeyText, passphrase)
		if err == nil {
			config.Auth = append(config.Auth, ssh.PublicKeys(signer))
		}
	}

	client, err := ssh.Dial("tcp", addr, config)
	if err != nil {
		a.log(fmt.Sprintf("SSH connection failed: %s", err.Error()))
		a.app.Event.Emit("ssh.error", map[string]string{
			"message": fmt.Sprintf("Connection failed: %s", err.Error()),
		})
		return
	}

	a.log("SSH connected successfully")
	a.mu.Lock()
	a.sshClient = client
	a.mu.Unlock()

	// Initialize SFTP first (must complete before terminal)
	a.log("Initializing SFTP...")
	sftpC, err := sftp.NewClient(client)
	if err != nil {
		a.log(fmt.Sprintf("SFTP init failed: %s", err.Error()))
	} else {
		a.mu.Lock()
		a.sftpClient = sftpC
		a.mu.Unlock()
		a.log("SFTP initialized")
	}

	// Notify frontend
	a.app.Event.Emit("ssh.connected", map[string]string{
		"host":     host,
		"username": username,
	})

	// Start terminal AFTER SFTP is ready and frontend has rendered
	go func() {
		time.Sleep(500 * time.Millisecond)
		a.startTerminal()
	}()
}

func parsePrivateKey(keyText, passphrase string) (ssh.Signer, error) {
	if passphrase != "" {
		return ssh.ParsePrivateKeyWithPassphrase([]byte(keyText), []byte(passphrase))
	}
	return ssh.ParsePrivateKey([]byte(keyText))
}

// DisconnectSSH closes the SSH connection
func (a *App) DisconnectSSH() error {
	a.mu.Lock()
	defer a.mu.Unlock()

	if a.sftpClient != nil {
		a.sftpClient.Close()
		a.sftpClient = nil
	}
	if a.sshClient != nil {
		a.sshClient.Close()
		a.sshClient = nil
	}
	if a.terminalSession != nil {
		a.terminalSession = nil
	}

	a.app.Event.Emit("ssh.disconnected", map[string]string{
		"message": "Disconnected",
	})
	return nil
}

// startTerminal opens an interactive shell session
func (a *App) startTerminal() {
	a.log("Starting terminal session...")
	a.mu.Lock()
	client := a.sshClient
	a.mu.Unlock()

	if client == nil {
		a.log("Terminal: no SSH client")
		return
	}

	session, err := client.NewSession()
	if err != nil {
		a.log(fmt.Sprintf("Terminal session failed: %s", err.Error()))
		a.app.Event.Emit("ssh.error", map[string]string{
			"message": fmt.Sprintf("Shell init failed: %s", err.Error()),
		})
		return
	}

	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}

	if err := session.RequestPty("xterm-256color", 24, 80, modes); err != nil {
		a.log(fmt.Sprintf("PTY request failed: %s", err.Error()))
		session.Close()
		return
	}

	stdin, _ := session.StdinPipe()
	stdout, _ := session.StdoutPipe()
	stderr, _ := session.StderrPipe()

	if err := session.Shell(); err != nil {
		a.log(fmt.Sprintf("Shell start failed: %s", err.Error()))
		session.Close()
		return
	}

	a.log("Terminal shell started successfully")

	ts := &terminalSession{
		stdin:  stdin,
		stdout: stdout,
		done:   make(chan struct{}),
	}

	a.mu.Lock()
	a.terminalSession = ts
	a.mu.Unlock()

	// Read stdout and emit to frontend
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := stdout.Read(buf)
			if n > 0 {
				a.log(fmt.Sprintf("Terminal data: %d bytes", n))
				a.app.Event.Emit("terminal.data", map[string]string{
					"data": string(buf[:n]),
				})
			}
			if err != nil {
				break
			}
		}
	}()

	// Read stderr too
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := stderr.Read(buf)
			if n > 0 {
				a.app.Event.Emit("terminal.data", map[string]string{
					"data": string(buf[:n]),
				})
			}
			if err != nil {
				break
			}
		}
	}()

	session.Wait()
}

// WriteTerminal sends input to the terminal
func (a *App) WriteTerminal(data string) {
	a.mu.Lock()
	ts := a.terminalSession
	a.mu.Unlock()

	if ts != nil && ts.stdin != nil {
		ts.stdin.Write([]byte(data))
	} else {
		a.log("WriteTerminal: no terminal session")
	}
}

// ResizeTerminal resizes the remote PTY
func (a *App) ResizeTerminal(cols, rows int) {
	// Would need to store the session reference to call WindowChange
	// For now this is handled by the initial PTY request
}

// ListDirectory lists files in a remote directory
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

// DownloadFile downloads a remote file to local path
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

// UploadFile uploads a local file to remote path
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

// DeleteFile removes a remote file or directory
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

// RenameFile renames/moves a remote file
func (a *App) RenameFile(src, dest string) error {
	a.mu.Lock()
	client := a.sftpClient
	a.mu.Unlock()

	if client == nil {
		return fmt.Errorf("SFTP not connected")
	}

	return client.Rename(src, dest)
}

// Mkdir creates a remote directory
func (a *App) Mkdir(path string) error {
	a.mu.Lock()
	client := a.sftpClient
	a.mu.Unlock()

	if client == nil {
		return fmt.Errorf("SFTP not connected")
	}

	return client.Mkdir(path)
}

// ShowSaveDialog shows a native save file dialog
func (a *App) ShowSaveDialog(defaultName string) (string, error) {
	result, err := a.app.Dialog.SaveFileWithOptions(&application.SaveFileDialogOptions{
		Filename: defaultName,
	}).PromptForSingleSelection()
	if err != nil {
		return "", err
	}
	return result, nil
}

// ShowOpenDialog shows a native open file dialog
func (a *App) ShowOpenDialog() (string, error) {
	result, err := a.app.Dialog.OpenFileWithOptions(&application.OpenFileDialogOptions{}).PromptForSingleSelection()
	if err != nil {
		return "", err
	}
	return result, nil
}

// ShowMessage shows a native message box
func (a *App) ShowMessage(title, message string) string {
	var result string
	done := make(chan struct{})
	
	dialog := a.app.Dialog.Question().
		SetTitle(title).
		SetMessage(message)
	
	dialog.AddButton("Yes").OnClick(func() {
		result = "Yes"
		close(done)
	})
	
	dialog.AddButton("No").OnClick(func() {
		result = "No"
		close(done)
	})
	
	dialog.Show()
	
	<-done
	return result
}

// GetOS returns the current OS name
func (a *App) GetOS() string {
	return runtime.GOOS
}

// OpenFileWithDefaultApp opens a file with the OS default application
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

// DeleteLocalFile removes a local file
func (a *App) DeleteLocalFile(path string) error {
	return os.Remove(path)
}

// ReadFileAsBase64 reads a local file and returns it as base64-encoded string
func (a *App) ReadFileAsBase64(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

// GetFileStats returns file size for a local path
func (a *App) GetFileStats(path string) (int64, error) {
	info, err := os.Stat(path)
	if err != nil {
		return 0, err
	}
	return info.Size(), nil
}

// DownloadToTemp downloads a remote file to a temp path and returns the local path
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
