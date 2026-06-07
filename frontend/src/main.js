import './style.css';
import { Events } from '@wailsio/runtime';
import * as App from '../bindings/ripple-ssh-wails/app/app';

const tabs = new Map();
const tabOrder = [];
let activeTabId = null;

let profiles = [];
let ctxTarget = null;
const activeTransfers = new Set();
const previewTransfers = {};
const previewCancelled = {};
const _closingTabIds = new Set();

const terminalSettings = {
  fontSize: 14,
  lineHeight: 1.5,
  fontFamily: 'Fira Code'
};

function escapeHtml(str) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(str).replace(/[&<>"']/g, c => map[c]);
}

function showToast(message, type = 'info', duration = 4000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.style.cssText = 'pointer-events:auto;padding:12px 18px;border-radius:8px;font-size:13px;color:#f9fafb;backdrop-filter:blur(12px);box-shadow:0 4px 12px rgba(0,0,0,0.3);opacity:0;transform:translateX(40px);transition:all 0.3s ease;max-width:380px;word-break:break-word;';
  const colors = { info: 'rgba(99,102,241,0.9)', success: 'rgba(16,185,129,0.9)', error: 'rgba(239,68,68,0.9)', warning: 'rgba(251,191,36,0.9)' };
  toast.style.backgroundColor = colors[type] || colors.info;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity = '1'; toast.style.transform = 'translateX(0)'; });
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(40px)';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

const ICONS = {
  folder: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>',
  file: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>',
  code: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>',
  zip: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="12" y1="3" x2="12" y2="21"></line><path d="M12 12h3"></path><path d="M12 16h3"></path><path d="M12 8h3"></path></svg>',
  image: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>'
};

document.addEventListener('DOMContentLoaded', () => {
  window.addEventListener('contextmenu', (e) => e.preventDefault());
  initApp().catch(err => {
    console.error('[Ripple SSH] Init failed:', err);
    showToast('Failed to initialize app: ' + err.message, 'error', 10000);
  });
});

function getActiveTab() {
  return activeTabId ? tabs.get(activeTabId) : null;
}

async function initApp() {
  await loadTerminalSettings();
  setupEventListeners();
  await loadProfiles();
  await createNewTab();
}

async function createNewTab(existingTabId) {
  const tabId = existingTabId || await App.NewTab();
  if (!tabId) return;

  const tab = {
    id: tabId,
    type: 'form',
    status: 'disconnected',
    label: 'New Connection',
    host: '',
    port: '22',
    username: '',
    authType: 'password',
    password: '',
    privateKeyText: '',
    passphrase: '',
    privateKeyPath: '',
    terminal: null,
    fitAddon: null,
    currentPath: '.',
    resizeObserver: null
  };

  tabs.set(tabId, tab);
  tabOrder.push(tabId);
  renderTabBar();
  switchToTab(tabId);
}

async function closeTab(tabId) {
  const tab = tabs.get(tabId);
  if (!tab) return;

  _closingTabIds.add(tabId);

  if (tab.status === 'connected') {
    try {
      await App.DisconnectSSH(tabId);
    } catch (e) {
      console.warn('[Ripple] Disconnect error on close:', e);
    }
  }

  if (tab.terminal) {
    disposeTerminal(tab);
  }

  App.CloseTab(tabId).catch(() => {});

  tabs.delete(tabId);
  const idx = tabOrder.indexOf(tabId);
  if (idx >= 0) tabOrder.splice(idx, 1);
  _closingTabIds.delete(tabId);

  if (tabOrder.length === 0) {
    createNewTab();
    renderTabBar();
    return;
  }

  if (activeTabId === tabId) {
    const connectedTabs = tabOrder.filter(id => {
      const t = tabs.get(id);
      return t && t.status === 'connected';
    });
    if (connectedTabs.length > 0) {
      switchToTab(connectedTabs[0]);
    } else {
      const newIdx = Math.min(idx, tabOrder.length - 1);
      switchToTab(tabOrder[newIdx]);
    }
  }
  renderTabBar();
}

function switchToTab(tabId) {
  const prevTab = getActiveTab();
  const newTab = tabs.get(tabId);
  if (!newTab) return;

  if (prevTab && prevTab.id !== tabId && prevTab.type === 'form') {
    saveFormToTab(prevTab);
  }

  const configPanel = document.getElementById('config-panel');
  const terminalPanel = document.getElementById('terminal-panel');

  document.querySelectorAll('.tab-item').forEach(el => el.classList.remove('active'));
  const tabEl = document.querySelector(`.tab-item[data-tab-id="${tabId}"]`);
  if (tabEl) tabEl.classList.add('active');

  document.querySelectorAll('.terminal-view').forEach(el => el.classList.remove('active'));

  const profilesPane = document.getElementById('profiles-pane');
  const sftpPane = document.getElementById('sftp-pane');

  if (newTab.type === 'terminal') {
    configPanel.classList.add('hidden');
    terminalPanel.classList.remove('hidden');
    profilesPane.classList.add('hidden');
    sftpPane.classList.remove('hidden');

    const tv = document.querySelector(`.terminal-view[data-tab-id="${tabId}"]`);
    if (tv) {
      tv.classList.add('active');
      if (newTab.fitAddon) {
        requestAnimationFrame(() => {
          newTab.fitAddon.fit();
          if (newTab.terminal) {
            App.ResizeTerminal(tabId, newTab.terminal.cols, newTab.terminal.rows).catch(() => {});
          }
        });
      }
    }
    updateHeaderStatus(newTab);
    loadDirectory(tabId, newTab.currentPath);
  } else {
    terminalPanel.classList.add('hidden');
    configPanel.classList.remove('hidden');
    profilesPane.classList.remove('hidden');
    sftpPane.classList.add('hidden');
    loadFormFromTab(newTab);
    updateHeaderStatus(null);

    document.getElementById('btn-disconnect').classList.add('hidden');
    document.getElementById('btn-settings').classList.add('hidden');
  }

  activeTabId = tabId;
}

function saveFormToTab(tab) {
  tab.host = document.getElementById('ssh-host').value.trim();
  tab.port = document.getElementById('ssh-port').value.trim() || '22';
  tab.username = document.getElementById('ssh-username').value.trim();
  const authBtn = document.querySelector('.auth-btn.active');
  tab.authType = authBtn ? authBtn.getAttribute('data-target') : 'password';
  tab.password = document.getElementById('ssh-password').value;
  tab.privateKeyPath = document.getElementById('ssh-key-path').value.trim();
  tab.privateKeyText = document.getElementById('ssh-key-text').value;
  tab.passphrase = document.getElementById('ssh-passphrase').value;
}

