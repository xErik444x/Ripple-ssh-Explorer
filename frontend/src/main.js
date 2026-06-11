import './style.css';
import { Events } from '@wailsio/runtime';
import * as App from '../bindings/ripple-ssh-wails/app/app';

import {
  tabs, tabOrder, activeTabId, _closingTabIds,
  getActiveTab, setActiveTabId,
  activeTransfers, previewTransfers
} from './state.js';
import { showToast, formatBytes, joinPath, getParentPath } from './ui.js';
import { loadProfiles, saveProfileData, clearForm } from './profiles.js';
import { loadTerminalSettings, setupSettingsDialog } from './settings.js';
import { initTerminalForTab, disposeTerminal, fitActiveTerminal, setupTerminalResizeObserver } from './terminal.js';
import { explainWithAI, setupAIEventListeners, setupAIUIListeners, loadChats } from './ai.js';
import { loadDirectory, triggerDownload, openRenameDialog, triggerDelete, triggerUpload, showTransferStatus } from './sftp.js';
import { triggerPreview, updatePreviewProgress, savePreviewAs, openPreviewWithExternalApp, cleanupPreviewResources } from './preview.js';
import { connectVNC, disconnectVNC, sendCtrlAltDel, toggleFullscreen, setStatusCallback } from './vnc.js';

// ── Window ─────────────────────────────────────────────────────────────────────

window.addEventListener('unhandledrejection', (e) => {
  console.error('[Ripple SSH] Unhandled rejection:', e.reason);
});

document.addEventListener('DOMContentLoaded', () => {
  window.addEventListener('contextmenu', (e) => e.preventDefault());
  initApp().catch(err => {
    console.error('[Ripple SSH] Init failed:', err);
    showToast('Failed to initialize app: ' + err.message, 'error', 10000);
  });
});

// ── Init ───────────────────────────────────────────────────────────────────────

async function initApp() {
  await loadTerminalSettings();
  setupEventListeners();
  await loadProfiles();
  await createNewTab();
  loadChats();
  setStatusCallback((text, type) => {
    const tab = getActiveTab();
    if (tab && tab.type === 'vnc') {
      if (type === 'connected') {
        tab.status = 'connected';
        updateHeaderStatus(tab);
        renderTabBar();
      } else if (type === 'error' || type === 'disconnected') {
        tab.status = 'disconnected';
        updateHeaderStatus(tab);
        renderTabBar();
      }
    }
  });
}

// ── Tab Management ─────────────────────────────────────────────────────────────

async function createNewTab(existingTabId) {
  const tabId = existingTabId || await App.NewTab();
  if (!tabId) return;
  const tab = {
    id: tabId, type: 'form', status: 'disconnected', label: 'New Connection',
    host: '', port: '22', username: '', authType: 'password', password: '',
    privateKeyText: '', passphrase: '', privateKeyPath: '',
    connectionType: 'terminal', vncPort: 5900, vncPassword: '',
    terminal: null, fitAddon: null, currentPath: '.'
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
    try { await App.DisconnectSSH(tabId); } catch (e) { console.warn('[Ripple] Disconnect error on close:', e); }
  }
  if (tab.terminal) disposeTerminal(tab);
  App.CloseTab(tabId).catch(() => {});
  tabs.delete(tabId);
  const idx = tabOrder.indexOf(tabId);
  if (idx >= 0) tabOrder.splice(idx, 1);
  _closingTabIds.delete(tabId);
  if (tabOrder.length === 0) { createNewTab(); renderTabBar(); return; }
  if (activeTabId === tabId) {
    const connectedTabs = tabOrder.filter(id => { const t = tabs.get(id); return t && t.status === 'connected'; });
    switchToTab(connectedTabs.length > 0 ? connectedTabs[0] : tabOrder[Math.min(idx, tabOrder.length - 1)]);
  }
  renderTabBar();
}

