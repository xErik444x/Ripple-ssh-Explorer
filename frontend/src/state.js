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
  lineHeight: 1.5,
  fontFamily: 'Fira Code'
};

export let ctxTarget = null;
export function setCtxTarget(t) { ctxTarget = t; }

export function getActiveTab() {
  return activeTabId ? tabs.get(activeTabId) : null;
}