function loadFormFromTab(tab) {
  document.getElementById('ssh-host').value = tab.host;
  document.getElementById('ssh-port').value = tab.port;
  document.getElementById('ssh-username').value = tab.username;

  const authBtnPwd = document.getElementById('auth-btn-pwd');
  const authBtnKey = document.getElementById('auth-btn-key');

  if (tab.authType === 'password') {
    authBtnPwd.click();
    document.getElementById('ssh-password').value = tab.password;
  } else {
    authBtnKey.click();
    document.getElementById('ssh-key-path').value = tab.privateKeyPath;
    document.getElementById('ssh-key-text').value = tab.privateKeyText;
    document.getElementById('ssh-passphrase').value = tab.passphrase;
  }
}

function renderTabBar() {
  const list = document.getElementById('tab-list');
  list.innerHTML = '';

  tabOrder.forEach(id => {
    const tab = tabs.get(id);
    if (!tab) return;

    const item = document.createElement('div');
    item.className = `tab-item${id === activeTabId ? ' active' : ''}`;
    item.setAttribute('data-tab-id', id);
    item.setAttribute('title', tab.label);

    const dot = document.createElement('span');
    dot.className = `tab-status-dot ${tab.status}`;
    item.appendChild(dot);

    const label = document.createElement('span');
    label.className = 'tab-label';
    label.textContent = tab.label;
    item.appendChild(label);

    const close = document.createElement('button');
    close.className = 'tab-close';
    close.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(id);
    });
    item.appendChild(close);

    item.addEventListener('click', () => {
      switchToTab(id);
    });

    item.addEventListener('mousedown', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        closeTab(id);
      }
    });

    list.appendChild(item);
  });

  const addBtn = document.createElement('button');
  addBtn.className = 'tab-add';
  addBtn.title = 'New Tab';
  addBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
  addBtn.addEventListener('click', () => {
    if (getActiveTab() && getActiveTab().type === 'form') {
      saveFormToTab(getActiveTab());
    }
    createNewTab();
  });
  list.appendChild(addBtn);
}

function updateHeaderStatus(tab) {
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');

  if (tab && tab.status === 'connected') {
    statusDot.className = 'status-indicator connected';
    statusText.textContent = `Connected: ${tab.username}@${tab.host}`;
  } else {
    if (tab && tab.status === 'connecting') {
      statusText.textContent = `Connecting to ${tab.host}...`;
    } else {
      statusText.textContent = 'Disconnected';
    }
    statusDot.className = 'status-indicator disconnected';
  }
}

function disposeTerminal(tab) {
  if (tab.resizeObserver) {
    tab.resizeObserver.disconnect();
    tab.resizeObserver = null;
  }
  if (tab.fitAddon) {
    tab.fitAddon = null;
  }
  if (tab.terminal) {
    tab.terminal.dispose();
    tab.terminal = null;
  }
  const tv = document.querySelector(`.terminal-view[data-tab-id="${tab.id}"]`);
  if (tv) tv.remove();
  tab.type = 'form';
  tab.status = 'disconnected';
}

function initTerminalForTab(tabId) {
  const tab = tabs.get(tabId);
  if (!tab || tab.terminal) return;

  const views = document.getElementById('terminal-views');
  let view = document.querySelector(`.terminal-view[data-tab-id="${tabId}"]`);
  if (!view) {
    view = document.createElement('div');
    view.className = 'terminal-view';
    view.setAttribute('data-tab-id', tabId);
    views.appendChild(view);
  }

  try {
    const term = new Terminal({
      cursorBlink: true,
      fontSize: terminalSettings.fontSize,
      lineHeight: terminalSettings.lineHeight,
      fontFamily: `"${terminalSettings.fontFamily}", var(--font-mono)`
    });
    term.open(view);

    tab.terminal = term;
    tab.fitAddon = typeof FitAddon.FitAddon !== 'undefined' ? new FitAddon.FitAddon() : new FitAddon();
    if (tab.fitAddon.fit) {
      term.loadAddon(tab.fitAddon);
      requestAnimationFrame(() => tab.fitAddon.fit());
    }

    term.onData((data) => {
      const t = tabs.get(tabId);
      if (t && t.status === 'connected') {
        App.WriteTerminal(tabId, data).catch(err => console.warn('[Ripple] WriteTerminal:', err));
      }
    });

    if (tab.resizeObserver) tab.resizeObserver.disconnect();
    tab.resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        if (!tab.fitAddon || !tab.fitAddon.fit) return;
        tab.fitAddon.fit();
        if (tab.terminal) {
          App.ResizeTerminal(tabId, tab.terminal.cols, tab.terminal.rows).catch(() => {});
        }
      });
    });
    tab.resizeObserver.observe(view);

    view.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const ctx = document.getElementById('terminal-context-menu');
      const hasSelection = tab.terminal.getSelection().length > 0;
      document.getElementById('ctx-term-copy').style.display = hasSelection ? '' : 'none';
      ctx.style.display = 'block';
      ctx.style.left = `${e.clientX}px`;
      ctx.style.top = `${e.clientY}px`;
    });

    view.addEventListener('keydown', (e) => {
      if (e.shiftKey && (e.ctrlKey || e.metaKey)) {
        if (e.key === 'c' || e.key === 'C') {
          e.preventDefault();
          const text = tab.terminal.getSelection();
          if (text) navigator.clipboard.writeText(text).catch(err => console.warn('[Ripple] Clipboard write:', err));
          tab.terminal.focus();
        } else if (e.key === 'v' || e.key === 'V') {
          e.preventDefault();
          navigator.clipboard.readText().then(text => {
            if (text && tab.status === 'connected') App.WriteTerminal(tabId, text).catch(err => console.warn('[Ripple] WriteTerminal:', err));
          }).catch(err => console.warn('[Ripple] Clipboard read:', err));
          tab.terminal.focus();
        }
      }
    });

  } catch (e) {
    showToast(`Error terminal: ${e.message}`, 'error', 10000);
  }
}

