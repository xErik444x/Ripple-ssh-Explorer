import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';
import { Client } from 'ssh2';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Logging to file without overriding global console (#16)
const logFile = path.join(__dirname, 'extension.log');
fs.writeFileSync(logFile, `=== Extension started at ${new Date().toISOString()} ===\n`);
const logStream = fs.createWriteStream(logFile, { flags: 'a' });

function log(...args) {
  logStream.write(`[INFO] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')}\n`);
}
function logError(...args) {
  logStream.write(`[ERROR] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')}\n`);
}

process.on('uncaughtException', (err) => {
  fs.appendFileSync(logFile, `[CRITICAL Exception] ${err.stack || err}\n`);
  cleanup();
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  fs.appendFileSync(logFile, `[CRITICAL Rejection] ${reason}\n`);
  cleanup();
  process.exit(1);
});

// #17 SIGTERM/SIGINT cleanup
process.on('SIGTERM', () => { cleanup(); process.exit(0); });
process.on('SIGINT', () => { cleanup(); process.exit(0); });

// Read configurations from stdin passed by Neutralino
let rawInput = '';
try {
  rawInput = fs.readFileSync(0, 'utf-8');
} catch (err) {
  logError('Error reading stdin:', err);
  process.exit(1);
}

let initData;
try {
  initData = JSON.parse(rawInput);
} catch (err) {
  logError('Invalid JSON on stdin:', err);
  process.exit(1);
}

const { nlPort, nlToken, nlConnectToken, nlExtensionId } = initData;

// Connect to Neutralinojs Core WebSocket server
const wsUrl = `ws://localhost:${nlPort}?extensionId=${nlExtensionId}&connectToken=${nlConnectToken}`;
const ws = new WebSocket(wsUrl);

// Global SSH connection state variables
let conn = null;
let sftp = null;
let shellStream = null;
let activeHost = '';
let connectionGeneration = 0; // #5 Race condition guard

ws.on('open', () => {
  log(`Connected to Neutralino Core on port ${nlPort}`);
});

ws.on('close', (code, reason) => {
  log(`Neutralino Core connection closed (${code}): ${reason}`);
  cleanup();
  process.exit(0);
});

ws.on('error', (err) => {
  logError('WebSocket Error:', err);
});

ws.on('message', (messageRaw) => {
  let payload;
  try {
    payload = JSON.parse(messageRaw);
  } catch (err) {
    logError('Failed to parse WebSocket message:', err);
    return;
  }

  const { event, data } = payload;
  if (event) {
    handleEvent(event, data);
  }
});

// Send an event back to the Neutralinojs app
function sendToFrontend(event, data) {
  if (ws.readyState !== WebSocket.OPEN) {
    logError('sendToFrontend: WebSocket not open, event:', event, 'state:', ws.readyState);
    return;
  }
  const response = {
    id: crypto.randomUUID(),
    method: 'app.broadcast',
    accessToken: nlToken,
    data: {
      event,
      data
    }
  };
  const msg = JSON.stringify(response);
  log('sendToFrontend:', event, 'msg size:', msg.length);
  ws.send(msg);
}

// Global cleanup function to shut down active connections
function cleanup() {
  if (shellStream) {
    try { shellStream.end(); } catch (e) { logError('Error ending shellStream:', e); }
    shellStream = null;
  }
  if (sftp) {
    try { sftp.end(); } catch (e) { logError('Error ending sftp:', e); }
    sftp = null;
  }
  if (conn) {
    try { conn.end(); } catch (e) { logError('Error ending conn:', e); }
    conn = null;
  }
  activeHost = '';
}

// Central event router
function handleEvent(event, data) {
  log('Event received:', event);
  switch (event) {
    case 'ssh.connect':
      handleConnect(data);
      break;
    case 'ssh.disconnect':
      handleDisconnect();
      break;
    case 'terminal.write':
      handleTerminalWrite(data);
      break;
    case 'terminal.resize':
      handleTerminalResize(data);
      break;
    case 'sftp.list':
      handleSftpList(data);
      break;
    case 'sftp.download':
      handleSftpDownload(data);
      break;
    case 'sftp.upload':
      handleSftpUpload(data);
      break;
    case 'sftp.delete':
      handleSftpDelete(data);
      break;
    case 'sftp.rename':
      handleSftpRename(data);
      break;
    case 'sftp.mkdir':
      handleSftpMkdir(data);
      break;
    default:
      log(`Unknown event: ${event}`);
  }
}

// Connect to remote SSH host
function handleConnect(data) {
  cleanup();
  const myGeneration = ++connectionGeneration;

  // #3 Path traversal validation: restrict to user home and temp dirs
  function isPathAllowed(p) {
    if (!p || typeof p !== 'string') return false;
    const resolved = path.resolve(p);
    const home = process.env.USERPROFILE || process.env.HOME || '';
    const temp = process.env.TEMP || process.env.TMPDIR || '/tmp';
    const isChildOf = (parent, child) => child.startsWith(parent);
    return isChildOf(home, resolved) || isChildOf(temp, resolved);
  }

  const config = {
    host: data.host,
    port: parseInt(data.port) || 22,
    username: data.username,
    readyTimeout: 20000,
    keepaliveInterval: 10000,
    keepaliveCountMax: 5
  };

  if (data.password) {
    config.password = data.password;
  }

  if (data.privateKeyText) {
    config.privateKey = data.privateKeyText;
    if (data.passphrase) {
      config.passphrase = data.passphrase;
    }
  } else if (data.privateKeyPath) {
    if (!isPathAllowed(data.privateKeyPath)) {
      sendToFrontend('ssh.error', { message: 'Private key path is not in an allowed directory.' });
      return;
    }
    try {
      config.privateKey = fs.readFileSync(data.privateKeyPath, 'utf8');
      if (data.passphrase) {
        config.passphrase = data.passphrase;
      }
    } catch (err) {
      sendToFrontend('ssh.error', { message: `Could not read private key file: ${err.message}` });
      return;
    }
  }

  conn = new Client();

  conn.on('ready', () => {
    if (myGeneration !== connectionGeneration) return;
    activeHost = data.host;
    log('SSH ready, initializing SFTP...');
    
    conn.sftp((err, sftpInstance) => {
      if (myGeneration !== connectionGeneration) return;
      if (err) {
        logError('SFTP init failed:', err.message);
        sendToFrontend('ssh.error', { message: `SFTP Subsystem Init Failed: ${err.message}` });
        cleanup();
        return;
      }
      sftp = sftpInstance;
      log('SFTP initialized successfully');

      conn.shell({ term: 'xterm-256color', cols: 80, rows: 24 }, (shellErr, stream) => {
        if (myGeneration !== connectionGeneration) return;
        if (shellErr) {
          logError('Shell init failed:', shellErr.message);
          sendToFrontend('ssh.error', { message: `Interactive Shell Init Failed: ${shellErr.message}` });
          cleanup();
          return;
        }

        shellStream = stream;

        stream.on('data', (chunk) => {
          sendToFrontend('terminal.data', { data: chunk.toString('utf8') });
        });

        stream.on('close', () => {
          if (myGeneration !== connectionGeneration) return;
          sendToFrontend('ssh.disconnected', { message: 'Connection terminated by remote host' });
          cleanup();
        });

        sendToFrontend('ssh.connected', { host: data.host, username: data.username });
      });
    });
  });

  conn.on('error', (err) => {
    if (myGeneration !== connectionGeneration) return;
    sendToFrontend('ssh.error', { message: `SSH Connection Error: ${err.message}` });
    cleanup();
  });

  conn.on('close', () => {
    if (myGeneration !== connectionGeneration) return;
    sendToFrontend('ssh.disconnected', { message: 'Connection closed' });
    cleanup();
  });

  try {
    conn.connect(config);
  } catch (err) {
    sendToFrontend('ssh.error', { message: `Connection parameter error: ${err.message}` });
    cleanup();
  }
}

// Disconnect from SSH
function handleDisconnect() {
  cleanup();
  sendToFrontend('ssh.disconnected', { message: 'Disconnected by user' });
}

// Write to active terminal stream
function handleTerminalWrite(data) {
  if (shellStream) {
    shellStream.write(data.data);
  }
}

function handleTerminalResize(data) {
  if (shellStream) {
    try {
      shellStream.setWindow(parseInt(data.rows) || 24, parseInt(data.cols) || 80, 0, 0);
    } catch (err) {
      logError('Error setting window size:', err);
    }
  }
}

// Reinitialize SFTP subsystem if it hangs
function reconnectSftp() {
  if (!conn) {
    logError('reconnectSftp: no connection');
    return;
  }
  log('Attempting SFTP reconnection...');
  try {
    conn.sftp((err, sftpInstance) => {
      if (err) {
        logError('SFTP reconnect failed:', err.message);
        return;
      }
      sftp = sftpInstance;
      log('SFTP reconnected successfully');
    });
  } catch (e) {
    logError('SFTP reconnect exception:', e.message);
  }
}

// List directory using exec fallback (more reliable than sftp.readdir which can hang)
function handleSftpList(data) {
  log('sftp.list received, sftp active:', !!sftp, 'path:', data?.path);
  const targetPath = data.path || '.';
  
  if (!conn) {
    sendToFrontend('sftp.list.error', { path: targetPath, message: 'SSH connection is not active' });
    return;
  }

  const cmd = `ls -la ${targetPath}`;
  log('exec:', cmd);

  let output = '';
  let callbackFired = false;
  const timeout = setTimeout(() => {
    if (!callbackFired) {
      callbackFired = true;
      logError('exec timed out for:', targetPath);
      sendToFrontend('sftp.list.error', { path: targetPath, message: 'Command timed out' });
    }
  }, 15000);

  conn.exec(cmd, (err, stream) => {
    if (callbackFired) return;
    if (err) {
      callbackFired = true;
      clearTimeout(timeout);
      logError('exec error:', err.message);
      sendToFrontend('sftp.list.error', { path: targetPath, message: err.message });
      return;
    }

    stream.on('data', (data) => { output += data.toString(); });
    stream.stderr.on('data', (data) => { output += data.toString(); });
    stream.on('close', (code) => {
      if (callbackFired) return;
      callbackFired = true;
      clearTimeout(timeout);
      log('exec closed, code:', code, 'output length:', output.length);
      
      if (code !== 0) {
        sendToFrontend('sftp.list.error', { path: targetPath, message: output.trim() || 'Command failed' });
        return;
      }

      try {
        const files = parseLsOutput(output, targetPath);
        log('Parsed files:', files.length);
        sendToFrontend('sftp.list.success', { path: targetPath, files });
        log('sendToFrontend sftp.list.success called');
      } catch (parseErr) {
        logError('parse error:', parseErr.message);
        sendToFrontend('sftp.list.error', { path: targetPath, message: 'Failed to parse directory listing' });
      }
    });
  });
}

function parseLsOutput(output, basePath) {
  const lines = output.split('\n').filter(l => l.trim() && !l.startsWith('total'));
  return lines.map(line => {
    const parts = line.split(/\s+/);
    if (parts.length < 9) return null;
    const perms = parts[0];
    const name = parts.slice(8).join(' ');
    if (name === '.' || name === '..') return null;
    const isDir = perms.startsWith('d');
    const isLink = perms.startsWith('l');
    const size = parseInt(parts[4]) || 0;
    return { name, size, isDir, isLink, permissions: perms };
  }).filter(Boolean);
}

// Download a remote file
function handleSftpDownload(data) {
  if (!sftp) {
    sendToFrontend('sftp.operation.error', { id: data.id, action: 'download', message: 'SFTP connection is not active' });
    return;
  }

  if (!data.localPath || !data.remotePath) {
    sendToFrontend('sftp.operation.error', { id: data.id, action: 'download', message: 'Missing localPath or remotePath' });
    return;
  }

  try {
    const localDir = path.dirname(data.localPath);
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }
  } catch (err) {
    sendToFrontend('sftp.operation.error', { id: data.id, action: 'download', message: `Failed to create local path directories: ${err.message}` });
    return;
  }

  const options = {
    step: (transferred, chunk, total) => {
      sendToFrontend('sftp.progress', {
        id: data.id,
        action: 'download',
        transferred,
        total,
        percent: total > 0 ? Math.round((transferred / total) * 100) : 0
      });
    }
  };

  sftp.fastGet(data.remotePath, data.localPath, options, (err) => {
    if (err) {
      sendToFrontend('sftp.operation.error', { id: data.id, action: 'download', message: `Download failed: ${err.message}` });
    } else {
      sendToFrontend('sftp.download.success', { id: data.id, remotePath: data.remotePath, localPath: data.localPath });
    }
  });
}

