import { Events } from '@wailsio/runtime';
import * as App from '../bindings/ripple-ssh-wails/app/app';
import { getActiveTab } from './state.js';
import { escapeHtml, showToast, markdownToHtml } from './ui.js';

export const aiState = {
  conversations: [],
  activeConvId: null,
  isStreaming: false,
  currentMsgEl: null,
  currentRawContent: ''
};

export let _convCounter = 0;
export let _aiModels = [];
export let _lastUserMessage = '';

export function saveChats() {
  const data = aiState.conversations.map(c => ({
    id: c.id, name: c.name, messages: c.messages
  }));
  App.AISaveChats(JSON.stringify(data)).catch(() => {});
}

export function loadChats() {
  App.AILoadChats().then(raw => {
    try {
      const data = JSON.parse(raw);
      if (Array.isArray(data) && data.length > 0) {
        aiState.conversations = data;
        const maxId = data.reduce((m, c) => Math.max(m, parseInt(c.id.split('-')[1] || '0')), 0);
        _convCounter = maxId;
        if (data.length > 0) {
          aiState.activeConvId = data[data.length - 1].id;
        }
      }
    } catch (_) { /* no saved chats */ }
  }).catch(() => {});
}

export function activeConv() {
  return aiState.conversations.find(c => c.id === aiState.activeConvId);
}

export function trimConvHistory(conv) {
  if (conv.messages.length > 20) {
    conv.messages = conv.messages.slice(-20);
  }
}

export function newConversation(name) {
  _convCounter++;
  const id = 'conv-' + _convCounter;
  const conv = { id, name: name || 'Chat ' + _convCounter, messages: [] };
  aiState.conversations.push(conv);
  aiState.activeConvId = id;
  saveChats();
  return conv;
}

export function switchConversation(id) {
  const conv = aiState.conversations.find(c => c.id === id);
  if (!conv) return;
  aiState.activeConvId = id;
  renderConversation(conv);
}

export function renderConversation(conv) {
  const container = document.getElementById('ai-chat-messages');
  container.innerHTML = '';
  const welcome = document.getElementById('ai-welcome-msg');
  if (conv.messages.length === 0) {
    if (welcome) welcome.classList.remove('hidden');
  } else {
    if (welcome) welcome.classList.add('hidden');
    conv.messages.forEach(msg => {
      const el = document.createElement('div');
      el.className = 'ai-msg ' + msg.role;
      const lbl = document.createElement('div');
      lbl.className = 'ai-msg-label';
      lbl.textContent = msg.role === 'user' ? 'You' : 'Assistant';
      el.appendChild(lbl);
      const body = document.createElement('div');
      body.className = 'ai-msg-body';
      body.innerHTML = msg.role === 'assistant' ? markdownToHtml(msg.content) : escapeHtml(msg.content);
      el.appendChild(body);
      container.appendChild(el);
    });
    container.scrollTop = container.scrollHeight;
  }
  saveChats();
  renderConvTabs();
}

export function renderConvTabs() {
  const bar = document.querySelector('.ai-conv-tabs');
  if (!bar) return;
  bar.innerHTML = '';
  aiState.conversations.forEach(c => {
    const wrap = document.createElement('div');
    wrap.className = 'ai-conv-tab-wrap';

    const tab = document.createElement('button');
    tab.className = 'ai-conv-tab' + (c.id === aiState.activeConvId ? ' active' : '');
    tab.textContent = c.name;
    tab.title = c.name;
    tab.addEventListener('click', () => switchConversation(c.id));
    wrap.appendChild(tab);

    const close = document.createElement('button');
    close.className = 'ai-conv-close';
    close.textContent = '\u00d7';
    close.title = 'Close chat';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = aiState.conversations.findIndex(cc => cc.id === c.id);
      if (idx < 0) return;
      aiState.conversations.splice(idx, 1);
      if (aiState.activeConvId === c.id) {
        if (aiState.conversations.length > 0) {
          const newIdx = Math.min(idx, aiState.conversations.length - 1);
          switchConversation(aiState.conversations[newIdx].id);
        } else {
          const conv = newConversation();
          renderConversation(conv);
        }
      }
      saveChats();
      renderConvTabs();
    });
    wrap.appendChild(close);

    bar.appendChild(wrap);
  });
}

