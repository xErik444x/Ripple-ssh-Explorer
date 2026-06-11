export const tabs = new Map();
export const tabOrder = [];
export let activeTabId = null;

export function setActiveTabId(id) { activeTabId = id; }

export let profiles = [];
export function setProfiles(p) { profiles = p; }

export const activeTransfers = new Set();
export const previewTransfers = {};
export const previewCancelled = {};
export const _closingTabIds = new Set();

export const terminalSettings = {
  fontSize: 14,
  lineHeight: 1.2,
  fontFamily: 'Fira Code'
};

export const vncSettings = {
  port: 5900,
};

export let ctxTarget = null;
export function setCtxTarget(t) { ctxTarget = t; }

export function getActiveTab() {
  return activeTabId ? tabs.get(activeTabId) : null;
}
