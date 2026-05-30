package app

import (
	"fmt"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

func (a *App) ConnectSSH(host, port, username, password, privateKeyText, passphrase string) {
	go a.connectSSHAsync(host, port, username, password, privateKeyText, passphrase)
}

func (a *App) connectSSHAsync(host, port, username, password, privateKeyText, passphrase string) {
	a.log(fmt.Sprintf("Connecting to %s:%s as %s", host, port, username))
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
		if err == nil {
			config.Auth = append(config.Auth, ssh.PublicKeys(signer))
		}
	}

	client, err := ssh.Dial("tcp", addr, config)
	if err != nil {
		a.log(fmt.Sprintf("SSH connection failed: %s", err.Error()))
		a.app.Event.Emit("ssh.error", map[string]string{
			"message": fmt.Sprintf("Connection failed: %s", err.Error()),
		})
		return
	}

	a.log("SSH connected successfully")
	a.mu.Lock()
	a.sshClient = client
	a.mu.Unlock()

	a.log("Initializing SFTP...")
	sftpC, err := sftp.NewClient(client)
	if err != nil {
		a.log(fmt.Sprintf("SFTP init failed: %s", err.Error()))
	} else {
		a.mu.Lock()
		a.sftpClient = sftpC
		a.mu.Unlock()
		a.log("SFTP initialized")
	}

	a.app.Event.Emit("ssh.connected", map[string]string{
		"host":     host,
		"username": username,
	})

	go func() {
		time.Sleep(500 * time.Millisecond)
		a.startTerminal()
	}()
}

func parsePrivateKey(keyText, passphrase string) (ssh.Signer, error) {
	if passphrase != "" {
		return ssh.ParsePrivateKeyWithPassphrase([]byte(keyText), []byte(passphrase))
	}
	return ssh.ParsePrivateKey([]byte(keyText))
}

func (a *App) DisconnectSSH() error {
	a.mu.Lock()
	defer a.mu.Unlock()

	if a.sftpClient != nil {
		a.sftpClient.Close()
		a.sftpClient = nil
	}
	if a.sshClient != nil {
		a.sshClient.Close()
		a.sshClient = nil
	}
	if a.terminalSession != nil {
		a.terminalSession = nil
	}

	a.app.Event.Emit("ssh.disconnected", map[string]string{
		"message": "Disconnected",
	})
	return nil
}
