import * as App from '../bindings/ripple-ssh-wails/app/app';
import { profiles, setProfiles } from './state.js';
import { escapeHtml, showToast } from './ui.js';
import { getActiveTab } from './state.js';

export function saveProfileData(name, credentials, authType) {
  const existingIndex = profiles.findIndex(p => p.name.toLowerCase() === name.toLowerCase());
  const profileObject = {
    id: existingIndex >= 0 ? profiles[existingIndex].id : Date.now().toString(),
    name, authType, credentials
  };
  if (existingIndex >= 0) { profiles[existingIndex] = profileObject; }
  else { profiles.push(profileObject); }
  App.SaveProfiles(JSON.stringify(profiles)).then(() => renderProfiles()).catch(err => console.warn('[Ripple] Save profiles error:', err));
}

export async function loadProfiles() {
  try {
    const raw = await App.LoadProfiles();
    setProfiles(raw ? JSON.parse(raw) : []);
  } catch { setProfiles([]); }
  renderProfiles();
}

export function renderProfiles() {
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
      </div>`;
    item.addEventListener('click', (e) => {
      if (e.target.closest('.btn-delete-profile')) return;
      loadProfileIntoForm(p);
    });
    item.querySelector('.btn-delete-profile').addEventListener('click', async (e) => {
      e.stopPropagation();
      const confirm = await App.ShowMessage('Delete Profile', `Are you sure you want to delete profile "${p.name}"?`);
      if (confirm === 'Yes') {
        setProfiles(profiles.filter(prof => prof.id !== p.id));
        App.SaveProfiles(JSON.stringify(profiles)).then(renderProfiles).catch(err => console.warn('[Ripple] Delete profile save error:', err));
      }
    });
    list.appendChild(item);
  });
}

export function loadProfileIntoForm(p) {
  const tab = getActiveTab();
  if (!tab || tab.type !== 'form') {
    showToast('Switch to a New Connection tab to load a profile.', 'info');
    return;
  }
  document.getElementById('profile-id').value = p.id;
  document.getElementById('profile-name').value = p.name;
  tab.host = p.credentials.host; tab.port = p.credentials.port; tab.username = p.credentials.username;
  document.getElementById('ssh-host').value = p.credentials.host;
  document.getElementById('ssh-port').value = p.credentials.port;
  document.getElementById('ssh-username').value = p.credentials.username;
  const authBtnPwd = document.getElementById('auth-btn-pwd');
  const authBtnKey = document.getElementById('auth-btn-key');
  if (p.authType === 'password') {
    authBtnPwd.click(); tab.authType = 'password'; tab.password = p.credentials.password || '';
    document.getElementById('ssh-password').value = p.credentials.password || '';
  } else {
    authBtnKey.click(); tab.authType = 'key'; tab.privateKeyPath = p.credentials.privateKeyPath || '';
    tab.privateKeyText = p.credentials.privateKeyText || ''; tab.passphrase = p.credentials.passphrase || '';
    document.getElementById('ssh-key-path').value = p.credentials.privateKeyPath || '';
    document.getElementById('ssh-key-text').value = p.credentials.privateKeyText || '';
    document.getElementById('ssh-passphrase').value = p.credentials.passphrase || '';
  }
}

export function clearForm() {
  const tab = getActiveTab();
  if (tab && tab.type === 'form') {
    tab.host = ''; tab.port = '22'; tab.username = ''; tab.password = ''; tab.privateKeyPath = '';
    tab.privateKeyText = ''; tab.passphrase = ''; tab.authType = 'password';
  }
  ['profile-id', 'ssh-host', 'ssh-username', 'ssh-key-path', 'ssh-key-text', 'ssh-passphrase', 'profile-name'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('ssh-port').value = '22';
  document.getElementById('ssh-password').value = '';
  document.getElementById('auth-btn-pwd').click();
}