export function showAIConfig() {
  document.getElementById('ai-config').classList.remove('hidden');
  document.getElementById('ai-chat').classList.add('hidden');
  document.getElementById('ai-status-badge').textContent = 'off';

  App.AILoadConfig().then(raw => {
    if (raw) {
      try {
        const cfg = JSON.parse(raw);
        document.getElementById('ai-endpoint').value = cfg.endpoint || '';
        document.getElementById('ai-apikey').value = cfg.apiKey || '';
        if (cfg.models && cfg.models.length > 0) {
          _aiModels = cfg.models;
          document.getElementById('ai-model-group').classList.remove('hidden');
          document.getElementById('ai-config-actions').classList.remove('hidden');
          const sel = document.getElementById('ai-model');
          sel.innerHTML = _aiModels.map(m => `<option value="${m.id}"${m.id === cfg.model ? ' selected' : ''}>${m.name}</option>`).join('');
          document.getElementById('ai-model-filter').classList.toggle('hidden', _aiModels.length < 10);
        } else if (cfg.model) {
          document.getElementById('ai-model-group').classList.remove('hidden');
          document.getElementById('ai-config-actions').classList.remove('hidden');
          const sel = document.getElementById('ai-model');
          sel.innerHTML = `<option value="${cfg.model}">${cfg.model}</option>`;
          sel.value = cfg.model;
        }
      } catch (_) { /* existing config may be malformed */ }
    }
  }).catch(() => {});
}

export function showAIChat() {
  document.getElementById('ai-config').classList.add('hidden');
  document.getElementById('ai-chat').classList.remove('hidden');
  document.getElementById('ai-status-badge').textContent = 'on';
  document.getElementById('btn-ai-send').disabled = false;

  if (!activeConv()) newConversation();
  renderConversation(activeConv());

  document.getElementById('ai-chat-model-filter').value = '';
  populateChatModels();
}

export function populateChatModels(q) {
  const btn = document.getElementById('ai-chat-model-btn');
  const list = document.getElementById('ai-chat-model-list');
  const cfgModel = document.getElementById('ai-model').value;
  let models = _aiModels;
  if (q) {
    const lq = q.toLowerCase();
    models = models.filter(m => m.id.toLowerCase().includes(lq) || m.name.toLowerCase().includes(lq));
  }
  models = [...models].sort((a, b) => a.name.localeCompare(b.name));

  if (models.length === 0 && !q) {
    btn.textContent = cfgModel || 'model';
    return;
  }

  const selected = cfgModel || (models.length > 0 ? models[0].id : '');
  btn.textContent = selected;

  list.innerHTML = models.map(m =>
    `<div class="ai-chat-model-item${m.id === selected ? ' active' : ''}" data-id="${m.id}">${m.name}</div>`
  ).join('') || '<div class="ai-chat-model-item" style="color:var(--text-muted)">No models</div>';
}

export function addAIChatMessage(role, content, isStreaming) {
  const container = document.getElementById('ai-chat-messages');
  const welcome = document.getElementById('ai-welcome-msg');
  if (welcome) welcome.classList.add('hidden');
  const msg = document.createElement('div');
  msg.className = `ai-msg ${role}`;
  if (isStreaming) msg.classList.add('streaming');
  const label = document.createElement('div');
  label.className = 'ai-msg-label';
  label.textContent = role === 'user' ? 'You' : 'Assistant';
  msg.appendChild(label);
  const body = document.createElement('div');
  body.className = 'ai-msg-body';
  body.innerHTML = role === 'assistant' ? markdownToHtml(content) : escapeHtml(content);
  msg.appendChild(body);
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
  return msg;
}

