// Package app implements the backend logic for Ripple SSH — a Wails v3 desktop application
// providing SSH, SFTP, and terminal functionality exposed to the JavaScript frontend.
package app

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/pkg/sftp"
	"github.com/wailsapp/wails/v3/pkg/application"
	"golang.org/x/crypto/ssh"
)

// App is the main application struct that holds SSH, SFTP, and terminal state.
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

// FileEntry represents a single file or directory entry for the frontend.
type FileEntry struct {
	Name  string `json:"name"`
	Size  int64  `json:"size"`
	IsDir bool   `json:"isDir"`
}

// NewApp creates a new App instance.
func NewApp() *App {
	return &App{}
}

// ServiceStartup is called by Wails when the service starts.
func (a *App) ServiceStartup(_ context.Context, options application.ServiceOptions) error {
	a.app = application.Get()
	a.initLogFile()
	return nil
}

func (a *App) initLogFile() {
	logPath := "ripple-ssh.log"
	if exe, err := os.Executable(); err == nil {
		logPath = filepath.Join(filepath.Dir(exe), "ripple-ssh.log")
	}
	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
	if err != nil {
		fmt.Fprintf(os.Stderr, "log file init error: %v\n", err)
		return
	}
	a.logFile = f
}

// ServiceShutdown is called by Wails when the service shuts down.
func (a *App) ServiceShutdown() {
	if err := a.DisconnectSSH(); err != nil {
		a.log(fmt.Sprintf("Disconnect error during shutdown: %v", err))
	}
	if a.logFile != nil {
		a.log("=== App shutting down ===")
		if err := a.logFile.Close(); err != nil {
			fmt.Fprintf(os.Stderr, "log file close error: %v\n", err)
		}
	}
}

func (a *App) log(msg string) {
	if a.logFile != nil {
		t := time.Now().Format("15:04:05")
		if _, err := a.logFile.WriteString(fmt.Sprintf("[%s] %s\n", t, msg)); err != nil {
			fmt.Fprintf(os.Stderr, "log write error: %v\n", err)
		}
		if err := a.logFile.Sync(); err != nil {
			fmt.Fprintf(os.Stderr, "log sync error: %v\n", err)
		}
	}
}