function switchToTab(tabId) {
  const prevTab = getActiveTab();
  const newTab = tabs.get(tabId);
  if (!newTab) return;
  if (prevTab && prevTab.id !== tabId && prevTab.type === 'form') saveFormToTab(prevTab);
  const configPanel = document.getElementById('config-panel');
  const terminalPanel = document.getElementById('terminal-panel');
  document.querySelectorAll('.tab-item').forEach(el => el.classList.remove('active'));
  const tabEl = document.querySelector(`.tab-item[data-tab-id="${tabId}"]`);
  if (tabEl) tabEl.classList.add('active');
  document.querySelectorAll('.terminal-view').forEach(el => el.classList.remove('active'));
  const vncPanel = document.getElementById('vnc-panel');
  const profilesPane = document.getElementById('profiles-pane');
  const sftpPane = document.getElementById('sftp-pane');
  if (newTab.type === 'terminal') {
    configPanel.classList.add('hidden');
    terminalPanel.classList.remove('hidden');
    if (vncPanel) vncPanel.classList.add('hidden');
    profilesPane.classList.add('hidden');
    sftpPane.classList.remove('hidden');
    const tv = document.querySelector(`.terminal-view[data-tab-id="${tabId}"]`);
    if (tv) {
      tv.classList.add('active');
      if (newTab.fitAddon) {
        requestAnimationFrame(() => {
          newTab.fitAddon.fit();
          if (newTab.terminal) App.ResizeTerminal(tabId, newTab.terminal.cols, newTab.terminal.rows).catch(() => {});
        });
      }
    }
    updateHeaderStatus(newTab);
    loadDirectory(tabId, newTab.currentPath);
  } else if (newTab.type === 'vnc') {
    configPanel.classList.add('hidden');
    terminalPanel.classList.add('hidden');
    if (vncPanel) vncPanel.classList.remove('hidden');
    profilesPane.classList.add('hidden');
    sftpPane.classList.add('hidden');
    updateHeaderStatus(newTab);
    document.getElementById('btn-disconnect').classList.remove('hidden');
    document.getElementById('btn-settings').classList.add('hidden');
  } else {
    terminalPanel.classList.add('hidden');
    if (vncPanel) vncPanel.classList.add('hidden');
    configPanel.classList.remove('hidden');
    profilesPane.classList.remove('hidden');
    sftpPane.classList.add('hidden');
    loadFormFromTab(newTab);
    updateHeaderStatus(null);
    document.getElementById('btn-disconnect').classList.add('hidden');
    document.getElementById('btn-settings').classList.add('hidden');
  }
  setActiveTabId(tabId);
}

function updateHeaderStatus(tab) {
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  if (tab && tab.status === 'connected') {
    statusDot.className = 'status-indicator connected';
    statusText.textContent = `Connected: ${tab.username}@${tab.host}`;
  } else {
    statusText.textContent = tab && tab.status === 'connecting' ? `Connecting to ${tab.host}...` : 'Disconnected';
    statusDot.className = 'status-indicator disconnected';
  }
}

function saveFormToTab(tab) {
  tab.host = document.getElementById('ssh-host').value.trim();
  tab.port = document.getElementById('ssh-port').value.trim() || '22';
  tab.connectionType = document.getElementById('connection-type').value;
  tab.vncPort = parseInt(document.getElementById('vnc-port').value, 10) || 5900;
  tab.vncPassword = document.getElementById('vnc-password').value;
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
  document.getElementById('connection-type').value = tab.connectionType || 'terminal';
  document.getElementById('vnc-port').value = tab.vncPort || 5900;
  document.getElementById('vnc-password').value = tab.vncPassword || '';
  toggleVncFields(tab.connectionType === 'vnc');
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

function toggleVncFields(show) {
  document.getElementById('vnc-port-group').classList.toggle('hidden', !show);
  document.getElementById('vnc-password-group').classList.toggle('hidden', !show);
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
    close.addEventListener('click', (e) => { e.stopPropagation(); closeTab(id); });
    item.appendChild(close);
    item.addEventListener('click', () => switchToTab(id));
    item.addEventListener('mousedown', (e) => { if (e.button === 1) { e.preventDefault(); closeTab(id); } });
    list.appendChild(item);
  });
  const addBtn = document.createElement('button');
  addBtn.className = 'tab-add';
  addBtn.title = 'New Tab';
  addBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
  addBtn.addEventListener('click', () => { if (getActiveTab() && getActiveTab().type === 'form') saveFormToTab(getActiveTab()); createNewTab(); });
  list.appendChild(addBtn);
}

// ── SSH Connection ─────────────────────────────────────────────────────────────

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
  App.ConnectSSH(tab.id, tab.host, tab.port, tab.username, tab.password, tab.privateKeyText, tab.passphrase, tab.connectionType || 'terminal', tab.vncPort || 5900).catch(err => {
    showToast(`SSH Error: ${err}`, 'error');
    tab.status = 'disconnected';
    connectBtn.disabled = false;
    connectBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><polyline points="10 17 15 12 10 7"></polyline><line x1="15" y1="12" x2="3" y2="12"></line></svg> Connect Now';
    renderTabBar();
    if (activeTabId === tab.id) updateHeaderStatus(tab);
  });
  const profileName = document.getElementById('profile-name').value.trim();
  if (profileName) {
    saveProfileData(profileName, {
      host: tab.host, port: tab.port, username: tab.username, password: tab.password,
      privateKeyPath: document.getElementById('ssh-key-path').value.trim(), privateKeyText: tab.privateKeyText, passphrase: tab.passphrase
    }, tab.authType);
  }
}