export function updateAIChatMessage(msgEl, content) {
  const body = msgEl.querySelector('.ai-msg-body');
  if (body) body.innerHTML = markdownToHtml(content);
  const container = document.getElementById('ai-chat-messages');
  container.scrollTop = container.scrollHeight;
}

export function toggleAIPanel() {
  const pane = document.getElementById('ai-pane');
  const visible = !pane.classList.contains('hidden');
  if (visible) {
    pane.classList.add('hidden');
    const tab = getActiveTab();
    if (tab && tab.status === 'connected') {
      document.getElementById('sftp-pane').classList.remove('hidden');
    } else {
      document.getElementById('profiles-pane').classList.remove('hidden');
    }
    return;
  }
  const profiles = document.getElementById('profiles-pane');
  const sftp = document.getElementById('sftp-pane');
  profiles.classList.add('hidden');
  sftp.classList.add('hidden');
  pane.classList.remove('hidden');

  App.AILoadConfig().then(raw => {
    if (!raw) { showAIConfig(); return; }
    let cfg;
    try { cfg = JSON.parse(raw); } catch (_) { showAIConfig(); return; }
    if (!cfg.endpoint || !cfg.model) { showAIConfig(); return; }

    if (cfg.models && cfg.models.length > 0) {
      _aiModels = cfg.models;
    }

    document.getElementById('ai-endpoint').value = cfg.endpoint || '';
    document.getElementById('ai-apikey').value = cfg.apiKey || '';

    if (cfg.endpoint && cfg.endpoint !== document.getElementById('ai-endpoint').defaultValue) {
      App.AITestConnection(cfg.endpoint, cfg.apiKey || '').then(raw2 => {
        try {
          const models = JSON.parse(raw2);
          if (!models.error) {
            _aiModels = models;
            cfg.models = models;
            App.AISaveConfig(JSON.stringify(cfg)).catch(() => {});
          }
        } catch (_) { /* models refresh is optional */ }
        showAIChat();
      }).catch(() => showAIChat());
    } else {
      showAIChat();
    }
  }).catch(() => showAIConfig());
}

export function sendAIChat() {
  const input = document.getElementById('ai-input');
  const text = input.value.trim();
  if (!text || aiState.isStreaming) return;
  input.value = '';
  const conv = activeConv();
  if (!conv) return;
  _lastUserMessage = text;
  conv.messages.push({ role: 'user', content: text });
  trimConvHistory(conv);
  saveChats();
  addAIChatMessage('user', text);
  aiState.isStreaming = true;
  aiState.currentMsgEl = addAIChatMessage('assistant', '', true);
  aiState.currentRawContent = '';
  document.getElementById('btn-ai-send').disabled = true;

  const systemMsg = { role: 'system', content: 'You are a concise SSH terminal assistant. Answer briefly (2-4 short sentences). Use code blocks for commands. Be direct.' };
  const apiMessages = [systemMsg, ...conv.messages.slice(0, -1)];

  App.AIChat(text, JSON.stringify(apiMessages)).catch(err => {
    showToast(`AI error: ${err}`, 'error');
    aiState.isStreaming = false;
    document.getElementById('btn-ai-send').disabled = false;
  });
}