function setupEventListeners_backend() {
  Events.On('ssh.connected', (event) => {
    const data = event.data;
    const { tabId, host, username } = data;
    const tab = tabs.get(tabId);
    if (!tab) return;

    tab.status = 'connected';
    tab.host = host;
    tab.username = username;
    tab.label = `${username}@${host}`;
    tab.type = 'terminal';

    initTerminalForTab(tabId);
    tab.currentPath = '.';

    if (activeTabId === tabId) {
      updateHeaderStatus(tab);
      document.getElementById('btn-disconnect').classList.remove('hidden');
      document.getElementById('btn-settings').classList.remove('hidden');

      const configPanel = document.getElementById('config-panel');
      const terminalPanel = document.getElementById('terminal-panel');
      configPanel.classList.add('hidden');
      terminalPanel.classList.remove('hidden');

      document.getElementById('profiles-pane').classList.add('hidden');
      document.getElementById('sftp-pane').classList.remove('hidden');

      const tv = document.querySelector(`.terminal-view[data-tab-id="${tabId}"]`);
      if (tv) {
        document.querySelectorAll('.terminal-view').forEach(el => el.classList.remove('active'));
        tv.classList.add('active');
        if (tab.fitAddon) {
          requestAnimationFrame(() => {
            tab.fitAddon.fit();
            tab.terminal.focus();
          });
        }
      }

      setTimeout(() => loadDirectory(tabId, tab.currentPath), 200);
    }

    const connectBtn = document.getElementById('btn-connect');
    connectBtn.disabled = false;
    connectBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><polyline points="10 17 15 12 10 7"></polyline><line x1="15" y1="12" x2="3" y2="12"></line></svg> Connect Now';

    renderTabBar();
  });

  Events.On('ssh.error', (event) => {
    const data = event.data;
    const { tabId, message } = data;
    showToast(`SSH Error: ${message}`, 'error');
    const tab = tabs.get(tabId);
    if (tab) {
      tab.status = 'disconnected';
      renderTabBar();
      if (activeTabId === tabId) updateHeaderStatus(tab);
    }
    document.getElementById('btn-connect').disabled = false;
    document.getElementById('btn-connect').innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><polyline points="10 17 15 12 10 7"></polyline><line x1="15" y1="12" x2="3" y2="12"></line></svg> Connect Now';
  });

  Events.On('ssh.disconnected', (event) => {
    const data = event.data;
    const tabId = data && data.tabId;
    const tab = tabs.get(tabId);
    if (!tab) return;

    tab.status = 'disconnected';

    if (tab.terminal) {
      disposeTerminal(tab);
    }

    if (!_closingTabIds.has(tabId) && activeTabId === tabId) {
      const connectedTabs = tabOrder.filter(id => {
        const t = tabs.get(id);
        return t && t.status === 'connected';
      });
      if (connectedTabs.length > 0) {
        switchToTab(connectedTabs[0]);
      } else {
        switchToTab(tabId);
      }
    }

    renderTabBar();
  });

  Events.On('terminal.data', (event) => {
    const data = event.data;
    const { tabId, data: termData } = data;
    const tab = tabs.get(tabId);
    if (tab && tab.terminal) {
      tab.terminal.write(termData);
      tab.terminal.scrollToBottom();
    }
  });

  Events.On('sftp.progress', (event) => {
    const data = event.data;
    const { action, transferred, total, percent } = data;
    const id = data.id || '';
    if (id && activeTransfers.has(id)) {
      showTransferStatus(
        `${action === 'download' ? 'Downloading' : 'Uploading'}...`,
        percent,
        `${formatBytes(transferred)} / ${formatBytes(total)}`
      );
    }
    if (id && previewTransfers[id]) {
      updatePreviewProgress(percent, transferred, total);
    }
  });
}

async function loadTerminalSettings() {
  try {
    const raw = await App.LoadSettings();
    if (raw) {
      const data = JSON.parse(raw);
      if (data && Object.keys(data).length > 0) Object.assign(terminalSettings, data);
    }
    } catch (e) { console.warn('[Ripple] Failed to load settings:', e); }
}

async function saveTerminalSettings() {
  await App.SaveSettings(JSON.stringify(terminalSettings));
}

function applyTerminalSettings() {
  tabs.forEach(tab => {
    if (!tab.terminal) return;
    tab.terminal.options.fontSize = terminalSettings.fontSize;
    tab.terminal.options.lineHeight = terminalSettings.lineHeight;
    tab.terminal.options.fontFamily = `"${terminalSettings.fontFamily}", var(--font-mono)`;
    if (tab.fitAddon && tab.fitAddon.fit) {
      tab.terminal.resize(tab.terminal.cols + 1, tab.terminal.rows);
      tab.fitAddon.fit();
    }
  });
}

function setupSettingsDialog() {
  const fontSizeSlider = document.getElementById('settings-font-size');
  const lineHeightSlider = document.getElementById('settings-line-height');
  const fontSelect = document.getElementById('settings-font-family');
  const fontSizeVal = document.getElementById('settings-font-size-val');
  const lineHeightVal = document.getElementById('settings-line-height-val');

  fontSizeSlider.value = terminalSettings.fontSize;
  lineHeightSlider.value = terminalSettings.lineHeight;
  fontSelect.value = terminalSettings.fontFamily;
  fontSizeVal.textContent = terminalSettings.fontSize;
  lineHeightVal.textContent = terminalSettings.lineHeight;

  fontSizeSlider.addEventListener('input', () => {
    fontSizeVal.textContent = fontSizeSlider.value;
  });
  lineHeightSlider.addEventListener('input', () => {
    lineHeightVal.textContent = lineHeightSlider.value;
  });

  document.getElementById('form-settings').addEventListener('submit', (e) => {
    e.preventDefault();
    terminalSettings.fontSize = parseInt(fontSizeSlider.value);
    terminalSettings.lineHeight = parseFloat(lineHeightSlider.value);
    terminalSettings.fontFamily = fontSelect.value;
    saveTerminalSettings();
    applyTerminalSettings();
    document.getElementById('dialog-settings').close();
    showToast('Terminal settings applied', 'success');
  });

  document.getElementById('btn-settings').addEventListener('click', () => {
    fontSizeSlider.value = terminalSettings.fontSize;
    lineHeightSlider.value = terminalSettings.lineHeight;
    fontSelect.value = terminalSettings.fontFamily;
    fontSizeVal.textContent = terminalSettings.fontSize;
    lineHeightVal.textContent = terminalSettings.lineHeight;
    document.getElementById('dialog-settings').showModal();
  });
}

