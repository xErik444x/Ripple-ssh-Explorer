//go:build server

// Ripple SSH — SSH & SFTP Client (Server Mode)
// Made with ❤️ by Erik Schwerdt
package main

import (
	"embed"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	logPath := "ripple-ssh.log"
	if exe, err := os.Executable(); err == nil {
		logPath = filepath.Join(filepath.Dir(exe), "ripple-ssh.log")
	}
	logFile, _ := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if logFile != nil {
		defer logFile.Close()
		fmt.Fprintf(logFile, "=== Ripple SSH started (server mode) ===\n")
	}

	distFS, err := fs.Sub(assets, "frontend/dist")
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: failed to access embedded assets: %v\n", err)
		os.Exit(1)
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: failed to start server: %v\n", err)
		os.Exit(1)
	}
	defer listener.Close()

	port := listener.Addr().(*net.TCPAddr).Port
	url := fmt.Sprintf("http://127.0.0.1:%d", port)

	fmt.Printf("Ripple SSH Server Mode\n")
	fmt.Printf("======================\n")
	fmt.Printf("Server running at: %s\n", url)
	fmt.Printf("Press Ctrl+C to stop\n\n")

	if logFile != nil {
		fmt.Fprintf(logFile, "Server running at: %s\n", url)
	}

	go openBrowser(url)

	server := &http.Server{
		Handler: http.FileServer(http.FS(distFS)),
	}

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

	go func() {
		<-sigChan
		fmt.Println("\nShutting down server...")
		if logFile != nil {
			fmt.Fprintf(logFile, "=== App shutting down ===\n")
		}
		server.Close()
	}()

	if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
		fmt.Fprintf(os.Stderr, "Error: server failed: %v\n", err)
		os.Exit(1)
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
	if err := cmd.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "Warning: failed to open browser automatically: %v\n", err)
		fmt.Printf("Please open your browser and navigate to: %s\n", url)
	}
}
