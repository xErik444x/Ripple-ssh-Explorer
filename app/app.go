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

type connectionState struct {
	Host            string
	Username        string
	Port            string
	SSHClient       *ssh.Client
	SFTPClient      *sftp.Client
	TerminalSession *terminalSession
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

type App struct {
	app     *application.App
	tabs    map[string]*connectionState
	mu      sync.RWMutex
	logFile *os.File
}

func NewApp() *App {
	return &App{
		tabs: make(map[string]*connectionState),
	}
}

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

func (a *App) ServiceShutdown() {
	a.mu.Lock()
	for id, tab := range a.tabs {
		a.disconnectTabLocked(tab)
		delete(a.tabs, id)
	}
	a.mu.Unlock()
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

func (a *App) NewTab() string {
	id := fmt.Sprintf("tab-%d", time.Now().UnixNano())
	a.mu.Lock()
	a.tabs[id] = &connectionState{}
	a.mu.Unlock()
	a.log(fmt.Sprintf("NewTab: %s", id))
	return id
}

func (a *App) CloseTab(tabId string) {
	a.mu.Lock()
	tab := a.tabs[tabId]
	if tab != nil {
		a.disconnectTabLocked(tab)
		delete(a.tabs, tabId)
	}
	a.mu.Unlock()
	a.log(fmt.Sprintf("CloseTab: %s", tabId))
}

func (a *App) disconnectTabLocked(tab *connectionState) {
	if tab.SFTPClient != nil {
		_ = tab.SFTPClient.Close()
		tab.SFTPClient = nil
	}
	if tab.SSHClient != nil {
		_ = tab.SSHClient.Close()
		tab.SSHClient = nil
	}
	tab.TerminalSession = nil
}

func (a *App) getTab(tabId string) *connectionState {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.tabs[tabId]
}
