export function escapeHtml(str) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(str).replace(/[&<>"']/g, c => map[c]);
}

export function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  if (!bytes) return '--';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export function joinPath(base, segment) {
  if (base === '/') return '/' + segment;
  if (base === '.') return segment;
  const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
  return cleanBase + '/' + segment;
}

export function getParentPath(pathStr) {
  if (pathStr === '/' || pathStr === '.' || !pathStr) return '/';
  const parts = pathStr.split('/').filter(Boolean);
  if (parts.length <= 1) return pathStr.startsWith('/') ? '/' : '.';
  parts.pop();
  return (pathStr.startsWith('/') ? '/' : '') + parts.join('/');
}

export function showToast(message, type = 'info', duration = 4000) {
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

export function markdownToHtml(text) {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const blocks = [];
  const codeBlockRe = /```(\w*)\n([\s\S]*?)```/g;
  let lastIdx = 0;
  let match;

  while ((match = codeBlockRe.exec(escaped)) !== null) {
    if (match.index > lastIdx) {
      blocks.push({ type: 'text', content: escaped.slice(lastIdx, match.index) });
    }
    blocks.push({ type: 'code', lang: match[1], content: match[2] });
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < escaped.length) {
    blocks.push({ type: 'text', content: escaped.slice(lastIdx) });
  }

  return blocks.map(b => {
    if (b.type === 'code') {
      return `<pre><code class="lang-${b.lang}">${b.content}</code></pre>`;
    }
    let html = b.content
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/^### (.+)$/gm, '<h4>$1</h4>')
      .replace(/^## (.+)$/gm, '<h3>$1</h3>')
      .replace(/^# (.+)$/gm, '<h2>$1</h2>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
      .replace(/\n/g, '<br>');

    if (html.includes('<li>')) {
      html = html.replace(/(<li>.*?<\/li>)(\s*<br>\s*)(?=<li>)/g, '$1');
      html = '<ul>' + html.replace(/(<li>.*?<\/li>)+/g, m => m) + '</ul>';
      html = html.replace(/<\/ul>\s*<br>\s*<ul>/g, '<br>');
    }
    return html;
  }).join('');
}

export function getMimeFromExt(ext) {
  const map = {
    png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp', ico:'image/x-icon', bmp:'image/bmp',
    svg:'image/svg+xml',
    pdf:'application/pdf',
    mp4:'video/mp4', webm:'video/webm', mkv:'video/x-matroska', mov:'video/quicktime', avi:'video/x-msvideo', flv:'video/x-flv', wmv:'video/x-ms-wmv',
    mp3:'audio/mpeg', wav:'audio/wav', ogg:'audio/ogg', flac:'audio/flac', aac:'audio/m4a', m4a:'audio/mp4', wma:'audio/x-ms-wma',
    js:'text/javascript', json:'application/json', py:'text/x-python', html:'text/html', css:'text/css', ts:'text/typescript', rs:'text/rust', cpp:'text/x-c++src', c:'text/x-csrc', sh:'application/x-sh', php:'application/x-httpd-php', txt:'text/plain', md:'text/markdown', log:'text/plain', xml:'application/xml', yaml:'application/x-yaml', yml:'application/x-yaml', ini:'text/plain', conf:'text/plain', sql:'text/x-sql', bat:'application/x-bat', cmd:'application/x-cmd', ps1:'application/x-powershell',
    lua:'text/x-lua', go:'text/x-go', java:'text/x-java', rb:'text/x-ruby', kt:'text/x-kotlin', swift:'text/x-swift', dart:'text/x-dart', vue:'text/x-vue', scss:'text/x-scss', sass:'text/x-sass', less:'text/x-less', h:'text/x-chdr', hpp:'text/x-c++hdr', cs:'text/x-csharp', pl:'text/x-perl', r:'text/x-r', dockerfile:'text/x-dockerfile'
  };
  return map[ext] || 'application/octet-stream';
}

export function detectFileTypeFromName(filename) {
  const ext = filename.split('.').pop().toLowerCase();
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
  return { category: 'unsupported', mime: 'application/octet-stream' };
}
