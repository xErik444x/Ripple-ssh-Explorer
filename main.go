// Ripple SSH — SSH & SFTP Client
// Made with ❤️ by Erik Schwerdt
package main

import (
	"embed"
	"os"
	"path/filepath"

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
			Host: "localhost",
			Port: 8080,
		},
	})

	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:  "Ripple SSH",
		Width:  1100,
		Height: 700,
		MinWidth:  800,
		MinHeight: 500,
		BackgroundColour: application.NewRGB(11, 15, 25),
	})

	// Setup log file with absolute path
	logPath := "ripple-ssh.log"
	if exe, err := os.Executable(); err == nil {
		logPath = filepath.Join(filepath.Dir(exe), "ripple-ssh.log")
	}
	logFile, _ := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if logFile != nil {
		// Get the service and set log file
		if sshApp := application.Get(); sshApp != nil {
			// The service will be initialized via ServiceStartup
		}
	}

	if err := app.Run(); err != nil {
		println("Error:", err.Error())
	}
}
