package app

import (
	"fmt"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

func (a *App) ConnectSSH(tabId, host, port, username, password, privateKeyText, passphrase, connectionType string, vncPort int) {
	go a.connectSSHAsync(tabId, host, port, username, password, privateKeyText, passphrase, connectionType, vncPort)
}

func (a *App) connectSSHAsync(tabId, host, port, username, password, privateKeyText, passphrase, connectionType string, vncPort int) {
	a.log(fmt.Sprintf("Connecting to %s:%s as %s (tab: %s)", host, port, username, tabId))
	if port == "" {
		port = "22"
	}
	addr := fmt.Sprintf("%s:%s", host, port)

	config := &ssh.ClientConfig{
		User:            username,
		Auth:            []ssh.AuthMethod{},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
	}

	if password != "" {
		config.Auth = append(config.Auth, ssh.Password(password))
	}

	if privateKeyText != "" {
		signer, err := parsePrivateKey(privateKeyText, passphrase)
		if err != nil {
			a.log(fmt.Sprintf("Private key parse error: %v", err))
			a.app.Event.Emit("ssh.error", map[string]string{
				"tabId":   tabId,
				"message": fmt.Sprintf("Invalid private key: %s", err.Error()),
			})
		} else {
			config.Auth = append(config.Auth, ssh.PublicKeys(signer))
		}
	}

	client, err := ssh.Dial("tcp", addr, config)
	if err != nil {
		a.log(fmt.Sprintf("SSH connection failed: %s", err.Error()))
		a.app.Event.Emit("ssh.error", map[string]string{
			"tabId":   tabId,
			"message": fmt.Sprintf("Connection failed: %s", err.Error()),
		})
		return
	}

	a.log("SSH connected successfully")
	a.mu.Lock()
	tab := a.tabs[tabId]
	if tab != nil {
		tab.SSHClient = client
		tab.Host = host
		tab.Username = username
		tab.Port = port
		tab.ConnectionType = connectionType
		tab.VncPort = vncPort
	}
	a.mu.Unlock()

	if tab == nil {
		_ = client.Close()
		return
	}

	if connectionType == "vnc" {
		a.app.Event.Emit("ssh.connected", map[string]string{
			"tabId":    tabId,
			"host":     host,
			"username": username,
		})

		go func() {
			time.Sleep(300 * time.Millisecond)
			if err := a.StartVNCProxy(tabId); err != nil {
				a.log(fmt.Sprintf("VNC proxy start failed: %s", err.Error()))
				a.app.Event.Emit("vnc.error", map[string]string{
					"tabId":   tabId,
					"message": fmt.Sprintf("VNC proxy failed: %s", err.Error()),
				})
			}
		}()
		return
	}

	a.log("Initializing SFTP...")
	sftpC, err := sftp.NewClient(client)
	if err != nil {
		a.log(fmt.Sprintf("SFTP init failed: %s", err.Error()))
	} else {
		a.mu.Lock()
		if t := a.tabs[tabId]; t != nil {
			t.SFTPClient = sftpC
		} else {
			_ = sftpC.Close()
		}
		a.mu.Unlock()
		a.log("SFTP initialized")
	}

	a.app.Event.Emit("ssh.connected", map[string]string{
		"tabId":    tabId,
		"host":     host,
		"username": username,
	})

	go func() {
		time.Sleep(500 * time.Millisecond)
		a.startTerminal(tabId)
	}()
}

func parsePrivateKey(keyText, passphrase string) (ssh.Signer, error) {
	if passphrase != "" {
		return ssh.ParsePrivateKeyWithPassphrase([]byte(keyText), []byte(passphrase))
	}
	return ssh.ParsePrivateKey([]byte(keyText))
}

func (a *App) DisconnectSSH(tabId string) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	tab := a.tabs[tabId]
	if tab == nil {
		return nil
	}

	a.disconnectTabLocked(tab)

	a.app.Event.Emit("ssh.disconnected", map[string]string{
		"tabId":   tabId,
		"message": "Disconnected",
	})

	return nil
}