function setupEventListeners() {
  const authBtnPwd = document.getElementById('auth-btn-pwd');
  const authBtnKey = document.getElementById('auth-btn-key');
  const _pwdGroup = document.getElementById('auth-password-group');
  const _keyGroup = document.getElementById('auth-key-group');

  authBtnPwd.addEventListener('click', () => {
    authBtnPwd.classList.add('active');
    authBtnKey.classList.remove('active');
    _pwdGroup.classList.remove('hidden');
    _keyGroup.classList.add('hidden');
  });

  authBtnKey.addEventListener('click', () => {
    authBtnKey.classList.add('active');
    authBtnPwd.classList.remove('active');
    _keyGroup.classList.remove('hidden');
    _pwdGroup.classList.add('hidden');
  });

  document.getElementById('btn-browse-key').addEventListener('click', async () => {
    try {
      const selected = await App.ShowOpenDialog();
      if (selected && selected.length > 0) {
        document.getElementById('ssh-key-path').value = selected;
      }
    } catch (err) {
      console.warn('[Ripple] Browse key dialog:', err);
    }
  });

  document.getElementById('btn-disconnect').addEventListener('click', () => {
    const tab = getActiveTab();
    if (tab) {
      App.DisconnectSSH(tab.id).catch(err => console.warn('[Ripple] Disconnect:', err));
    }
  });

  document.getElementById('ssh-form').addEventListener('submit', (e) => {
    e.preventDefault();
    connectSsh();
  });

  document.getElementById('btn-save-profile').addEventListener('click', saveProfile);
  document.getElementById('btn-new-profile').addEventListener('click', clearForm);

  document.getElementById('sftp-btn-refresh').addEventListener('click', () => {
    const tab = getActiveTab();
    if (tab) loadDirectory(tab.id, tab.currentPath);
  });

  document.getElementById('sftp-btn-mkdir').addEventListener('click', () => {
    document.getElementById('mkdir-name').value = '';
    document.getElementById('dialog-mkdir').showModal();
  });

  document.getElementById('form-mkdir').addEventListener('submit', (e) => {
    e.preventDefault();
    const tab = getActiveTab();
    if (!tab) return;
    const folderName = document.getElementById('mkdir-name').value.trim();
    if (folderName) {
      document.getElementById('dialog-mkdir').close();
      const folderPath = joinPath(tab.currentPath, folderName);
      App.Mkdir(tab.id, folderPath).then(() => {
        loadDirectory(tab.id, tab.currentPath);
      }).catch(err => {
        showToast(`Failed to create folder: ${err}`, 'error');
      });
    }
  });

  document.getElementById('sftp-btn-upload').addEventListener('click', triggerUpload);

  document.getElementById('sftp-btn-up').addEventListener('click', () => {
    const tab = getActiveTab();
    if (!tab) return;
    if (tab.currentPath !== '.' && tab.currentPath !== '/') {
      const upPath = getParentPath(tab.currentPath);
      loadDirectory(tab.id, upPath);
    }
  });

  document.getElementById('sftp-filter').addEventListener('input', (e) => {
    const filterText = e.target.value.toLowerCase();
    const items = document.querySelectorAll('.file-item');
    items.forEach(item => {
      const name = item.getAttribute('data-name').toLowerCase();
      if (name.includes(filterText)) {
        item.style.display = 'flex';
      } else {
        item.style.display = 'none';
      }
    });
  });

  const contextMenu = document.getElementById('file-context-menu');
  const termCtx = document.getElementById('terminal-context-menu');

  window.addEventListener('click', () => {
    contextMenu.style.display = 'none';
    termCtx.style.display = 'none';
    const tab = getActiveTab();
    if (tab && tab.terminal) {
      tab.terminal.focus();
    }
  });

  document.getElementById('ctx-term-copy').addEventListener('click', () => {
    const tab = getActiveTab();
    const text = tab && tab.terminal ? tab.terminal.getSelection() : '';
    if (text) {
      navigator.clipboard.writeText(text).catch(err => console.warn('[Ripple] Clipboard write:', err));
    }
    termCtx.style.display = 'none';
    if (tab && tab.terminal) tab.terminal.focus();
  });

  document.getElementById('ctx-term-paste').addEventListener('click', () => {
    const tab = getActiveTab();
    navigator.clipboard.readText().then(text => {
      if (text && tab && tab.status === 'connected') {
        App.WriteTerminal(tab.id, text).catch(err => console.warn('[Ripple] WriteTerminal:', err));
      }
    }).catch(err => console.warn('[Ripple] Clipboard read:', err));
    termCtx.style.display = 'none';
    if (tab && tab.terminal) tab.terminal.focus();
  });

  document.getElementById('ctx-download').addEventListener('click', triggerDownload);
  document.getElementById('ctx-preview').addEventListener('click', triggerPreview);
  document.getElementById('ctx-rename').addEventListener('click', openRenameDialog);
  document.getElementById('ctx-delete').addEventListener('click', triggerDelete);

  const previewDialog = document.getElementById('dialog-preview');
  document.getElementById('btn-preview-close').addEventListener('click', () => {
    previewDialog.close();
  });
  document.getElementById('btn-preview-open-external').addEventListener('click', openPreviewWithExternalApp);
  document.getElementById('btn-preview-download').addEventListener('click', savePreviewAs);

  previewDialog.addEventListener('click', (e) => {
    const rect = previewDialog.getBoundingClientRect();
    const isInDialog = (
      rect.top <= e.clientY && e.clientY <= rect.top + rect.height &&
      rect.left <= e.clientX && e.clientX <= rect.left + rect.width
    );
    if (!isInDialog) {
      previewDialog.close();
    }
  });
  previewDialog.addEventListener('close', cleanupPreviewResources);
  previewDialog.addEventListener('cancel', cleanupPreviewResources);

  document.getElementById('form-rename').addEventListener('submit', (e) => {
    e.preventDefault();
    const tab = getActiveTab();
    if (!tab) return;
    const newName = document.getElementById('rename-new-name').value.trim();
    const originalPath = document.getElementById('rename-original-path').value;
    if (newName && originalPath) {
      document.getElementById('dialog-rename').close();
      const parent = getParentPath(originalPath);
      const destPath = joinPath(parent, newName);
      App.RenameFile(tab.id, originalPath, destPath).then(() => {
        loadDirectory(tab.id, tab.currentPath);
      }).catch(err => {
        showToast(`Rename failed: ${err}`, 'error');
      });
    }
  });

  setupSettingsDialog();
  setupEventListeners_backend();
}

function loadDirectory(tabId, path) {
  if (!tabId) return;
  document.getElementById('sftp-file-list').innerHTML = '<div class="loading-state">Loading directory...</div>';
  App.ListDirectory(tabId, path).then(files => {
    const tab = tabs.get(tabId);
    if (!tab) return;
    if (typeof files === 'string') files = JSON.parse(files);
    tab.currentPath = path;
    renderFileList(files);
    renderBreadcrumbs(path);
  }).catch(err => {
    console.error('[Ripple SSH] ListDirectory error:', err);
    showToast(`Failed to list directory "${escapeHtml(path)}": ${escapeHtml(String(err))}`, 'error');
    document.getElementById('sftp-file-list').innerHTML = `
      <div class="empty-state" style="color: var(--accent-danger)">
        Error: ${escapeHtml(String(err))}
      </div>
    `;
  });
}

