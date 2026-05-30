//go:build server

package main

import (
	"fmt"
	"os/exec"
	"runtime"
)

func init() {
	fmt.Println("Starting Ripple SSH in server mode on http://localhost:8080")
	fmt.Println("Press Ctrl+C to stop the server")
	go openBrowser("http://localhost:8080")
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
		fmt.Printf("Could not open browser automatically. Open %s manually.\n", url)
	}
}