function handleSftpUpload(data) {
  if (!sftp) {
    sendToFrontend('sftp.operation.error', { id: data.id, action: 'upload', message: 'SFTP connection is not active' });
    return;
  }

  if (!data.localPath || !data.remotePath) {
    sendToFrontend('sftp.operation.error', { id: data.id, action: 'upload', message: 'Missing localPath or remotePath' });
    return;
  }

  const options = {
    step: (transferred, chunk, total) => {
      sendToFrontend('sftp.progress', {
        id: data.id,
        action: 'upload',
        transferred,
        total,
        percent: total > 0 ? Math.round((transferred / total) * 100) : 0
      });
    }
  };

  sftp.fastPut(data.localPath, data.remotePath, options, (err) => {
    if (err) {
      sendToFrontend('sftp.operation.error', { id: data.id, action: 'upload', message: `Upload failed: ${err.message}` });
    } else {
      sendToFrontend('sftp.upload.success', { id: data.id, localPath: data.localPath, remotePath: data.remotePath });
    }
  });
}

function handleSftpDelete(data) {
  if (!sftp) {
    sendToFrontend('sftp.operation.error', { action: 'delete', path: data.path, message: 'SFTP connection is not active' });
    return;
  }

  if (!data.path) {
    sendToFrontend('sftp.operation.error', { action: 'delete', path: data.path, message: 'Missing path' });
    return;
  }

  const deleteFunc = data.isDir ? sftp.rmdir.bind(sftp) : sftp.unlink.bind(sftp);

  deleteFunc(data.path, (err) => {
    if (err) {
      sendToFrontend('sftp.operation.error', { action: 'delete', path: data.path, message: `Delete failed: ${err.message}` });
    } else {
      sendToFrontend('sftp.operation.success', { action: 'delete', path: data.path });
    }
  });
}

