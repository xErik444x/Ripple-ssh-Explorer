import * as App from '../bindings/ripple-ssh-wails/app/app';
import { ctxTarget, previewTransfers, previewCancelled, getActiveTab } from './state.js';
import { formatBytes, detectFileTypeFromName, showToast } from './ui.js';

export async function triggerPreview() {
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

export function openPreviewLoading(filename) {
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

export function updatePreviewProgress(percent, transferred, total) {
  const bar = document.getElementById('preview-progress-bar');
  const percentEl = document.getElementById('preview-loading-percent');
  const metaEl = document.getElementById('preview-loading-meta');
  if (bar) bar.style.width = `${percent}%`;
  if (percentEl) percentEl.textContent = `${percent}%`;
  if (metaEl) metaEl.textContent = total > 0 ? `${formatBytes(transferred)} / ${formatBytes(total)}` : '';
}

export function hidePreviewLoading() {
  const loading = document.getElementById('preview-loading-container');
  if (loading) loading.style.display = 'none';
}

export function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function showPreviewFromBase64(previewData) {
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

export function showPreviewError(message) {
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

export async function savePreviewAs() {
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

export async function openPreviewWithExternalApp() {
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

export function cleanupPreviewResources() {
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