async function saveProfile() {
  const host = document.getElementById('ssh-host').value.trim();
  const port = document.getElementById('ssh-port').value.trim() || '22';
  const username = document.getElementById('ssh-username').value.trim();
  if (!host || !username) { showToast('Please fill out Host and Username to save a profile.', 'warning'); return; }
  const authType = document.querySelector('.auth-btn.active').getAttribute('data-target');
  const connectionType = document.getElementById('connection-type').value;
  let name = document.getElementById('profile-name').value.trim();
  if (!name) { name = `${username}@${host}:${port}`; document.getElementById('profile-name').value = name; }
  const payload = { host, port, username, connectionType };
  if (connectionType === 'vnc') {
    payload.vncPort = parseInt(document.getElementById('vnc-port').value, 10) || 5900;
    payload.vncPassword = document.getElementById('vnc-password').value;
  }
  if (authType === 'password') { payload.password = document.getElementById('ssh-password').value; }
  else { payload.privateKeyPath = document.getElementById('ssh-key-path').value.trim(); payload.privateKeyText = document.getElementById('ssh-key-text').value; payload.passphrase = document.getElementById('ssh-passphrase').value; }
  await saveProfileData(name, payload, authType);
  showToast(`Profile "${name}" saved!`, 'success');
}

// ── Backend Events ─────────────────────────────────────────────────────────────

function setupEventListeners_backend() {
  Events.On('ssh.connected', (event) => {
    const { tabId, host, username } = event.data;
    const tab = tabs.get(tabId);
    if (!tab) return;
    tab.status = 'connected';
    tab.host = host;
    tab.username = username;
    tab.label = `${username}@${host}`;
    tab.type = tab.connectionType === 'vnc' ? 'vnc' : 'terminal';
    if (tab.type === 'terminal') {
      initTerminalForTab(tabId);
      tab.currentPath = '.';
    }
    if (activeTabId === tabId) {
      updateHeaderStatus(tab);
      document.getElementById('btn-disconnect').classList.remove('hidden');
      const configPanel = document.getElementById('config-panel');
      const terminalPanel = document.getElementById('terminal-panel');
      const vncPanel = document.getElementById('vnc-panel');
      configPanel.classList.add('hidden');
      if (tab.type === 'vnc') {
        terminalPanel.classList.add('hidden');
        if (vncPanel) vncPanel.classList.remove('hidden');
        document.getElementById('profiles-pane').classList.add('hidden');
        document.getElementById('sftp-pane').classList.add('hidden');
        document.getElementById('btn-settings').classList.add('hidden');
        document.getElementById('btn-ai-toggle').classList.add('hidden');
      } else {
        terminalPanel.classList.remove('hidden');
        if (vncPanel) vncPanel.classList.add('hidden');
        document.getElementById('profiles-pane').classList.add('hidden');
        document.getElementById('sftp-pane').classList.remove('hidden');
        document.getElementById('btn-settings').classList.remove('hidden');
        document.getElementById('btn-ai-toggle').classList.remove('hidden');
        const tv = document.querySelector(`.terminal-view[data-tab-id="${tabId}"]`);
        if (tv) {
          document.querySelectorAll('.terminal-view').forEach(el => el.classList.remove('active'));
          tv.classList.add('active');
          if (tab.fitAddon) {
            requestAnimationFrame(() => {
              tab.fitAddon.fit();
              tab.terminal.focus();
              if (tab.terminal) App.ResizeTerminal(tabId, tab.terminal.cols, tab.terminal.rows).catch(() => {});
            });
          }
        }
        setTimeout(() => loadDirectory(tabId, tab.currentPath), 200);
      }
    }
    const connectBtn = document.getElementById('btn-connect');
    connectBtn.disabled = false;
    connectBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><polyline points="10 17 15 12 10 7"></polyline><line x1="15" y1="12" x2="3" y2="12"></line></svg> Connect Now';
    renderTabBar();
  });

  Events.On('ssh.error', (event) => {
    const { tabId, message } = event.data;
    showToast(`SSH Error: ${message}`, 'error');
    const tab = tabs.get(tabId);
    if (tab) { tab.status = 'disconnected'; renderTabBar(); if (activeTabId === tabId) updateHeaderStatus(tab); }
    document.getElementById('btn-connect').disabled = false;
    document.getElementById('btn-connect').innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><polyline points="10 17 15 12 10 7"></polyline><line x1="15" y1="12" x2="3" y2="12"></line></svg> Connect Now';
  });

  Events.On('ssh.disconnected', (event) => {
    const tabId = event.data && event.data.tabId;
    const tab = tabs.get(tabId);
    if (!tab) return;
    document.getElementById('btn-ai-toggle').classList.add('hidden');
    tab.status = 'disconnected';
    if (tab.terminal) disposeTerminal(tab);
    if (tab.type === 'vnc') {
      disconnectVNC();
      tab.type = 'form';
    }
    if (!_closingTabIds.has(tabId) && activeTabId === tabId) {
      const connectedTabs = tabOrder.filter(id => { const t = tabs.get(id); return t && t.status === 'connected'; });
      if (connectedTabs.length > 0) switchToTab(connectedTabs[0]); else switchToTab(tabId);
    }
    renderTabBar();
  });

  Events.On('vnc.started', (event) => {
    const { tabId, wsUrl } = event.data;
    const tab = tabs.get(tabId);
    if (!tab) return;
    const vncPass = tab.vncPassword || document.getElementById('vnc-password').value || '';
    connectVNC(tabId, wsUrl, vncPass);
  });

  Events.On('vnc.error', (event) => {
    const { tabId, message } = event.data;
    showToast(`VNC Error: ${message}`, 'error');
    const tab = tabs.get(tabId);
    if (tab) {
      tab.status = 'disconnected';
      renderTabBar();
      if (activeTabId === tabId) updateHeaderStatus(tab);
    }
    document.getElementById('btn-connect').disabled = false;
    document.getElementById('btn-connect').innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><polyline points="10 17 15 12 10 7"></polyline><line x1="15" y1="12" x2="3" y2="12"></line></svg> Connect Now';
  });

  Events.On('terminal.data', (event) => {
    const { tabId, data: termData } = event.data;
    const tab = tabs.get(tabId);
    if (tab && tab.terminal) { tab.terminal.write(termData); tab.terminal.scrollToBottom(); }
  });

  Events.On('sftp.progress', (event) => {
    const data = event.data;
    const { action, transferred, total, percent } = data;
    const id = data.id || '';
    if (id && activeTransfers.has(id)) {
      showTransferStatus(`${action === 'download' ? 'Downloading' : 'Uploading'}...`, percent, `${formatBytes(transferred)} / ${formatBytes(total)}`);
    }
    if (id && previewTransfers[id]) updatePreviewProgress(percent, transferred, total);
  });

  setupAIEventListeners();
}

