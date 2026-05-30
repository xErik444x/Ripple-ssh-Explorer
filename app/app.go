package app

import (
	"context"
	"fmt"
	"io"
	"os"
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