function connectSsh() {
  const tab = getActiveTab();
  if (!tab || tab.status === 'connecting' || tab.status === 'connected') return;

  const connectBtn = document.getElementById('btn-connect');
  connectBtn.disabled = true;
  connectBtn.textContent = 'Connecting...';

  saveFormToTab(tab);

  tab.label = `${tab.username}@${tab.host}`;
  tab.status = 'connecting';
  renderTabBar();
  updateHeaderStatus(tab);

  App.ConnectSSH(tab.id, tab.host, tab.port, tab.username, tab.password, tab.privateKeyText, tab.passphrase).catch(err => {
    showToast(`SSH Error: ${err}`, 'error');
    tab.status = 'disconnected';
    connectBtn.disabled = false;
    connectBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><polyline points="10 17 15 12 10 7"></polyline><line x1="15" y1="12" x2="3" y2="12"></line></svg> Connect Now';
    renderTabBar();
    if (activeTabId === tab.id) updateHeaderStatus(tab);
  });

  const profileName = document.getElementById('profile-name').value.trim();
  if (profileName) {
    saveProfileData(profileName, { host: tab.host, port: tab.port, username: tab.username, password: tab.password, privateKeyPath: document.getElementById('ssh-key-path').value.trim(), privateKeyText: tab.privateKeyText, passphrase: tab.passphrase }, tab.authType);
  }
}

function renderFileList(files) {
  const listContainer = document.getElementById('sftp-file-list');
  listContainer.innerHTML = '';

  if (files.length === 0) {
    listContainer.innerHTML = '<div class="empty-state">This directory is empty</div>';
    return;
  }

  files.sort((a, b) => {
    if (a.isDir && !b.isDir) return -1;
    if (!a.isDir && b.isDir) return 1;
    return a.name.localeCompare(b.name);
  });

  files.forEach(file => {
    const item = document.createElement('div');
    item.className = `file-item ${file.isDir ? 'directory' : ''}`;
    item.setAttribute('data-name', file.name);
    const tab = getActiveTab();
    item.setAttribute('data-path', tab ? joinPath(tab.currentPath, file.name) : file.name);
    item.setAttribute('data-isdir', file.isDir);

    let icon = ICONS.file;
    if (file.isDir) {
      icon = ICONS.folder;
    } else {
      const ext = file.name.split('.').pop().toLowerCase();
      if (['js', 'json', 'py', 'html', 'css', 'ts', 'rs', 'cpp', 'c', 'sh', 'php'].includes(ext)) {
        icon = ICONS.code;
      } else if (['zip', 'tar', 'gz', 'rar', '7z'].includes(ext)) {
        icon = ICONS.zip;
      } else if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(ext)) {
        icon = ICONS.image;
      }
    }

    item.innerHTML = `
      <div class="file-item-icon">${icon}</div>
      <div class="file-item-name">${escapeHtml(file.name)}</div>
      <div class="file-item-size">${file.isDir ? '--' : formatBytes(file.size)}</div>
    `;

    item.addEventListener('dblclick', () => {
      const t = getActiveTab();
      if (!t) return;
      if (file.isDir) {
        const nextPath = joinPath(t.currentPath, file.name);
        loadDirectory(t.id, nextPath);
      } else {
        triggerFileDownload(t.id, joinPath(t.currentPath, file.name), file.name);
      }
    });

    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const t = getActiveTab();
      ctxTarget = {
        name: file.name,
        path: t ? joinPath(t.currentPath, file.name) : file.name,
        isDir: file.isDir
      };

      const contextMenu = document.getElementById('file-context-menu');
      contextMenu.style.display = 'block';
      contextMenu.style.left = `${e.clientX}px`;
      contextMenu.style.top = `${e.clientY}px`;
    });

    listContainer.appendChild(item);
  });
}

function renderBreadcrumbs(pathStr) {
  const container = document.getElementById('sftp-breadcrumbs');

  if (pathStr === '.' || pathStr === '/') {
    container.innerHTML = '/';
    return;
  }

  const parts = pathStr.split('/').filter(Boolean);
  let html = `<span class="crumb" data-path="/">/</span>`;
  let accumPath = '';

  parts.forEach((part, _index) => {
    accumPath += '/' + part;
    html += ` <span style="color: var(--text-muted)">/</span> <span class="crumb" data-path="${escapeHtml(accumPath)}">${escapeHtml(part)}</span>`;
  });

  container.innerHTML = html;

  container.querySelectorAll('.crumb').forEach(el => {
    el.addEventListener('click', () => {
      const t = getActiveTab();
      if (t) loadDirectory(t.id, el.getAttribute('data-path'));
    });
  });
}

function triggerDownload() {
  if (!ctxTarget || ctxTarget.isDir) return;
  const tab = getActiveTab();
  if (!tab) return;
  triggerFileDownload(tab.id, ctxTarget.path, ctxTarget.name);
}

async function triggerFileDownload(tabId, remoteFilePath, filename) {
  try {
    const localDest = await App.ShowSaveDialog(filename);

    if (localDest) {
      const transferId = Math.random().toString(36).substring(2, 9);
      activeTransfers.add(transferId);

      showTransferStatus('Preparing Download...', 0, 'Starting stream...');

      App.DownloadFile(tabId, remoteFilePath, localDest).then(() => {
        activeTransfers.delete(transferId);
        showToast(`Download completed:\n${localDest}`, 'success');
        hideTransferStatus();
      }).catch(err => {
        activeTransfers.delete(transferId);
        showToast(`Download failed: ${err}`, 'error');
        hideTransferStatus();
      });
    }
  } catch (err) {
    console.warn('[Ripple] Download cancelled:', err);
  }
}

function openRenameDialog() {
  if (!ctxTarget) return;
  document.getElementById('rename-original-path').value = ctxTarget.path;
  document.getElementById('rename-new-name').value = ctxTarget.name;
  document.getElementById('dialog-rename').showModal();
}

async function triggerDelete() {
  if (!ctxTarget) return;

  const confirm = await App.ShowMessage(
    'Delete File/Folder',
    `Are you sure you want to delete this remote item?\n${ctxTarget.name}`
  );

  if (confirm === 'Yes') {
    const tab = getActiveTab();
    if (!tab) return;
    App.DeleteFile(tab.id, ctxTarget.path, ctxTarget.isDir).then(() => {
      loadDirectory(tab.id, tab.currentPath);
    }).catch(err => {
      showToast(`Delete failed: ${err}`, 'error');
    });
  }
}

async function triggerUpload() {
  const tab = getActiveTab();
  if (!tab) return;

  try {
    const selected = await App.ShowOpenDialog();
    if (selected && selected.length > 0) {
      const localFilePath = selected;
      const filename = localFilePath.split(/[/\\]/).pop();
      const remoteFilePath = joinPath(tab.currentPath, filename);

      const transferId = Math.random().toString(36).substring(2, 9);
      activeTransfers.add(transferId);

      showTransferStatus('Preparing Upload...', 0, 'Starting stream...');

      App.UploadFile(tab.id, localFilePath, remoteFilePath).then(() => {
        activeTransfers.delete(transferId);
        showToast(`Upload completed:\n${remoteFilePath}`, 'success');
        hideTransferStatus();
        loadDirectory(tab.id, tab.currentPath);
      }).catch(err => {
        activeTransfers.delete(transferId);
        showToast(`Upload failed: ${err}`, 'error');
        hideTransferStatus();
      });
    }
  } catch (err) {
    console.warn('[Ripple] Upload cancelled:', err);
  }
}

