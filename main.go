// Ripple SSH — SSH & SFTP Client
// Made with ❤️ by Erik Schwerdt
package main

import (
	"embed"
	"flag"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/server"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	serverMode := flag.Bool("server", false, "Run in server mode (opens in browser instead of native window)")
	flag.Parse()

	app := NewApp()

	// Setup log file with absolute path
	logPath := "ripple-ssh.log"
	if exe, err := os.Executable(); err == nil {
		logPath = filepath.Join(filepath.Dir(exe), "ripple-ssh.log")
	}
	logFile, _ := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if logFile != nil {
		app.logFile = logFile
		app.log("=== Ripple SSH started ===")
	}

	appOptions := &options.App{
		Title:     "Ripple SSH",
		Width:     1100,
		Height:    700,
		MinWidth:  800,
		MinHeight: 500,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 11, G: 15, B: 25, A: 255},
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		Bind: []interface{}{
			app,
		},
	}

	if *serverMode {
		appOptions.Server = &server.Options{}
	}

	err := wails.Run(appOptions)

	if err != nil {
		println("Error:", err.Error())
	}
}
