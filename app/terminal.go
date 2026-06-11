package app

import (
	"fmt"
	"io"

	"golang.org/x/crypto/ssh"
)

func (a *App) startTerminal(tabId string) {
	a.mu.Lock()
	tab := a.tabs[tabId]
	if tab == nil || tab.SSHClient == nil {
		a.mu.Unlock()
		return
	}

	cols := 80
	rows := 24
	if tab.PendingCols > 0 {
		cols = tab.PendingCols
	}
	if tab.PendingRows > 0 {
		rows = tab.PendingRows
	}

	session, err := tab.SSHClient.NewSession()
	if err != nil {
		a.mu.Unlock()
		a.log(fmt.Sprintf("Terminal session error: %s", err.Error()))
		a.app.Event.Emit("ssh.error", map[string]string{
			"tabId":   tabId,
			"message": fmt.Sprintf("Terminal error: %s", err.Error()),
		})
		return
	}

	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.ECHOE:         1,
		ssh.ECHOK:         1,
		ssh.ECHONL:        0,
		ssh.ICANON:        1,
		ssh.ISIG:          1,
		ssh.IEXTEN:        1,
		ssh.OPOST:         1,
		ssh.ONLCR:         1,
		ssh.OCRNL:         0,
		ssh.INLCR:         0,
		ssh.IGNCR:         0,
		ssh.ICRNL:         1,
		ssh.IXON:          1,
		ssh.IXANY:         0,
		ssh.IXOFF:         0,
		ssh.CS8:           0,
		ssh.PARENB:        0,
		ssh.TTY_OP_ISPEED: 115200,
		ssh.TTY_OP_OSPEED: 115200,
	}
	if err := session.RequestPty("xterm-256color", rows, cols, modes); err != nil {
		session.Close()
		a.mu.Unlock()
		a.log(fmt.Sprintf("PTY request error: %s", err.Error()))
		a.app.Event.Emit("ssh.error", map[string]string{
			"tabId":   tabId,
			"message": fmt.Sprintf("PTY error: %s", err.Error()),
		})
		return
	}

	stdin, err := session.StdinPipe()
	if err != nil {
		session.Close()
		a.mu.Unlock()
		a.log(fmt.Sprintf("stdin pipe error: %s", err.Error()))
		a.app.Event.Emit("ssh.error", map[string]string{
			"tabId":   tabId,
			"message": fmt.Sprintf("Terminal pipe error: %s", err.Error()),
		})
		return
	}

	stdout, err := session.StdoutPipe()
	if err != nil {
		session.Close()
		a.mu.Unlock()
		a.log(fmt.Sprintf("stdout pipe error: %s", err.Error()))
		a.app.Event.Emit("ssh.error", map[string]string{
			"tabId":   tabId,
			"message": fmt.Sprintf("Terminal pipe error: %s", err.Error()),
		})
		return
	}

	stderr, err := session.StderrPipe()
	if err != nil {
		session.Close()
		a.mu.Unlock()
		a.log(fmt.Sprintf("stderr pipe error: %s", err.Error()))
		return
	}

	ts := &terminalSession{
		stdin:   stdin,
		stdout:  stdout,
		stderr:  stderr,
		session: session,
		done:    make(chan struct{}),
	}

	tab.TerminalSession = ts
	tab.PendingCols = 0
	tab.PendingRows = 0
	a.mu.Unlock()

	if err := session.Shell(); err != nil {
		a.log(fmt.Sprintf("Shell start error: %s", err.Error()))
		a.app.Event.Emit("ssh.error", map[string]string{
			"tabId":   tabId,
			"message": fmt.Sprintf("Shell error: %s", err.Error()),
		})
		return
	}

	go func() {
		buf := make([]byte, 8192)
		for {
			n, err := stdout.Read(buf)
			if n > 0 {
				a.app.Event.Emit("terminal.data", map[string]interface{}{
					"tabId": tabId,
					"data":  string(buf[:n]),
				})
			}
			if err != nil {
				if err != io.EOF {
					a.log(fmt.Sprintf("Terminal stdout read error: %v", err))
				}
				close(ts.done)
				return
			}
		}
	}()

	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := stderr.Read(buf)
			if n > 0 {
				a.app.Event.Emit("terminal.data", map[string]interface{}{
					"tabId": tabId,
					"data":  string(buf[:n]),
				})
			}
			if err != nil {
				if err != io.EOF {
					a.log(fmt.Sprintf("Terminal stderr read error: %v", err))
				}
				return
			}
		}
	}()

	go func() {
		<-ts.done
		session.Close()
	}()

	a.log(fmt.Sprintf("Terminal started for tab %s (%dx%d)", tabId, cols, rows))
}

func (a *App) WriteTerminal(tabId, data string) {
	a.mu.RLock()
	tab := a.tabs[tabId]
	a.mu.RUnlock()
	if tab != nil && tab.TerminalSession != nil && tab.TerminalSession.stdin != nil {
		if _, err := tab.TerminalSession.stdin.Write([]byte(data)); err != nil {
			a.log(fmt.Sprintf("Terminal write error: %v", err))
		}
	}
}

func (a *App) ResizeTerminal(tabId string, cols, rows int) {
	a.mu.Lock()
	tab := a.tabs[tabId]
	if tab == nil {
		a.mu.Unlock()
		return
	}
	if tab.TerminalSession != nil && tab.TerminalSession.session != nil {
		a.mu.Unlock()
		if err := tab.TerminalSession.session.WindowChange(cols, rows); err != nil {
			a.log(fmt.Sprintf("WindowChange error: %v", err))
		}
		return
	}
	tab.PendingCols = cols
	tab.PendingRows = rows
	a.mu.Unlock()
}