function showTransferStatus(title, percent, meta) {
  const panel = document.getElementById('transfer-panel');
  panel.classList.remove('hidden');
  document.getElementById('transfer-title').textContent = title;
  document.getElementById('transfer-percent').textContent = `${percent}%`;
  document.getElementById('transfer-progress').style.width = `${percent}%`;
  document.getElementById('transfer-meta').textContent = meta;
}

function hideTransferStatus() {
  document.getElementById('transfer-panel').classList.add('hidden');
  activeTransfers.clear();
}

async function saveProfile() {
  const host = document.getElementById('ssh-host').value.trim();
  const port = document.getElementById('ssh-port').value.trim() || '22';
  const username = document.getElementById('ssh-username').value.trim();

  if (!host || !username) {
    showToast('Please fill out Host and Username to save a profile.', 'warning');
    return;
  }

  const authType = document.querySelector('.auth-btn.active').getAttribute('data-target');
  let name = document.getElementById('profile-name').value.trim();

  if (!name) {
    name = `${username}@${host}:${port}`;
    document.getElementById('profile-name').value = name;
  }

  const payload = { host, port, username };
  if (authType === 'password') {
    payload.password = document.getElementById('ssh-password').value;
  } else {
    payload.privateKeyPath = document.getElementById('ssh-key-path').value.trim();
    payload.privateKeyText = document.getElementById('ssh-key-text').value;
    payload.passphrase = document.getElementById('ssh-passphrase').value;
  }

  await saveProfileData(name, payload, authType);
  showToast(`Profile "${name}" saved!`, 'success');
}

async function saveProfileData(name, credentials, authType) {
  const existingIndex = profiles.findIndex(p => p.name.toLowerCase() === name.toLowerCase());

  const profileObject = {
    id: existingIndex >= 0 ? profiles[existingIndex].id : Date.now().toString(),
    name,
    authType,
    credentials
  };

  if (existingIndex >= 0) {
    profiles[existingIndex] = profileObject;
  } else {
    profiles.push(profileObject);
  }

  try {
    await App.SaveProfiles(JSON.stringify(profiles));
    renderProfiles();
  } catch (err) {
    console.warn('[Ripple] Save profiles error:', err);
  }
}

async function loadProfiles() {
  try {
    const raw = await App.LoadProfiles();
    profiles = raw ? JSON.parse(raw) : [];
  } catch {
    profiles = [];
  }
  renderProfiles();
}

function renderProfiles() {
  const list = document.getElementById('profile-list');
  list.innerHTML = '';

  if (profiles.length === 0) {
    list.innerHTML = '<div class="empty-state">No saved profiles</div>';
    return;
  }

  profiles.forEach(p => {
    const item = document.createElement('div');
    item.className = 'profile-item';

    item.innerHTML = `
      <div class="profile-info">
        <span class="profile-name">${escapeHtml(p.name)}</span>
        <span class="profile-host">${escapeHtml(p.credentials.username)}@${escapeHtml(p.credentials.host)}:${escapeHtml(p.credentials.port)}</span>
      </div>
      <div class="profile-item-actions">
        <button class="btn-icon-sm btn-delete-profile" title="Delete Profile">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
    `;

    item.addEventListener('click', (e) => {
      if (e.target.closest('.btn-delete-profile')) return;
      loadProfileIntoForm(p);
    });

    item.querySelector('.btn-delete-profile').addEventListener('click', async (e) => {
      e.stopPropagation();
      const confirm = await App.ShowMessage(
        'Delete Profile',
        `Are you sure you want to delete profile "${p.name}"?`
      );
      if (confirm === 'Yes') {
        profiles = profiles.filter(prof => prof.id !== p.id);
          try {
            await App.SaveProfiles(JSON.stringify(profiles));
            renderProfiles();
          } catch (err) {
            console.warn('[Ripple] Delete profile save error:', err);
          }
      }
    });

    list.appendChild(item);
  });
}

function loadProfileIntoForm(p) {
  const tab = getActiveTab();
  if (!tab || tab.type !== 'form') {
    showToast('Switch to a New Connection tab to load a profile.', 'info');
    return;
  }

  document.getElementById('profile-id').value = p.id;
  document.getElementById('profile-name').value = p.name;

  tab.host = p.credentials.host;
  tab.port = p.credentials.port;
  tab.username = p.credentials.username;

  document.getElementById('ssh-host').value = p.credentials.host;
  document.getElementById('ssh-port').value = p.credentials.port;
  document.getElementById('ssh-username').value = p.credentials.username;

  const authBtnPwd = document.getElementById('auth-btn-pwd');
  const authBtnKey = document.getElementById('auth-btn-key');

  if (p.authType === 'password') {
    authBtnPwd.click();
    tab.authType = 'password';
    tab.password = p.credentials.password || '';
    document.getElementById('ssh-password').value = p.credentials.password || '';
  } else {
    authBtnKey.click();
    tab.authType = 'key';
    tab.privateKeyPath = p.credentials.privateKeyPath || '';
    tab.privateKeyText = p.credentials.privateKeyText || '';
    tab.passphrase = p.credentials.passphrase || '';
    document.getElementById('ssh-key-path').value = p.credentials.privateKeyPath || '';
    document.getElementById('ssh-key-text').value = p.credentials.privateKeyText || '';
    document.getElementById('ssh-passphrase').value = p.credentials.passphrase || '';
  }
}

function clearForm() {
  const tab = getActiveTab();
  if (tab && tab.type === 'form') {
    tab.host = '';
    tab.port = '22';
    tab.username = '';
    tab.password = '';
    tab.privateKeyPath = '';
    tab.privateKeyText = '';
    tab.passphrase = '';
    tab.authType = 'password';
  }

  document.getElementById('profile-id').value = '';
  document.getElementById('profile-name').value = '';
  document.getElementById('ssh-host').value = '';
  document.getElementById('ssh-port').value = '22';
  document.getElementById('ssh-username').value = '';
  document.getElementById('ssh-password').value = '';
  document.getElementById('ssh-key-path').value = '';
  document.getElementById('ssh-key-text').value = '';
  document.getElementById('ssh-passphrase').value = '';

  document.getElementById('auth-btn-pwd').click();
}

function joinPath(base, segment) {
  if (base === '/') {
    return '/' + segment;
  }
  if (base === '.') {
    return segment;
  }
  const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
  return cleanBase + '/' + segment;
}

