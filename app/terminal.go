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

	session.Wait()
}

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

func (a *App) ResizeTerminal(cols, rows int) {
}
