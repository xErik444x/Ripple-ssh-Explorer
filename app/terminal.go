package app

import (
	"fmt"

	"golang.org/x/crypto/ssh"
)

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
		_ = session.Close()
		return
	}

	stdin, err := session.StdinPipe()
	if err != nil {
		a.log(fmt.Sprintf("StdinPipe failed: %s", err.Error()))
		_ = session.Close()
		return
	}
	stdout, err := session.StdoutPipe()
	if err != nil {
		a.log(fmt.Sprintf("StdoutPipe failed: %s", err.Error()))
		_ = session.Close()
		return
	}
	stderr, err := session.StderrPipe()
	if err != nil {
		a.log(fmt.Sprintf("StderrPipe failed: %s", err.Error()))
		_ = session.Close()
		return
	}

	if err := session.Shell(); err != nil {
		a.log(fmt.Sprintf("Shell start failed: %s", err.Error()))
		_ = session.Close()
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

	_ = session.Wait()
}

// WriteTerminal writes user input to the terminal's stdin.
func (a *App) WriteTerminal(data string) {
	a.mu.Lock()
	ts := a.terminalSession
	a.mu.Unlock()

	if ts != nil && ts.stdin != nil {
		if _, err := ts.stdin.Write([]byte(data)); err != nil {
			a.log(fmt.Sprintf("WriteTerminal error: %v", err))
			a.app.Event.Emit("ssh.error", map[string]string{
				"message": fmt.Sprintf("Terminal write error: %s", err.Error()),
			})
		}
	} else {
		a.log("WriteTerminal: no terminal session")
	}
}

// ResizeTerminal resizes the PTY dimensions.
func (a *App) ResizeTerminal(cols, rows int) {
	a.mu.Lock()
	defer a.mu.Unlock()

	if a.sshClient == nil {
		return
	}

	session, err := a.sshClient.NewSession()
	if err != nil {
		a.log(fmt.Sprintf("ResizeTerminal: session error: %v", err))
		return
	}
	defer func() {
		_ = session.Close()
	}()

	if err := session.RequestPty("xterm-256color", rows, cols, ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}); err != nil {
		a.log(fmt.Sprintf("ResizeTerminal: pty resize error: %v", err))
	}
}
