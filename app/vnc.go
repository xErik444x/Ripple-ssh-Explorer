package app

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
	"golang.org/x/crypto/ssh"
)

type vncProxy struct {
	mu       sync.Mutex
	tabId    string
	listener net.Listener
	server   *http.Server
	done     chan struct{}
}

func (a *App) StartVNCProxy(tabId string) error {
	a.mu.RLock()
	tab := a.tabs[tabId]
	a.mu.RUnlock()

	if tab == nil || tab.SSHClient == nil {
		return fmt.Errorf("no active SSH connection for tab %s", tabId)
	}

	vncPort := tab.VncPort
	if vncPort == 0 {
		vncPort = 5900
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("failed to create VNC listener: %w", err)
	}

	proxy := &vncProxy{
		tabId:    tabId,
		listener: listener,
		done:     make(chan struct{}),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		a.handleVNCWebSocket(w, r, tab.SSHClient, vncPort, proxy)
	})

	proxy.server = &http.Server{Handler: mux}

	go func() {
		if err := proxy.server.Serve(listener); err != nil && err != http.ErrServerClosed {
			a.log(fmt.Sprintf("VNC proxy serve error: %v", err))
		}
	}()

	a.mu.Lock()
	if t := a.tabs[tabId]; t != nil {
		t.VNCProxy = proxy
	}
	a.mu.Unlock()

	addr := listener.Addr().(*net.TCPAddr)
	wsURL := fmt.Sprintf("ws://127.0.0.1:%d/", addr.Port)

	a.log(fmt.Sprintf("VNC proxy started at %s for tab %s", wsURL, tabId))

	a.app.Event.Emit("vnc.started", map[string]string{
		"tabId": tabId,
		"wsUrl": wsURL,
	})

	return nil
}

func (a *App) StopVNCProxy(tabId string) {
	a.mu.Lock()
	tab := a.tabs[tabId]
	if tab != nil && tab.VNCProxy != nil {
		tab.VNCProxy.stop()
		tab.VNCProxy = nil
	}
	a.mu.Unlock()
}

func (p *vncProxy) stop() {
	p.mu.Lock()
	defer p.mu.Unlock()
	select {
	case <-p.done:
		return
	default:
		close(p.done)
	}
	if p.server != nil {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = p.server.Shutdown(ctx)
	}
	if p.listener != nil {
		_ = p.listener.Close()
	}
}

func (a *App) handleVNCWebSocket(w http.ResponseWriter, r *http.Request, sshClient *ssh.Client, vncPort int, proxy *vncProxy) {
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
	})
	if err != nil {
		return
	}

	vncAddr := fmt.Sprintf("127.0.0.1:%d", vncPort)
	vncConn, err := sshClient.Dial("tcp", vncAddr)
	if err != nil {
		a.log(fmt.Sprintf("VNC SSH tunnel dial failed: %v", err))
		_ = c.Close(websocket.StatusInternalError, fmt.Sprintf("tunnel failed: %v", err))
		return
	}

	ctx := context.Background()

	go func() {
		defer func() {
			_ = vncConn.Close()
		}()
		for {
			_, msg, err := c.Read(ctx)
			if err != nil {
				return
			}
			if _, err := vncConn.Write(msg); err != nil {
				return
			}
		}
	}()

	buf := make([]byte, 65536)
	for {
		n, err := vncConn.Read(buf)
		if err != nil {
			if err != io.EOF {
				a.log(fmt.Sprintf("VNC tunnel read error: %v", err))
			}
			_ = c.Close(websocket.StatusNormalClosure, "tunnel closed")
			return
		}
		err = c.Write(ctx, websocket.MessageBinary, buf[:n])
		if err != nil {
			return
		}
	}
}