// ── UI Event Listeners ─────────────────────────────────────────────────────────

function setupEventListeners() {
  const authBtnPwd = document.getElementById('auth-btn-pwd');
  const authBtnKey = document.getElementById('auth-btn-key');
  const _pwdGroup = document.getElementById('auth-password-group');
  const _keyGroup = document.getElementById('auth-key-group');

  authBtnPwd.addEventListener('click', () => { authBtnPwd.classList.add('active'); authBtnKey.classList.remove('active'); _pwdGroup.classList.remove('hidden'); _keyGroup.classList.add('hidden'); });
  authBtnKey.addEventListener('click', () => { authBtnKey.classList.add('active'); authBtnPwd.classList.remove('active'); _keyGroup.classList.remove('hidden'); _pwdGroup.classList.add('hidden'); });

  document.getElementById('btn-browse-key').addEventListener('click', async () => {
    try { const selected = await App.ShowOpenDialog(); if (selected && selected.length > 0) document.getElementById('ssh-key-path').value = selected; }
    catch (err) { console.warn('[Ripple] Browse key dialog:', err); }
  });

  document.getElementById('btn-disconnect').addEventListener('click', () => { const tab = getActiveTab(); if (tab) App.DisconnectSSH(tab.id).catch(err => console.warn('[Ripple] Disconnect:', err)); });

  document.getElementById('connection-type').addEventListener('change', (e) => {
    toggleVncFields(e.target.value === 'vnc');
  });

  document.getElementById('vnc-btn-ctrl-alt-del').addEventListener('click', sendCtrlAltDel);
  document.getElementById('vnc-btn-fullscreen').addEventListener('click', toggleFullscreen);

  document.getElementById('ssh-form').addEventListener('submit', (e) => { e.preventDefault(); connectSsh(); });
  document.getElementById('btn-save-profile').addEventListener('click', saveProfile);
  document.getElementById('btn-new-profile').addEventListener('click', clearForm);

  document.getElementById('sftp-btn-refresh').addEventListener('click', () => { const tab = getActiveTab(); if (tab) loadDirectory(tab.id, tab.currentPath); });
  document.getElementById('sftp-btn-mkdir').addEventListener('click', () => { document.getElementById('mkdir-name').value = ''; document.getElementById('dialog-mkdir').showModal(); });

  document.getElementById('form-mkdir').addEventListener('submit', (e) => {
    e.preventDefault();
    const tab = getActiveTab();
    if (!tab) return;
    const folderName = document.getElementById('mkdir-name').value.trim();
    if (folderName) {
      document.getElementById('dialog-mkdir').close();
      const folderPath = joinPath(tab.currentPath, folderName);
      App.Mkdir(tab.id, folderPath).then(() => loadDirectory(tab.id, tab.currentPath)).catch(err => showToast(`Failed to create folder: ${err}`, 'error'));
    }
  });

  document.getElementById('sftp-btn-upload').addEventListener('click', triggerUpload);
  document.getElementById('sftp-btn-up').addEventListener('click', () => {
    const tab = getActiveTab();
    if (!tab) return;
    if (tab.currentPath !== '.' && tab.currentPath !== '/') loadDirectory(tab.id, getParentPath(tab.currentPath));
  });

  document.getElementById('sftp-filter').addEventListener('input', (e) => {
    const filterText = e.target.value.toLowerCase();
    document.querySelectorAll('.file-item').forEach(item => {
      const name = item.getAttribute('data-name').toLowerCase();
      item.style.display = name.includes(filterText) ? 'flex' : 'none';
    });
  });

  const contextMenu = document.getElementById('file-context-menu');
  const termCtx = document.getElementById('terminal-context-menu');

  window.addEventListener('click', (e) => {
    contextMenu.style.display = 'none';
    termCtx.style.display = 'none';
    if (e.target.closest('.sidebar')) return;
    const tab = getActiveTab();
    if (tab && tab.terminal) tab.terminal.focus();
  });

  document.getElementById('ctx-term-copy').addEventListener('click', () => {
    const tab = getActiveTab();
    const text = tab && tab.terminal ? tab.terminal.getSelection() : '';
    if (text) navigator.clipboard.writeText(text).catch(err => console.warn('[Ripple] Clipboard write:', err));
    termCtx.style.display = 'none';
    if (tab && tab.terminal) tab.terminal.focus();
  });

  document.getElementById('ctx-term-paste').addEventListener('click', () => {
    const tab = getActiveTab();
    navigator.clipboard.readText().then(text => { if (text && tab && tab.status === 'connected') App.WriteTerminal(tab.id, text).catch(err => console.warn('[Ripple] WriteTerminal:', err)); }).catch(err => console.warn('[Ripple] Clipboard read:', err));
    termCtx.style.display = 'none';
    if (tab && tab.terminal) tab.terminal.focus();
  });

  document.getElementById('ctx-term-explain').addEventListener('click', () => {
    const tab = getActiveTab();
    const text = tab && tab.terminal ? tab.terminal.getSelection() : '';
    if (text) explainWithAI(text);
    termCtx.style.display = 'none';
  });

  document.getElementById('ctx-download').addEventListener('click', triggerDownload);
  document.getElementById('ctx-preview').addEventListener('click', triggerPreview);
  document.getElementById('ctx-rename').addEventListener('click', openRenameDialog);
  document.getElementById('ctx-delete').addEventListener('click', triggerDelete);

  const previewDialog = document.getElementById('dialog-preview');
  document.getElementById('btn-preview-close').addEventListener('click', () => previewDialog.close());
  document.getElementById('btn-preview-open-external').addEventListener('click', openPreviewWithExternalApp);
  document.getElementById('btn-preview-download').addEventListener('click', savePreviewAs);

  previewDialog.addEventListener('click', (e) => {
    const rect = previewDialog.getBoundingClientRect();
    const isInDialog = rect.top <= e.clientY && e.clientY <= rect.top + rect.height && rect.left <= e.clientX && e.clientX <= rect.left + rect.width;
    if (!isInDialog) previewDialog.close();
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
      App.RenameFile(tab.id, originalPath, joinPath(parent, newName)).then(() => loadDirectory(tab.id, tab.currentPath)).catch(err => showToast(`Rename failed: ${err}`, 'error'));
    }
  });

  let _windowResizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(_windowResizeTimer);
    _windowResizeTimer = setTimeout(fitActiveTerminal, 100);
  });
  setupTerminalResizeObserver();
  setupSettingsDialog();
  setupAIUIListeners();
  setupEventListeners_backend();
}
