//go:build server && !windows

// Ripple SSH — SSH & SFTP Client (Server Mode)
// Made with ❤️ by Erik Schwerdt
package main

import (
	"embed"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := application.New(application.Options{
		Name: "Ripple SSH",
		Services: []application.Service{
			application.NewService(NewApp()),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Server: application.ServerOptions{
			Port: 8080,
		},
	})

	// Setup log file with absolute path
	logPath := "ripple-ssh.log"
	if exe, err := os.Executable(); err == nil {
		logPath = filepath.Join(filepath.Dir(exe), "ripple-ssh.log")
	}
	logFile, _ := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if logFile != nil {
		if sshApp := application.Get(); sshApp != nil {
			// The service will be initialized via ServiceStartup
		}
	}

	fmt.Println("Starting Ripple SSH in server mode on http://localhost:8080")
	fmt.Println("Open your browser and navigate to the URL above")
	fmt.Println("Press Ctrl+C to stop the server")

	// Open browser automatically
	go openBrowser("http://localhost:8080")

	if err := app.Run(); err != nil {
		println("Error:", err.Error())
	}
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	cmd.Start()
}
