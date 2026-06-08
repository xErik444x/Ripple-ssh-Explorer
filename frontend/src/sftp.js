import * as App from '../bindings/ripple-ssh-wails/app/app';
import { tabs, activeTransfers, ctxTarget, setCtxTarget, getActiveTab } from './state.js';
import { escapeHtml, formatBytes, joinPath, showToast } from './ui.js';

const ICONS = {
  folder: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>',
  file: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>',
  code: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>',
  zip: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="12" y1="3" x2="12" y2="21"></line><path d="M12 12h3"></path><path d="M12 16h3"></path><path d="M12 8h3"></path></svg>',
  image: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>'
};

export function loadDirectory(tabId, path) {
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

export function renderFileList(files) {
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
      setCtxTarget({
        name: file.name,
        path: t ? joinPath(t.currentPath, file.name) : file.name,
        isDir: file.isDir
      });

      const contextMenu = document.getElementById('file-context-menu');
      contextMenu.style.display = 'block';
      contextMenu.style.left = `${e.clientX}px`;
      contextMenu.style.top = `${e.clientY}px`;
    });

    listContainer.appendChild(item);
  });
}

export function renderBreadcrumbs(pathStr) {
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

export function triggerDownload() {
  if (!ctxTarget || ctxTarget.isDir) return;
  const tab = getActiveTab();
  if (!tab) return;
  triggerFileDownload(tab.id, ctxTarget.path, ctxTarget.name);
}

export async function triggerFileDownload(tabId, remoteFilePath, filename) {
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

export function openRenameDialog() {
  if (!ctxTarget) return;
  document.getElementById('rename-original-path').value = ctxTarget.path;
  document.getElementById('rename-new-name').value = ctxTarget.name;
  document.getElementById('dialog-rename').showModal();
}

export async function triggerDelete() {
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

export async function triggerUpload() {
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

export function showTransferStatus(title, percent, meta) {
  const panel = document.getElementById('transfer-panel');
  panel.classList.remove('hidden');
  document.getElementById('transfer-title').textContent = title;
  document.getElementById('transfer-percent').textContent = `${percent}%`;
  document.getElementById('transfer-progress').style.width = `${percent}%`;
  document.getElementById('transfer-meta').textContent = meta;
}

export function hideTransferStatus() {
  document.getElementById('transfer-panel').classList.add('hidden');
  activeTransfers.clear();
}