export function filterAIModels() {
  const q = document.getElementById('ai-model-filter').value.toLowerCase();
  const sel = document.getElementById('ai-model');
  sel.innerHTML = _aiModels
    .filter(m => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
    .map(m => `<option value="${m.id}">${m.name}</option>`)
    .join('');
}

export function testAIConnection() {
  const endpoint = document.getElementById('ai-endpoint').value.trim();
  const apiKey = document.getElementById('ai-apikey').value;
  if (!endpoint) { showToast('Enter an API endpoint', 'warning'); return; }

  const status = document.getElementById('ai-test-status');
  const modelGroup = document.getElementById('ai-model-group');
  const configActions = document.getElementById('ai-config-actions');
  const filter = document.getElementById('ai-model-filter');
  status.textContent = 'Testing...';
  status.className = 'ai-test-status loading';

  App.AITestConnection(endpoint, apiKey).then(raw => {
    try {
      const models = JSON.parse(raw);
      if (models.error) {
        status.textContent = 'Error';
        status.className = 'ai-test-status err';
        showToast('Connection failed: ' + models.error, 'error');
        return;
      }
      _aiModels = models;
      status.textContent = `OK (${models.length} models)`;
      status.className = 'ai-test-status ok';
      modelGroup.classList.remove('hidden');
      configActions.classList.remove('hidden');
      filter.classList.toggle('hidden', models.length < 10);
      filter.value = '';
      filterAIModels();
    } catch (_) {
      status.textContent = 'Invalid response';
      status.className = 'ai-test-status err';
    }
  }).catch(() => {
    status.textContent = 'Failed';
    status.className = 'ai-test-status err';
  });
}

export function saveAIConfig() {
  const endpoint = document.getElementById('ai-endpoint').value.trim();
  const apiKey = document.getElementById('ai-apikey').value;
  const model = document.getElementById('ai-model').value;
  if (!endpoint || !model) { showToast('Complete the configuration first', 'warning'); return; }

  App.AISaveConfig(JSON.stringify({ endpoint, apiKey, model, models: _aiModels })).then(() => {
    showToast('AI configured successfully', 'success');
    showAIChat();
  }).catch(err => showToast('Failed to save config: ' + err, 'error'));
}

export function explainWithAI(selectedText) {
  const pane = document.getElementById('ai-pane');
  const profiles = document.getElementById('profiles-pane');
  const sftp = document.getElementById('sftp-pane');
  pane.classList.remove('hidden');
  profiles.classList.add('hidden');
  sftp.classList.add('hidden');

  const conv = newConversation('Explain');
  showAIChat();
  renderConversation(conv);

  const prompt = `Explain this SSH terminal output briefly (2-3 short sentences). Be concise:\n\n${selectedText}`;
  document.getElementById('ai-input').value = prompt;
  sendAIChat();
}

export function setupAIEventListeners() {
  Events.On('ai.chunk', (event) => {
    const text = event.data.text || '';
    if (aiState.currentMsgEl) {
      aiState.currentRawContent += text;
      updateAIChatMessage(aiState.currentMsgEl, aiState.currentRawContent);
      console.log('[AI chunk] len=' + text.length + ' text=' + JSON.stringify(text));
    }
  });

  Events.On('ai.done', () => {
    aiState.isStreaming = false;
    if (aiState.currentMsgEl) {
      aiState.currentMsgEl.classList.remove('streaming');
      const conv = activeConv();
      if (conv) {
        console.log('[AI done] raw=' + JSON.stringify(aiState.currentRawContent));
        conv.messages.push({ role: 'assistant', content: aiState.currentRawContent });
        trimConvHistory(conv);
        saveChats();
      }
      aiState.currentMsgEl = null;
      aiState.currentRawContent = '';
    }
    document.getElementById('btn-ai-send').disabled = false;
  });

  Events.On('ai.error', (event) => {
    showToast(`AI Error: ${event.data.message}`, 'error');
    aiState.isStreaming = false;
    document.getElementById('btn-ai-send').disabled = false;

    if (aiState.currentMsgEl) {
      aiState.currentMsgEl.classList.remove('streaming');
      const body = aiState.currentMsgEl.querySelector('.ai-msg-body');
      if (body && !body.textContent) body.innerHTML = '<span style="color:var(--accent-danger)">Error: ' + escapeHtml(event.data.message) + '</span>';
      const existing = aiState.currentMsgEl.querySelector('.ai-msg-retry');
      if (!existing) {
        const retry = document.createElement('button');
        retry.className = 'ai-msg-retry';
        retry.textContent = '\u21bb Retry';
        retry.addEventListener('click', () => {
          const conv = activeConv();
          if (!conv || !_lastUserMessage) return;
          const msgEl = retry.closest('.ai-msg');
          if (msgEl) msgEl.remove();
          conv.messages.pop();
          aiState.isStreaming = true;
          aiState.currentMsgEl = addAIChatMessage('assistant', '', true);
          aiState.currentRawContent = '';
          document.getElementById('btn-ai-send').disabled = true;
          const systemMsg = { role: 'system', content: 'You are a concise SSH terminal assistant. Answer briefly (2-4 short sentences). Use code blocks for commands. Be direct.' };
          const apiMessages = [systemMsg, ...conv.messages.slice(0, -1)];
          App.AIChat(_lastUserMessage, JSON.stringify(apiMessages)).catch(err => {
            showToast(`AI error: ${err}`, 'error');
            aiState.isStreaming = false;
            document.getElementById('btn-ai-send').disabled = false;
          });
        });
        aiState.currentMsgEl.appendChild(retry);
      }
      aiState.currentMsgEl = null;
      aiState.currentRawContent = '';
    }
    document.getElementById('btn-ai-send').disabled = false;
  });

  Events.On('ai.log', (event) => {
    console.log('[AI]', event.data);
  });
}

export function setupAIUIListeners() {
  document.getElementById('btn-ai-toggle').addEventListener('click', toggleAIPanel);
  document.getElementById('btn-ai-test').addEventListener('click', testAIConnection);
  document.getElementById('btn-ai-save-config').addEventListener('click', saveAIConfig);
  document.getElementById('btn-ai-toggle-key').addEventListener('click', () => {
    const input = document.getElementById('ai-apikey');
    input.type = input.type === 'password' ? 'text' : 'password';
  });
  document.getElementById('ai-model-filter').addEventListener('input', filterAIModels);
  document.getElementById('ai-chat-model-btn').addEventListener('click', () => {
    const panel = document.getElementById('ai-chat-model-panel');
    const open = !panel.classList.contains('hidden');
    panel.classList.toggle('hidden');
    if (!open) {
      document.getElementById('ai-chat-model-filter').value = '';
      document.getElementById('ai-chat-model-filter').focus();
      populateChatModels();
    }
  });
  document.getElementById('ai-chat-model-filter').addEventListener('input', (e) => populateChatModels(e.target.value));
  document.getElementById('ai-chat-model-list').addEventListener('click', (e) => {
    const item = e.target.closest('.ai-chat-model-item');
    if (!item || !item.dataset.id) return;
    const model = item.dataset.id;
    document.getElementById('ai-model').value = model;
    document.getElementById('ai-chat-model-btn').textContent = model;
    document.getElementById('ai-chat-model-panel').classList.add('hidden');
    App.AILoadConfig().then(raw => {
      if (raw) {
        try {
          const cfg = JSON.parse(raw);
          cfg.model = model;
          App.AISaveConfig(JSON.stringify(cfg));
        } catch (_) { /* config may be empty */ }
      }
    }).catch(() => {});
  });
  document.addEventListener('click', (e) => {
    const dd = document.getElementById('ai-chat-model-dd');
    if (dd && !dd.contains(e.target)) {
      document.getElementById('ai-chat-model-panel').classList.add('hidden');
    }
  });
  document.getElementById('btn-ai-new-chat').addEventListener('click', () => {
    const conv = newConversation();
    renderConversation(conv);
  });
  document.getElementById('btn-ai-chat-settings').addEventListener('click', showAIConfig);
  document.getElementById('btn-ai-send').addEventListener('click', sendAIChat);
  document.getElementById('ai-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendAIChat();
    }
  });
}
