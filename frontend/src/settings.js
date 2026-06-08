import * as App from '../bindings/ripple-ssh-wails/app/app';
import { terminalSettings } from './state.js';
import { showToast } from './ui.js';
import { tabs } from './state.js';

export async function loadTerminalSettings() {
  try {
    const raw = await App.LoadSettings();
    if (raw) {
      const data = JSON.parse(raw);
      if (data && Object.keys(data).length > 0) Object.assign(terminalSettings, data);
    }
  } catch (e) { console.warn('[Ripple] Failed to load settings:', e); }
}

export async function saveTerminalSettings() {
  await App.SaveSettings(JSON.stringify(terminalSettings));
}

export function applyTerminalSettings() {
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

export function setupSettingsDialog() {
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

  fontSizeSlider.addEventListener('input', () => { fontSizeVal.textContent = fontSizeSlider.value; });
  lineHeightSlider.addEventListener('input', () => { lineHeightVal.textContent = lineHeightSlider.value; });

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
