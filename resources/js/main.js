// Main Frontend Logic for Ripple SSH/SFTP Client

let profiles = [];
let currentPath = '/';
let isConnected = false;
let terminal = null;
let fitAddon = null;
let extensionId = 'js.ripple.ssh';

// Persistent config directory (OS-standard location, independent of exe path)
let appConfigDir = null;

function escapeHtml(str) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(str).replace(/[&<>"']/g, c => map[c]);
}

// Read a config file from the OS config directory
async function readConfig(key) {
  if (!appConfigDir) return null;
  try {
    const raw = await Neutralino.filesystem.readFile(appConfigDir + '/' + key + '.json');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

// Write a config file to the OS config directory
async function writeConfig(key, data) {
  if (!appConfigDir) return;
  try {
    await Neutralino.filesystem.writeFile(
      appConfigDir + '/' + key + '.json',
      JSON.stringify(data, null, 2)
    );
  } catch (e) { /* ignore */ }
}

// Initialize config directory and migrate from old Neutralino.storage
async function initConfigDir() {
  const configRoot = await Neutralino.os.getPath('config');
  const sep = window.NL_OS === 'Windows' ? '\\' : '/';
  appConfigDir = configRoot + sep + 'ripple-ssh';
  try {
    await Neutralino.filesystem.createDirectory(appConfigDir);
  } catch (e) { /* already exists */ }

  // Migrate from old Neutralino.storage if first run
  try {
    const oldProfiles = await Neutralino.storage.getData('ssh_profiles');
    if (oldProfiles) {
      await writeConfig('ssh_profiles', JSON.parse(oldProfiles));
      await Neutralino.storage.removeData('ssh_profiles');
    }
  } catch (e) { /* no old data */ }
  try {
    const oldSettings = await Neutralino.storage.getData('terminal_settings');
    if (oldSettings) {
      await writeConfig('terminal_settings', JSON.parse(oldSettings));
      await Neutralino.storage.removeData('terminal_settings');
    }
  } catch (e) { /* no old data */ }
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

// Context menu target reference
let ctxTarget = null;

// Track active transfer details
let activeTransfers = new Set();
let previewTransfers = {};
let previewCancelled = {};

// Icons mapping (SVG format)
const ICONS = {
  folder: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>',
  file: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>',
  code: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>',
  zip: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="12" y1="3" x2="12" y2="21"></line><path d="M12 12h3"></path><path d="M12 16h3"></path><path d="M12 8h3"></path></svg>',
  image: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>'
};

// Start Neutralino
Neutralino.init();

// Hook up Neutralino event listeners
Neutralino.events.on('ready', () => {
  window.addEventListener('contextmenu', (e) => e.preventDefault());
  initApp().catch(err => {
    showToast('Failed to initialize app: ' + err.message, 'error', 10000);
  });
});

Neutralino.events.on('windowClose', () => {
  // Let Neutralino handle extension termination automatically
  Neutralino.app.exit();
});

// App Initialization
async function initApp() {
  await initConfigDir();
  await loadTerminalSettings();
  setupEventListeners();
  await loadProfiles();
  setupExtensionListeners();
  cleanupOldPreviewFiles();
}

// Register Listeners for Extension Events
function setupExtensionListeners() {
  Neutralino.events.on('ssh.connected', (event) => {
    const { host, username } = event.detail;
    isConnected = true;
    
    const statusDot = document.getElementById('status-dot');
    statusDot.className = 'status-indicator connected';
    document.getElementById('status-text').textContent = `Connected: ${username}@${host}`;
    
    document.getElementById('btn-disconnect').classList.remove('hidden');
    document.getElementById('btn-settings').classList.remove('hidden');
    document.getElementById('config-panel').classList.add('hidden');
    document.getElementById('terminal-panel').classList.remove('hidden');
    
    document.getElementById('profiles-pane').classList.add('hidden');
    document.getElementById('sftp-pane').classList.remove('hidden');

    const connectBtn = document.getElementById('btn-connect');
    connectBtn.disabled = false;
    connectBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><polyline points="10 17 15 12 10 7"></polyline><line x1="15" y1="12" x2="3" y2="12"></line></svg> Connect Now';

    initTerminal();
    currentPath = '.';
    setTimeout(() => loadDirectory(currentPath), 200);
  });

  Neutralino.events.on('ssh.error', (event) => {
    const { message } = event.detail;
    showToast(`SSH Error: ${message}`, 'error');
    setDisconnectedState();
  });

  // SSH connection termination
  Neutralino.events.on('ssh.disconnected', (event) => {
    const { message } = event.detail;
    setDisconnectedState();
  });

  // Terminal data coming from extension
  Neutralino.events.on('terminal.data', (event) => {
    const { data } = event.detail;
    if (terminal) {
      terminal.write(data);
    }
  });

  Neutralino.events.on('sftp.list.success', (event) => {
    const { path, files } = event.detail;
    currentPath = path;
    renderFileList(files);
    renderBreadcrumbs(path);
  });

  Neutralino.events.on('sftp.list.error', (event) => {
    const { path, message } = event.detail;
    showToast(`Failed to list directory "${escapeHtml(path)}": ${escapeHtml(message)}`, 'error');
    document.getElementById('sftp-file-list').innerHTML = `
      <div class="empty-state" style="color: var(--accent-danger)">
        Error: ${escapeHtml(message)}
      </div>
    `;
  });

  Neutralino.events.on('sftp.operation.error', (event) => {
    const { action, message, id } = event.detail;
    activeTransfers.delete(id);
    if (id && previewTransfers[id]) {
      delete previewTransfers[id];
      showPreviewError(message);
      return;
    }
    showToast(`SFTP Action Failed [${action}]: ${message}`, 'error');
    loadDirectory(currentPath);
  });

  // SFTP download hooks
  Neutralino.events.on('sftp.download.success', async (event) => {
    const { id, localPath } = event.detail;
    activeTransfers.delete(id);
    if (previewTransfers[id]) {
      const previewData = previewTransfers[id];
      delete previewTransfers[id];
      await showPreview(previewData.localPath, previewData.filename);
    } else if (previewCancelled[id]) {
      delete previewCancelled[id];
    } else {
      showToast(`Download completed:\n${localPath}`, 'success');
      hideTransferStatus();
    }
  });

  Neutralino.events.on('sftp.upload.success', (event) => {
    const { id, remotePath } = event.detail;
    activeTransfers.delete(id);
    showToast(`Upload completed:\n${remotePath}`, 'success');
    hideTransferStatus();
    loadDirectory(currentPath);
  });

  Neutralino.events.on('sftp.progress', (event) => {
    const { id, action, transferred, total, percent } = event.detail;
    if (activeTransfers.has(id)) {
      showTransferStatus(
        `${action === 'download' ? 'Downloading' : 'Uploading'}...`,
        percent,
        `${formatBytes(transferred)} / ${formatBytes(total)}`
      );
    }
    if (previewTransfers[id]) {
      updatePreviewProgress(percent, transferred, total);
    }
  });
}

// Reset UI to disconnected layout
function setDisconnectedState() {
  isConnected = false;
  activeTransfers.clear();
  Object.keys(previewTransfers).forEach(k => { previewCancelled[k] = true; delete previewTransfers[k]; });
  
  const statusDot = document.getElementById('status-dot');
  statusDot.className = 'status-indicator disconnected';
  document.getElementById('status-text').textContent = 'Disconnected';
  document.getElementById('btn-disconnect').classList.add('hidden');
  document.getElementById('btn-settings').classList.add('hidden');
  
  document.getElementById('terminal-panel').classList.add('hidden');
  document.getElementById('config-panel').classList.remove('hidden');
  
  document.getElementById('sftp-pane').classList.add('hidden');
  document.getElementById('profiles-pane').classList.remove('hidden');

  const connectBtn = document.getElementById('btn-connect');
  connectBtn.disabled = false;
  connectBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><polyline points="10 17 15 12 10 7"></polyline><line x1="15" y1="12" x2="3" y2="12"></line></svg> Connect Now';

  if (terminal) {
    terminal.dispose();
    terminal = null;
  }
  if (fitAddon) {
    fitAddon = null;
  }
}

// Load SSH Terminal emulator
let terminalSettings = {
  fontSize: 14,
  lineHeight: 1.5,
  fontFamily: 'Fira Code'
};

async function loadTerminalSettings() {
  try {
    const data = await readConfig('terminal_settings');
    if (data) Object.assign(terminalSettings, data);
  } catch (e) { /* use defaults */ }
}

async function saveTerminalSettings() {
  await writeConfig('terminal_settings', terminalSettings);
}

function applyTerminalSettings() {
  if (terminal) {
    terminal.options.fontSize = terminalSettings.fontSize;
    terminal.options.lineHeight = terminalSettings.lineHeight;
    terminal.options.fontFamily = `"${terminalSettings.fontFamily}", var(--font-mono)`;
    if (fitAddon) fitAddon.fit();
  }
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

function initTerminal() {
  const container = document.getElementById('terminal-container');
  container.innerHTML = '';

  terminal = new Terminal({
    cursorBlink: true,
    theme: {
      background: '#0b0f19',
      foreground: '#cbd5e1',
      cursor: '#6366f1',
      black: '#000000',
      red: '#ef4444',
      green: '#10b981',
      yellow: '#fbbf24',
      blue: '#3b82f6',
      magenta: '#8b5cf6',
      cyan: '#06b6d4',
      white: '#f3f4f6'
    },
    fontFamily: `"${terminalSettings.fontFamily}", var(--font-mono)`,
    fontSize: terminalSettings.fontSize,
    lineHeight: terminalSettings.lineHeight,
    letterSpacing: 0
  });

  fitAddon = new FitAddon.FitAddon ? new FitAddon.FitAddon() : new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(container);
  
  setTimeout(() => {
    fitAddon.fit();
    Neutralino.extensions.dispatch(extensionId, 'terminal.resize', {
      cols: terminal.cols,
      rows: terminal.rows
    });
  }, 150);

  // Hook terminal input event to send to backend stream
  terminal.onData((data) => {
    if (isConnected) {
      Neutralino.extensions.dispatch(extensionId, 'terminal.write', { data });
    }
  });
}

// Window resizing adjustments for xterm
window.addEventListener('resize', () => {
  if (isConnected && terminal && fitAddon) {
    fitAddon.fit();
    Neutralino.extensions.dispatch(extensionId, 'terminal.resize', {
      cols: terminal.cols,
      rows: terminal.rows
    });
  }
});

// Setup form and window UI event handlers
function setupEventListeners() {
  // Auth Type Toggle Buttons
  const authBtnPwd = document.getElementById('auth-btn-pwd');
  const authBtnKey = document.getElementById('auth-btn-key');
  const pwdGroup = document.getElementById('auth-password-group');
  const keyGroup = document.getElementById('auth-key-group');

  authBtnPwd.addEventListener('click', () => {
    authBtnPwd.classList.add('active');
    authBtnKey.classList.remove('active');
    pwdGroup.classList.remove('hidden');
    keyGroup.classList.add('hidden');
  });

  authBtnKey.addEventListener('click', () => {
    authBtnKey.classList.add('active');
    authBtnPwd.classList.remove('active');
    keyGroup.classList.remove('hidden');
    pwdGroup.classList.add('hidden');
  });

  // Browse local key file
  document.getElementById('btn-browse-key').addEventListener('click', async () => {
    try {
      const selected = await Neutralino.os.showOpenDialog('Select SSH Private Key File');
      if (selected && selected.length > 0) {
        document.getElementById('ssh-key-path').value = selected[0];
      }
    } catch (err) {
    }
  });

  // Disconnect button action
  document.getElementById('btn-disconnect').addEventListener('click', () => {
    Neutralino.extensions.dispatch(extensionId, 'ssh.disconnect');
  });

  // SSH Form Submission (Connect)
  document.getElementById('ssh-form').addEventListener('submit', (e) => {
    e.preventDefault();
    connectSsh();
  });

  // Profile management clicks
  document.getElementById('btn-save-profile').addEventListener('click', saveProfile);
  document.getElementById('btn-new-profile').addEventListener('click', clearForm);

  // SFTP Operations Action Buttons
  document.getElementById('sftp-btn-refresh').addEventListener('click', () => {
    loadDirectory(currentPath);
  });

  document.getElementById('sftp-btn-mkdir').addEventListener('click', () => {
    document.getElementById('mkdir-name').value = '';
    document.getElementById('dialog-mkdir').showModal();
  });

  document.getElementById('form-mkdir').addEventListener('submit', (e) => {
    e.preventDefault();
    const folderName = document.getElementById('mkdir-name').value.trim();
    if (folderName) {
      document.getElementById('dialog-mkdir').close();
      const folderPath = joinPath(currentPath, folderName);
      Neutralino.extensions.dispatch(extensionId, 'sftp.mkdir', { path: folderPath });
    }
  });

  // Upload trigger
  document.getElementById('sftp-btn-upload').addEventListener('click', triggerUpload);

  // Parent Navigation Action
  document.getElementById('sftp-btn-up').addEventListener('click', () => {
    if (currentPath !== '.' && currentPath !== '/') {
      const upPath = getParentPath(currentPath);
      loadDirectory(upPath);
    }
  });

  // SFTP directory search input filtering
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

  // Context Menu bindings
  const contextMenu = document.getElementById('file-context-menu');
  
  // Close context menu on viewport click
  window.addEventListener('click', () => {
    contextMenu.style.display = 'none';
  });

  document.getElementById('ctx-download').addEventListener('click', triggerDownload);
  document.getElementById('ctx-preview').addEventListener('click', triggerPreview);
  document.getElementById('ctx-rename').addEventListener('click', openRenameDialog);
  document.getElementById('ctx-delete').addEventListener('click', triggerDelete);

  // Preview dialog bindings
  const previewDialog = document.getElementById('dialog-preview');
  document.getElementById('btn-preview-close').addEventListener('click', () => {
    previewDialog.close();
  });
  document.getElementById('btn-preview-open-external').addEventListener('click', openPreviewWithExternalApp);
  document.getElementById('btn-preview-download').addEventListener('click', savePreviewAs);

  // Close on backdrop click and ensure cleanup runs once
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

  // Rename Dialog handler
  document.getElementById('form-rename').addEventListener('submit', (e) => {
    e.preventDefault();
    const newName = document.getElementById('rename-new-name').value.trim();
    const originalPath = document.getElementById('rename-original-path').value;
    if (newName && originalPath) {
      document.getElementById('dialog-rename').close();
      const parent = getParentPath(originalPath);
      const destPath = joinPath(parent, newName);
      Neutralino.extensions.dispatch(extensionId, 'sftp.rename', { src: originalPath, dest: destPath });
    }
  });

  setupSettingsDialog();
}
function loadDirectory(path) {
  document.getElementById('sftp-file-list').innerHTML = '<div class="loading-state">Loading directory...</div>';
  Neutralino.extensions.dispatch(extensionId, 'sftp.list', { path });
}

// Connect to remote host
function connectSsh() {
  const connectBtn = document.getElementById('btn-connect');
  if (connectBtn.disabled) return;
  connectBtn.disabled = true;
  connectBtn.textContent = 'Connecting...';

  const host = document.getElementById('ssh-host').value.trim();
  const port = document.getElementById('ssh-port').value.trim() || '22';
  const username = document.getElementById('ssh-username').value.trim();
  
  const authBtn = document.querySelector('.auth-btn.active');
  const authType = authBtn ? authBtn.getAttribute('data-target') : 'password';
  
  const payload = { host, port, username };

  if (authType === 'password') {
    payload.password = document.getElementById('ssh-password').value;
  } else {
    payload.privateKeyPath = document.getElementById('ssh-key-path').value.trim();
    payload.privateKeyText = document.getElementById('ssh-key-text').value;
    payload.passphrase = document.getElementById('ssh-passphrase').value;
  }

  document.getElementById('status-text').textContent = `Connecting to ${host}...`;
  
  Neutralino.extensions.dispatch(extensionId, 'ssh.connect', payload);

  const profileName = document.getElementById('profile-name').value.trim();
  if (profileName) {
    saveProfileData(profileName, payload, authType);
  }
}

// File explorer listing compiler
function renderFileList(files) {
  const listContainer = document.getElementById('sftp-file-list');
  listContainer.innerHTML = '';

  if (files.length === 0) {
    listContainer.innerHTML = '<div class="empty-state">This directory is empty</div>';
    return;
  }

  // Sort files: directories first, then alphabetically
  files.sort((a, b) => {
    if (a.isDir && !b.isDir) return -1;
    if (!a.isDir && b.isDir) return 1;
    return a.name.localeCompare(b.name);
  });

  files.forEach(file => {
    const item = document.createElement('div');
    item.className = `file-item ${file.isDir ? 'directory' : ''}`;
    item.setAttribute('data-name', file.name);
    item.setAttribute('data-path', joinPath(currentPath, file.name));
    item.setAttribute('data-isdir', file.isDir);

    // Determine appropriate file icon
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

    // Interactivity: Double-click to enter folder or download file
    item.addEventListener('dblclick', () => {
      if (file.isDir) {
        const nextPath = joinPath(currentPath, file.name);
        loadDirectory(nextPath);
      } else {
        // Trigger download direct
        triggerFileDownload(joinPath(currentPath, file.name), file.name);
      }
    });

    // Custom Right click context menu handler
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();

      ctxTarget = {
        name: file.name,
        path: joinPath(currentPath, file.name),
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

// Render Breadcrumbs component
function renderBreadcrumbs(pathStr) {
  const container = document.getElementById('sftp-breadcrumbs');
  
  if (pathStr === '.' || pathStr === '/') {
    container.innerHTML = '/';
    return;
  }

  const parts = pathStr.split('/').filter(Boolean);
  let html = `<span class="crumb" data-path="/">/</span>`;
  let accumPath = '';

  parts.forEach((part, index) => {
    accumPath += '/' + part;
    html += ` <span style="color: var(--text-muted)">/</span> <span class="crumb" data-path="${escapeHtml(accumPath)}">${escapeHtml(part)}</span>`;
  });

  container.innerHTML = html;

  // Add click events to crumbs
  container.querySelectorAll('.crumb').forEach(el => {
    el.addEventListener('click', () => {
      loadDirectory(el.getAttribute('data-path'));
    });
  });
}

// Context Menu Action: Download file
function triggerDownload() {
  if (!ctxTarget || ctxTarget.isDir) return;
  triggerFileDownload(ctxTarget.path, ctxTarget.name);
}

// Double click or context menu download trigger
async function triggerFileDownload(remoteFilePath, filename) {
  try {
    const localDest = await Neutralino.os.showSaveDialog('Download remote file to local disk', {
      defaultPath: filename
    });

    if (localDest) {
      const transferId = Math.random().toString(36).substring(2, 9);
      activeTransfers.add(transferId);
      
      showTransferStatus('Preparing Download...', 0, 'Starting stream...');
      
      Neutralino.extensions.dispatch(extensionId, 'sftp.download', {
        id: transferId,
        remotePath: remoteFilePath,
        localPath: localDest
      });
    }
  } catch (err) {
  }
}

// Context Menu Action: Rename file
function openRenameDialog() {
  if (!ctxTarget) return;
  document.getElementById('rename-original-path').value = ctxTarget.path;
  document.getElementById('rename-new-name').value = ctxTarget.name;
  document.getElementById('dialog-rename').showModal();
}

// Context Menu Action: Delete file
async function triggerDelete() {
  if (!ctxTarget) return;
  
  const confirm = await Neutralino.os.showMessageBox(
    'Delete File/Folder',
    `Are you sure you want to delete this remote item?\n${ctxTarget.name}`,
    'YES_NO',
    'WARNING'
  );

  if (confirm === 'YES') {
    Neutralino.extensions.dispatch(extensionId, 'sftp.delete', {
      path: ctxTarget.path,
      isDir: ctxTarget.isDir
    });
  }
}

// SFTP upload helper
async function triggerUpload() {
  try {
    const selected = await Neutralino.os.showOpenDialog('Select File to Upload');
    if (selected && selected.length > 0) {
      const localFilePath = selected[0];
      const filename = localFilePath.split(/[/\\]/).pop();
      const remoteFilePath = joinPath(currentPath, filename);

      const transferId = Math.random().toString(36).substring(2, 9);
      activeTransfers.add(transferId);
      
      showTransferStatus('Preparing Upload...', 0, 'Starting stream...');

      Neutralino.extensions.dispatch(extensionId, 'sftp.upload', {
        id: transferId,
        localPath: localFilePath,
        remotePath: remoteFilePath
      });
    }
  } catch (err) {
  }
}

// Render transfer bar panel
function showTransferStatus(title, percent, meta) {
  const panel = document.getElementById('transfer-panel');
  panel.classList.remove('hidden');
  document.getElementById('transfer-title').textContent = title;
  document.getElementById('transfer-percent').textContent = `${percent}%`;
  document.getElementById('transfer-progress').style.width = `${percent}%`;
  document.getElementById('transfer-meta').textContent = meta;
}

// Hide transfer bar panel
function hideTransferStatus() {
  document.getElementById('transfer-panel').classList.add('hidden');
  activeTransfers.clear();
}

// Save connection profile directly from Form
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

// Profiles local persistence writing
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
    await writeConfig('ssh_profiles', profiles);
    renderProfiles();
  } catch (err) {
  }
}

// Load connection profiles from OS config directory
async function loadProfiles() {
  try {
    const data = await readConfig('ssh_profiles');
    profiles = data || [];
  } catch (err) {
    profiles = [];
  }
  renderProfiles();
}

// Profile rendering inside pane
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

    // Load credentials on item click
    item.addEventListener('click', (e) => {
      // Avoid loading if clicked delete button
      if (e.target.closest('.btn-delete-profile')) return;
      loadProfileIntoForm(p);
    });

    // Handle delete profile
    item.querySelector('.btn-delete-profile').addEventListener('click', async (e) => {
      e.stopPropagation();
      const confirm = await Neutralino.os.showMessageBox(
        'Delete Profile',
        `Are you sure you want to delete profile "${p.name}"?`,
        'YES_NO',
        'WARNING'
      );
      if (confirm === 'YES') {
        profiles = profiles.filter(prof => prof.id !== p.id);
        try {
          await writeConfig('ssh_profiles', profiles);
          renderProfiles();
        } catch (err) {
        }
      }
    });

    list.appendChild(item);
  });
}

// Profile settings loading
function loadProfileIntoForm(p) {
  document.getElementById('profile-id').value = p.id;
  document.getElementById('profile-name').value = p.name;
  document.getElementById('ssh-host').value = p.credentials.host;
  document.getElementById('ssh-port').value = p.credentials.port;
  document.getElementById('ssh-username').value = p.credentials.username;

  const authBtnPwd = document.getElementById('auth-btn-pwd');
  const authBtnKey = document.getElementById('auth-btn-key');
  const pwdGroup = document.getElementById('auth-password-group');
  const keyGroup = document.getElementById('auth-key-group');

  if (p.authType === 'password') {
    authBtnPwd.click();
    document.getElementById('ssh-password').value = p.credentials.password || '';
  } else {
    authBtnKey.click();
    document.getElementById('ssh-key-path').value = p.credentials.privateKeyPath || '';
    document.getElementById('ssh-key-text').value = p.credentials.privateKeyText || '';
    document.getElementById('ssh-passphrase').value = p.credentials.passphrase || '';
  }
}

// Clear form fields for clean start
function clearForm() {
  document.getElementById('profile-id').value = '';
  document.getElementById('profile-name').value = '';
  document.getElementById('ssh-host').value = '';
  document.getElementById('ssh-port').value = '22';
  document.getElementById('ssh-username').value = '';
  document.getElementById('ssh-password').value = '';
  document.getElementById('ssh-key-path').value = '';
  document.getElementById('ssh-key-text').value = '';
  document.getElementById('ssh-passphrase').value = '';
  
  // Default to password mode
  document.getElementById('auth-btn-pwd').click();
}

// Path Helper Utils
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
  
  // Check if it's a relative path e.g. "some/path/folder"
  const parts = pathStr.split('/').filter(Boolean);
  if (parts.length <= 1) {
    // If it was "folder", going up leads to "." or "/" depending on how we treat it
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

// Context Menu Action: Preview file
async function triggerPreview() {
  if (!ctxTarget || ctxTarget.isDir) return;

  try {
    const tempDir = await Neutralino.os.getPath('temp');
    const uniqueId = Math.random().toString(36).substring(2, 9);
    const safeName = ctxTarget.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    // Build path manually without filesystem.getJoinedPath to avoid permission/compat issues
    const sep = window.NL_OS === 'Windows' ? '\\' : '/';
    const localPath = tempDir.replace(/[/\\]+$/g, '') + sep + `ripple_preview_${uniqueId}_${safeName}`;

    const transferId = Math.random().toString(36).substring(7);
    previewTransfers[transferId] = { localPath, filename: ctxTarget.name };

    const previewDialog = document.getElementById('dialog-preview');
    previewDialog.setAttribute('data-transfer-id', transferId);

    openPreviewLoading(ctxTarget.name);

    Neutralino.extensions.dispatch(extensionId, 'sftp.download', {
      id: transferId,
      remotePath: ctxTarget.path,
      localPath: localPath
    });
  } catch (err) {
    showToast('Failed to initialize preview: ' + err.message, 'error');
  }
}

function openPreviewLoading(filename) {
  const dialog = document.getElementById('dialog-preview');
  document.getElementById('preview-title').textContent = filename;
  document.getElementById('preview-type').textContent = 'Type: -';
  document.getElementById('preview-size').textContent = 'Size: -';

  // Hide all content containers
  document.getElementById('preview-image-container').classList.add('hidden');
  document.getElementById('preview-text-container').classList.add('hidden');
  document.getElementById('preview-pdf-container').classList.add('hidden');
  document.getElementById('preview-video-container').classList.add('hidden');
  document.getElementById('preview-audio-container').classList.add('hidden');
  document.getElementById('preview-unsupported-container').classList.add('hidden');

  // Show loading
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

// Determine file kind and MIME type by extension and/or magic bytes
async function detectFileType(localPath, filename) {
  const ext = filename.split('.').pop().toLowerCase();

  // Extension-based categories
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

  // No known extension: sniff first bytes
  try {
    const buf = await Neutralino.filesystem.readBinaryFile(localPath, { pos: 0, size: 8 });
    const bytes = new Uint8Array(buf);
    const sniff = detectByMagicBytes(bytes);
    if (sniff) return sniff;
  } catch (e) {
    // ignore sniff errors
  }

  // Last resort: try to read a sample as text and see if it looks printable
  try {
    const sample = await Neutralino.filesystem.readFile(localPath, { pos: 0, size: 4096 });
    if (isPrintableText(sample)) {
      return { category: 'text', mime: 'text/plain' };
    }
  } catch (e) {
    // ignore
  }

  return { category: 'unsupported', mime: 'application/octet-stream' };
}

function detectByMagicBytes(bytes) {
  if (bytes.length < 4) return null;
  // PNG
  if (bytes[0]===0x89 && bytes[1]===0x50 && bytes[2]===0x4E && bytes[3]===0x47) return { category: 'image', mime: 'image/png' };
  // JPEG
  if (bytes[0]===0xFF && bytes[1]===0xD8 && bytes[2]===0xFF) return { category: 'image', mime: 'image/jpeg' };
  // GIF
  if (bytes[0]===0x47 && bytes[1]===0x49 && bytes[2]===0x46) return { category: 'image', mime: 'image/gif' };
  // WEBP (starts with RIFF....WEBP)
  if (bytes[0]===0x52 && bytes[1]===0x49 && bytes[2]===0x46 && bytes[3]===0x46 && bytes.length>=12 && bytes[8]===0x57 && bytes[9]===0x45 && bytes[10]===0x42 && bytes[11]===0x50) return { category: 'image', mime: 'image/webp' };
  // PDF
  if (bytes[0]===0x25 && bytes[1]===0x50 && bytes[2]===0x44 && bytes[3]===0x46) return { category: 'pdf', mime: 'application/pdf' };
  // MP4 / ftyp
  if (bytes[4]===0x66 && bytes[5]===0x74 && bytes[6]===0x79 && bytes[7]===0x70) return { category: 'video', mime: 'video/mp4' };
  // ZIP (also docx/xlsx/pptx/etc. but we treat as unsupported here)
  if (bytes[0]===0x50 && bytes[1]===0x4B && bytes[2]===0x03 && bytes[3]===0x04) return null;
  return null;
}

function isPrintableText(str) {
  const sample = str.slice(0, 4096);
  const nullCount = (sample.match(/\0/g) || []).length;
  if (nullCount > 0) return false;
  // Allow common text chars, tabs, newlines, and high Unicode
  const printable = /^[\t\n\r\x20-\x7E\u00A0-\uFFFF]*$/;
  return printable.test(sample);
}

function getMimeFromExt(ext) {
  const map = {
    png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp', ico:'image/x-icon', bmp:'image/bmp',
    svg:'image/svg+xml',
    pdf:'application/pdf',
    mp4:'video/mp4', webm:'video/webm', mkv:'video/x-matroska', mov:'video/quicktime', avi:'video/x-msvideo', flv:'video/x-flv', wmv:'video/x-ms-wmv',
    mp3:'audio/mpeg', wav:'audio/wav', ogg:'audio/ogg', flac:'audio/flac', aac:'audio/aac', m4a:'audio/mp4', wma:'audio/x-ms-wma',
    js:'text/javascript', json:'application/json', py:'text/x-python', html:'text/html', css:'text/css', ts:'text/typescript', rs:'text/rust', cpp:'text/x-c++src', c:'text/x-csrc', sh:'application/x-sh', php:'application/x-httpd-php', txt:'text/plain', md:'text/markdown', log:'text/plain', xml:'application/xml', yaml:'application/x-yaml', yml:'application/x-yaml', ini:'text/plain', conf:'text/plain', sql:'text/x-sql', bat:'application/x-bat', cmd:'application/x-cmd', ps1:'application/x-powershell',
    lua:'text/x-lua', go:'text/x-go', java:'text/x-java', rb:'text/x-ruby', kt:'text/x-kotlin', swift:'text/x-swift', dart:'text/x-dart', vue:'text/x-vue', scss:'text/x-scss', sass:'text/x-sass', less:'text/x-less', h:'text/x-chdr', hpp:'text/x-c++hdr', cs:'text/x-csharp', pl:'text/x-perl', r:'text/x-r', dockerfile:'text/x-dockerfile'
  };
  return map[ext] || 'application/octet-stream';
}

// Display the preview modal based on file type
async function showPreview(localPath, filename) {
  const dialog = document.getElementById('dialog-preview');
  // User closed the dialog while download was in progress — bail out
  if (dialog.getAttribute('data-transfer-id') === null) return;

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

  // Revoke existing blob URLs before creating new ones
  if (img.src && img.src.startsWith('blob:')) { URL.revokeObjectURL(img.src); img.src = ''; }
  if (pdfFrame.src && pdfFrame.src.startsWith('blob:')) { URL.revokeObjectURL(pdfFrame.src); pdfFrame.src = 'about:blank'; }

  // Hide all containers
  [imgContainer, textContainer, pdfContainer, videoContainer, audioContainer, unsupportedContainer].forEach(el => el.classList.add('hidden'));

  // Reset media elements (revoke blobs first)
  if (videoEl.src && videoEl.src.startsWith('blob:')) URL.revokeObjectURL(videoEl.src);
  videoEl.pause(); videoEl.removeAttribute('src'); videoEl.load();
  if (audioEl.src && audioEl.src.startsWith('blob:')) URL.revokeObjectURL(audioEl.src);
  audioEl.pause(); audioEl.removeAttribute('src'); audioEl.load();

  let stats = null;
  try {
    stats = await Neutralino.filesystem.getStats(localPath);
  } catch (e) { /* ignore */ }

  try {
    const detected = await detectFileType(localPath, filename);
    typeEl.textContent = `Type: ${detected.mime}`;
    sizeEl.textContent = `Size: ${stats ? formatBytes(stats.size) : '-'}`;

    if (detected.category === 'image') {
      if (detected.mime === 'image/svg+xml') {
        const content = await Neutralino.filesystem.readFile(localPath);
        const blob = new Blob([content], { type: 'image/svg+xml' });
        img.src = URL.createObjectURL(blob);
      } else {
        const buffer = await Neutralino.filesystem.readBinaryFile(localPath);
        const blob = new Blob([buffer], { type: detected.mime });
        img.src = URL.createObjectURL(blob);
      }
      imgContainer.classList.remove('hidden');
    } else if (detected.category === 'text') {
      const content = await Neutralino.filesystem.readFile(localPath);
      textPre.textContent = content;
      textContainer.classList.remove('hidden');
    } else if (detected.category === 'pdf') {
      const buffer = await Neutralino.filesystem.readBinaryFile(localPath);
      const blob = new Blob([buffer], { type: 'application/pdf' });
      pdfFrame.src = URL.createObjectURL(blob);
      pdfContainer.classList.remove('hidden');
    } else if (detected.category === 'video') {
      const buffer = await Neutralino.filesystem.readBinaryFile(localPath);
      const blob = new Blob([buffer], { type: detected.mime });
      videoEl.src = URL.createObjectURL(blob);
      videoContainer.classList.remove('hidden');
    } else if (detected.category === 'audio') {
      const buffer = await Neutralino.filesystem.readBinaryFile(localPath);
      const blob = new Blob([buffer], { type: detected.mime });
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

// Save the currently previewed temp file to a user-chosen location
async function savePreviewAs() {
  const dialog = document.getElementById('dialog-preview');
  const localPath = dialog.getAttribute('data-local-path');
  const filename = dialog.getAttribute('data-filename') || 'download';
  if (!localPath) return;
  try {
    const dest = await Neutralino.os.showSaveDialog('Save file', { defaultPath: filename });
    if (dest) {
      await Neutralino.filesystem.copy(localPath, dest, { recursive: false, overwrite: true, skip: false });
      showToast(`Saved to:\n${dest}`, 'success');
    }
  } catch (err) {
    showToast('Failed to save file: ' + err.message, 'error');
  }
}

// Open unsupported preview files with the system's default application
async function openPreviewWithExternalApp() {
  const localPath = document.getElementById('dialog-preview').getAttribute('data-local-path');
  if (!localPath) return;
  try {
    await Neutralino.os.open(localPath);
  } catch (err) {
    showToast('Could not open file with default app.', 'error');
  }
  document.getElementById('dialog-preview').close();
}

// Clean up blob URLs and media sources when the preview dialog closes
function cleanupPreviewResources() {
  const dialog = document.getElementById('dialog-preview');

  // Remove pending preview transfer if user closed mid-download
  const transferId = dialog.getAttribute('data-transfer-id');
  if (transferId) {
    if (previewTransfers[transferId]) {
      previewCancelled[transferId] = true;
      delete previewTransfers[transferId];
    }
  }
  dialog.removeAttribute('data-transfer-id');

  // Delete temp file
  const localPath = dialog.getAttribute('data-local-path');
  if (localPath && localPath.includes('ripple_preview_')) {
    Neutralino.filesystem.remove(localPath).catch(() => {});
  }

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

  dialog.removeAttribute('data-local-path');
  dialog.removeAttribute('data-filename');
}

// Clean up old preview temp files on startup
async function cleanupOldPreviewFiles() {
  try {
    const tempDir = await Neutralino.os.getPath('temp');
    const entries = await Neutralino.filesystem.readDirectory(tempDir);
    for (const entry of entries) {
      if (entry.type === 'File' && entry.entry.startsWith('ripple_preview_')) {
        await Neutralino.filesystem.remove(tempDir + (window.NL_OS === 'Windows' ? '\\' : '/') + entry.entry).catch(() => {});
      }
    }
  } catch (e) { /* ignore */ }
}