function getParentPath(pathStr) {
  if (pathStr === '/' || pathStr === '.' || !pathStr) return '/';

  const parts = pathStr.split('/').filter(Boolean);
  if (parts.length <= 1) {
    return pathStr.startsWith('/') ? '/' : '.';
  }

  parts.pop();
  return (pathStr.startsWith('/') ? '/' : '') + parts.join('/');
}

function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  if (!bytes) return '--';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function getMimeFromExt(ext) {
  const map = {
    png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp', ico:'image/x-icon', bmp:'image/bmp',
    svg:'image/svg+xml',
    pdf:'application/pdf',
    mp4:'video/mp4', webm:'video/webm', mkv:'video/x-matroska', mov:'video/quicktime', avi:'video/x-msvideo', flv:'video/x-flv', wmv:'video/x-ms-wmv',
    mp3:'audio/mpeg', wav:'audio/wav', ogg:'audio/ogg', flac:'audio/flac', aac:'audio/m4a', m4a:'audio/mp4', wma:'audio/x-ms-wma',
    js:'text/javascript', json:'application/json', py:'text/x-python', html:'text/html', css:'text/css', ts:'text/typescript', rs:'text/rust', cpp:'text/x-c++src', c:'text/x-csrc', sh:'application/x-sh', php:'application/x-httpd-php', txt:'text/plain', md:'text/markdown', log:'text/plain', xml:'application/xml', yaml:'application/x-yaml', yml:'application/x-yaml', ini:'text/plain', conf:'text/plain', sql:'text/x-sql', bat:'application/x-bat', cmd:'application/x-cmd', ps1:'application/x-powershell',
    lua:'text/x-lua', go:'text/x-go', java:'text/x-java', rb:'text/x-ruby', kt:'text/x-kotlin', swift:'text/x-swift', dart:'text/x-dart', vue:'text/x-vue', scss:'text/x-scss', sass:'text/x-sass', less:'text/x-less', h:'text/x-chdr', hpp:'text/x-c++hdr', cs:'text/x-csharp', pl:'text/x-perl', r:'text/x-r', dockerfile:'text/x-dockerfile'
  };
  return map[ext] || 'application/octet-stream';
}

function detectFileTypeFromName(filename) {
  const ext = filename.split('.').pop().toLowerCase();

  const imageExts = ['png','jpg','jpeg','gif','svg','webp','ico','bmp'];
  const textExts  = ['js','json','py','html','css','ts','rs','cpp','c','sh','php','txt','md','log','xml','yaml','yml','ini','conf','sql','bat','cmd','ps1','lua','go','java','rb','kt','swift','dart','vue','scss','sass','less','h','hpp','cs','pl','r','dockerfile','gitignore','env'];
  const pdfExts   = ['pdf'];
  const videoExts = ['mp4','webm','mkv','mov','avi','flv','wmv'];
  const audioExts = ['mp3','wav','ogg','flac','aac','m4a','wma'];

  if (imageExts.includes(ext)) return { category: 'image', mime: getMimeFromExt(ext) };
  if (textExts.includes(ext))  return { category: 'text', mime: getMimeFromExt(ext) };
  if (pdfExts.includes(ext))   return { category: 'pdf', mime: 'application/pdf' };
  if (videoExts.includes(ext)) return { category: 'video', mime: getMimeFromExt(ext) };
  if (audioExts.includes(ext)) return { category: 'audio', mime: getMimeFromExt(ext) };

  return { category: 'unsupported', mime: 'application/octet-stream' };
}

async function triggerPreview() {
  if (!ctxTarget || ctxTarget.isDir) return;

  const previewDialog = document.getElementById('dialog-preview');
  try {
    openPreviewLoading(ctxTarget.name);

    previewDialog.setAttribute('data-remote-path', ctxTarget.path);

    const safeName = ctxTarget.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const tab = getActiveTab();
    if (!tab) return;
    const tempPath = await App.DownloadToTemp(tab.id, ctxTarget.path, safeName);
    const stats = await App.GetFileStats(tempPath);
    const base64Data = await App.ReadFileAsBase64(tempPath);

    const detected = detectFileTypeFromName(ctxTarget.name);
    const previewData = {
      localPath: tempPath,
      filename: ctxTarget.name,
      detected,
      base64Data,
      fileSize: stats
    };

    await showPreviewFromBase64(previewData);
  } catch (err) {
    showToast('Failed to initialize preview: ' + err.message, 'error');
    hidePreviewLoading();
    document.getElementById('preview-unsupported-container').classList.remove('hidden');
    const msg = document.querySelector('.preview-unsupported-message');
    if (msg) msg.textContent = err.message || 'Failed to load preview';
    if (!previewDialog.open) previewDialog.showModal();
  }
}

function openPreviewLoading(filename) {
  const dialog = document.getElementById('dialog-preview');
  document.getElementById('preview-title').textContent = filename;
  document.getElementById('preview-type').textContent = 'Type: -';
  document.getElementById('preview-size').textContent = 'Size: -';

  document.getElementById('preview-image-container').classList.add('hidden');
  document.getElementById('preview-text-container').classList.add('hidden');
  document.getElementById('preview-pdf-container').classList.add('hidden');
  document.getElementById('preview-video-container').classList.add('hidden');
  document.getElementById('preview-audio-container').classList.add('hidden');
  document.getElementById('preview-unsupported-container').classList.add('hidden');

  const loading = document.getElementById('preview-loading-container');
  loading.style.display = 'flex';
  updatePreviewProgress(0, 0, 0);

  if (!dialog.open) {
    dialog.showModal();
  }
}

function updatePreviewProgress(percent, transferred, total) {
  const bar = document.getElementById('preview-progress-bar');
  const percentEl = document.getElementById('preview-loading-percent');
  const metaEl = document.getElementById('preview-loading-meta');
  if (bar) bar.style.width = `${percent}%`;
  if (percentEl) percentEl.textContent = `${percent}%`;
  if (metaEl) metaEl.textContent = total > 0 ? `${formatBytes(transferred)} / ${formatBytes(total)}` : '';
}

