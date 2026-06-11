import * as App from '../bindings/ripple-ssh-wails/app/app';
import { tabs, getActiveTab } from './state.js';

let _panelObserver = null;
let _resizeTimer = null;

function debouncedResize(tab) {
  if (!tab || !tab.fitAddon || !tab.fitAddon.fit || !tab.terminal) return;
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => {
    try {
      tab.fitAddon.fit();
      App.ResizeTerminal(tab.id, tab.terminal.cols, tab.terminal.rows).catch(() => {});
    } catch (e) {
      console.warn('[Ripple] fit error:', e);
    }
  }, 100);
}

export function fitActiveTerminal() {
  const tab = getActiveTab();
  if (!tab || !tab.fitAddon || !tab.fitAddon.fit) return;
  try {
    tab.fitAddon.fit();
    if (tab.terminal) {
      App.ResizeTerminal(tab.id, tab.terminal.cols, tab.terminal.rows).catch(() => {});
    }
  } catch (e) {
    console.warn('[Ripple] fit error:', e);
  }
}

export function setupTerminalResizeObserver() {
  if (_panelObserver) _panelObserver.disconnect();
  const panel = document.getElementById('terminal-panel');
  if (!panel) return;
  _panelObserver = new ResizeObserver(() => {
    const tab = getActiveTab();
    debouncedResize(tab);
  });
  _panelObserver.observe(panel);
}

export function disposeTerminal(tab) {
  if (tab.fitAddon) tab.fitAddon = null;
  if (tab.terminal) { tab.terminal.dispose(); tab.terminal = null; }
  const tv = document.querySelector(`.terminal-view[data-tab-id="${tab.id}"]`);
  if (tv) tv.remove();
  tab.type = 'form';
  tab.status = 'disconnected';
}

export function initTerminalForTab(tabId) {
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
      fontSize: tab.fontSize || 14,
      lineHeight: tab.lineHeight || 1.2,
      fontFamily: `"${tab.fontFamily || 'Fira Code'}", var(--font-mono)`,
      letterSpacing: 0,
      allowTransparency: false,
      cursorStyle: 'block',
      scrollback: 10000,
    });
    term.open(view);
    tab.terminal = term;
    tab.fitAddon = typeof FitAddon.FitAddon !== 'undefined' ? new FitAddon.FitAddon() : new FitAddon();
    if (tab.fitAddon.fit) {
      term.loadAddon(tab.fitAddon);
      requestAnimationFrame(() => {
        tab.fitAddon.fit();
        if (tab.terminal) {
          App.ResizeTerminal(tabId, tab.terminal.cols, tab.terminal.rows).catch(() => {});
        }
      });
    }

    term.onData((data) => {
      const t = tabs.get(tabId);
      if (t && t.status === 'connected') {
        App.WriteTerminal(tabId, data).catch(err => console.warn('[Ripple] WriteTerminal:', err));
      }
    });

    if (tab.resizeObserver) tab.resizeObserver.disconnect();
    let tabResizeTimer = null;
    tab.resizeObserver = new ResizeObserver(() => {
      clearTimeout(tabResizeTimer);
      tabResizeTimer = setTimeout(() => {
        if (!tab.fitAddon || !tab.fitAddon.fit) return;
        tab.fitAddon.fit();
        if (tab.terminal) {
          App.ResizeTerminal(tabId, tab.terminal.cols, tab.terminal.rows).catch(() => {});
        }
      }, 100);
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
    console.warn('[Ripple] Terminal init error:', e);
  }
}
