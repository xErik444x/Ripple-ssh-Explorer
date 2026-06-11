let rfb = null;
let activeTabId = null;
let statusCallback = null;

function getRFB() {
  return window.RFB;
}

export function setStatusCallback(cb) {
  statusCallback = cb;
}

function setStatus(text, type) {
  const el = document.getElementById('vnc-status');
  if (el) el.textContent = text;
  const overlay = document.getElementById('vnc-overlay');
  const overlayText = document.getElementById('vnc-overlay-text');
  if (overlay && overlayText) {
    if (type === 'connecting' || type === 'loading') {
      overlay.classList.remove('hidden');
      overlayText.textContent = text;
    } else {
      overlay.classList.add('hidden');
    }
  }
  if (statusCallback) statusCallback(text, type);
}

export function connectVNC(tabId, wsUrl, password) {
  const RFB = getRFB();
  if (!RFB) {
    setStatus('VNC library not loaded', 'error');
    return;
  }

  if (rfb) {
    disconnectVNC();
  }

  activeTabId = tabId;
  setStatus('Connecting to remote desktop...', 'connecting');

  const canvas = document.getElementById('vnc-canvas');
  if (!canvas) return;

  try {
    rfb = new RFB(canvas, wsUrl, {
      shared: true,
      credentials: password ? { password } : {},
    });

    rfb.addEventListener('connect', () => {
      setStatus('Connected', 'connected');
      rfb.focus();
    });

    rfb.addEventListener('disconnect', (e) => {
      const reason = e.detail ? e.detail.clean : true;
      if (activeTabId) {
        if (!reason) {
          setStatus('Connection lost', 'error');
        } else {
          setStatus('Disconnected', 'disconnected');
        }
      }
      rfb = null;
      activeTabId = null;
    });

    rfb.addEventListener('credentialsrequired', () => {
      const vncPass = document.getElementById('vnc-password').value;
      if (vncPass) {
        rfb.sendCredentials({ password: vncPass });
      }
    });

    rfb.addEventListener('desktopname', (e) => {
      const name = e.detail.name;
      if (name) {
        const statusEl = document.getElementById('vnc-status');
        if (statusEl) statusEl.textContent = `Connected to ${name}`;
      }
    });

    rfb.addEventListener('clipboard', (e) => {
      const text = e.detail.text;
      if (text) {
        navigator.clipboard.writeText(text).catch(() => {});
      }
    });

    rfb.scaleViewport = true;
    rfb.resizeSession = true;
  } catch (err) {
    setStatus(`Connection failed: ${err.message}`, 'error');
    rfb = null;
    activeTabId = null;
  }
}

export function disconnectVNC() {
  if (rfb) {
    try {
      rfb.disconnect();
    } catch (e) {
      console.warn('[Ripple] VNC disconnect error:', e);
    }
    rfb = null;
  }
  activeTabId = null;
  setStatus('Disconnected', 'disconnected');
}

export function sendCtrlAltDel() {
  if (rfb) {
    rfb.sendCtrlAltDel();
  }
}

export function toggleFullscreen() {
  const panel = document.getElementById('vnc-panel');
  if (!panel) return;
  if (!document.fullscreenElement) {
    panel.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}
