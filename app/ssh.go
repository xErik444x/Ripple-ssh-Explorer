package app

import (
	"fmt"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

// ConnectSSH initiates an SSH connection in a background goroutine.
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
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), // TODO: implement known_hosts verification
	}

	if password != "" {
		config.Auth = append(config.Auth, ssh.Password(password))
	}

	if privateKeyText != "" {
		signer, err := parsePrivateKey(privateKeyText, passphrase)
		if err != nil {
			a.log(fmt.Sprintf("Private key parse error: %v", err))
			a.app.Event.Emit("ssh.error", map[string]string{
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

// DisconnectSSH closes the SFTP and SSH connections and emits a disconnect event.
func (a *App) DisconnectSSH() error {
	a.mu.Lock()
	defer a.mu.Unlock()

	var errs []error

	if a.sftpClient != nil {
		if err := a.sftpClient.Close(); err != nil {
			errs = append(errs, fmt.Errorf("sftp close: %w", err))
		}
		a.sftpClient = nil
	}
	if a.sshClient != nil {
		if err := a.sshClient.Close(); err != nil {
			errs = append(errs, fmt.Errorf("ssh close: %w", err))
		}
		a.sshClient = nil
	}
	a.terminalSession = nil

	a.app.Event.Emit("ssh.disconnected", map[string]string{
		"message": "Disconnected",
	})

	if len(errs) > 0 {
		return fmt.Errorf("disconnect errors: %v", errs)
	}
	return nil
}