function hidePreviewLoading() {
  const loading = document.getElementById('preview-loading-container');
  if (loading) loading.style.display = 'none';
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function showPreviewFromBase64(previewData) {
  const { localPath, filename, detected, base64Data, fileSize } = previewData;
  const dialog = document.getElementById('dialog-preview');

  const titleEl = document.getElementById('preview-title');
  const typeEl = document.getElementById('preview-type');
  const sizeEl = document.getElementById('preview-size');

  const imgContainer = document.getElementById('preview-image-container');
  const textContainer = document.getElementById('preview-text-container');
  const pdfContainer = document.getElementById('preview-pdf-container');
  const videoContainer = document.getElementById('preview-video-container');
  const audioContainer = document.getElementById('preview-audio-container');
  const unsupportedContainer = document.getElementById('preview-unsupported-container');

  const img = document.getElementById('preview-image');
  const textPre = document.getElementById('preview-text');
  const pdfFrame = document.getElementById('preview-pdf');
  const videoEl = document.getElementById('preview-video');
  const audioEl = document.getElementById('preview-audio');

  hidePreviewLoading();

  titleEl.textContent = filename;
  dialog.setAttribute('data-local-path', localPath);
  dialog.setAttribute('data-filename', filename);

  if (img.src && img.src.startsWith('blob:')) { URL.revokeObjectURL(img.src); img.src = ''; }
  if (pdfFrame.src && pdfFrame.src.startsWith('blob:')) { URL.revokeObjectURL(pdfFrame.src); pdfFrame.src = 'about:blank'; }

  [imgContainer, textContainer, pdfContainer, videoContainer, audioContainer, unsupportedContainer].forEach(el => el.classList.add('hidden'));

  if (videoEl.src && videoEl.src.startsWith('blob:')) URL.revokeObjectURL(videoEl.src);
  videoEl.pause(); videoEl.removeAttribute('src'); videoEl.load();
  if (audioEl.src && audioEl.src.startsWith('blob:')) URL.revokeObjectURL(audioEl.src);
  audioEl.pause(); audioEl.removeAttribute('src'); audioEl.load();

  typeEl.textContent = `Type: ${detected.mime}`;
  sizeEl.textContent = `Size: ${fileSize != null ? formatBytes(fileSize) : '-'}`;

  try {
    if (detected.category === 'image') {
      const bytes = base64ToUint8Array(base64Data);
      const blob = new Blob([bytes], { type: detected.mime });
      img.src = URL.createObjectURL(blob);
      imgContainer.classList.remove('hidden');
    } else if (detected.category === 'text') {
      const text = atob(base64Data);
      textPre.textContent = text;
      textContainer.classList.remove('hidden');
    } else if (detected.category === 'pdf') {
      const bytes = base64ToUint8Array(base64Data);
      const blob = new Blob([bytes], { type: 'application/pdf' });
      pdfFrame.src = URL.createObjectURL(blob);
      pdfContainer.classList.remove('hidden');
    } else if (detected.category === 'video') {
      const bytes = base64ToUint8Array(base64Data);
      const blob = new Blob([bytes], { type: detected.mime });
      videoEl.src = URL.createObjectURL(blob);
      videoContainer.classList.remove('hidden');
    } else if (detected.category === 'audio') {
      const bytes = base64ToUint8Array(base64Data);
      const blob = new Blob([bytes], { type: detected.mime });
      audioEl.src = URL.createObjectURL(blob);
      audioContainer.classList.remove('hidden');
    } else {
      unsupportedContainer.classList.remove('hidden');
    }

    if (!dialog.open) {
      dialog.showModal();
    }
  } catch (err) {
    showPreviewError(err.message || 'Failed to load preview');
  }
}

function showPreviewError(message) {
  const dialog = document.getElementById('dialog-preview');
  hidePreviewLoading();
  document.getElementById('preview-image-container').classList.add('hidden');
  document.getElementById('preview-text-container').classList.add('hidden');
  document.getElementById('preview-pdf-container').classList.add('hidden');
  document.getElementById('preview-video-container').classList.add('hidden');
  document.getElementById('preview-audio-container').classList.add('hidden');
  document.getElementById('preview-type').textContent = 'Type: Error';
  document.getElementById('preview-size').textContent = '';

  const unsupported = document.getElementById('preview-unsupported-container');
  unsupported.classList.remove('hidden');
  const msg = unsupported.querySelector('.preview-unsupported-message');
  if (msg) msg.textContent = message;

  if (!dialog.open) {
    dialog.showModal();
  }
}

async function savePreviewAs() {
  const dialog = document.getElementById('dialog-preview');
  const filename = dialog.getAttribute('data-filename') || 'download';
  const remotePath = dialog.getAttribute('data-remote-path');
  const tab = getActiveTab();
  if (!remotePath || !tab) return;
  try {
    const dest = await App.ShowSaveDialog(filename);
    if (dest) {
      await App.DownloadFile(tab.id, remotePath, dest);
      showToast(`Saved to:\n${dest}`, 'success');
    }
  } catch (err) {
    showToast('Failed to save file: ' + err.message, 'error');
  }
}

async function openPreviewWithExternalApp() {
  const dialog = document.getElementById('dialog-preview');
  const localPath = dialog.getAttribute('data-local-path');
  if (!localPath) return;

  try {
    await App.OpenFileWithDefaultApp(localPath);
  } catch {
    showToast('Could not open file with default app.', 'error');
  }
  dialog.close();
}

function cleanupPreviewResources() {
  const dialog = document.getElementById('dialog-preview');

  const transferId = dialog.getAttribute('data-transfer-id');
  if (transferId) {
    if (previewTransfers[transferId]) {
      previewCancelled[transferId] = true;
      delete previewTransfers[transferId];
    }
  }
  dialog.removeAttribute('data-transfer-id');

  const localPath = dialog.getAttribute('data-local-path');
  if (localPath && localPath.includes('ripple_preview_')) {
    App.DeleteLocalFile(localPath).catch(err => console.warn('[Ripple] Cleanup delete:', err));
  }

  dialog.removeAttribute('data-local-path');
  dialog.removeAttribute('data-remote-path');
  dialog.removeAttribute('data-filename');

  const img = document.getElementById('preview-image');
  if (img.src && img.src.startsWith('blob:')) { URL.revokeObjectURL(img.src); img.src = ''; }

  const pdfFrame = document.getElementById('preview-pdf');
  if (pdfFrame.src && pdfFrame.src.startsWith('blob:')) { URL.revokeObjectURL(pdfFrame.src); pdfFrame.src = 'about:blank'; }

  const videoEl = document.getElementById('preview-video');
  if (videoEl.src && videoEl.src.startsWith('blob:')) { URL.revokeObjectURL(videoEl.src); videoEl.removeAttribute('src'); videoEl.load(); }

  const audioEl = document.getElementById('preview-audio');
  if (audioEl.src && audioEl.src.startsWith('blob:')) { URL.revokeObjectURL(audioEl.src); audioEl.removeAttribute('src'); audioEl.load(); }

  const msg = dialog.querySelector('.preview-unsupported-message');
  if (msg) msg.textContent = 'This file type cannot be previewed.';

  const loading = document.getElementById('preview-loading-container');
  if (loading) loading.style.display = 'none';
  updatePreviewProgress(0, 0, 0);
}