function handleSftpRename(data) {
  if (!sftp) {
    sendToFrontend('sftp.operation.error', { action: 'rename', path: data.src, message: 'SFTP connection is not active' });
    return;
  }

  if (!data.src || !data.dest) {
    sendToFrontend('sftp.operation.error', { action: 'rename', path: data.src, message: 'Missing source or destination' });
    return;
  }

  sftp.rename(data.src, data.dest, (err) => {
    if (err) {
      sendToFrontend('sftp.operation.error', { action: 'rename', path: data.src, message: `Rename failed: ${err.message}` });
    } else {
      sendToFrontend('sftp.operation.success', { action: 'rename', src: data.src, dest: data.dest });
    }
  });
}

function handleSftpMkdir(data) {
  if (!sftp) {
    sendToFrontend('sftp.operation.error', { action: 'mkdir', path: data.path, message: 'SFTP connection is not active' });
    return;
  }

  if (!data.path) {
    sendToFrontend('sftp.operation.error', { action: 'mkdir', path: data.path, message: 'Missing path' });
    return;
  }

  sftp.mkdir(data.path, (err) => {
    if (err) {
      sendToFrontend('sftp.operation.error', { action: 'mkdir', path: data.path, message: `Mkdir failed: ${err.message}` });
    } else {
      sendToFrontend('sftp.operation.success', { action: 'mkdir', path: data.path });
    }
  });
}
