import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';
import { Client } from 'ssh2';
import crypto from 'crypto';

// Setup file paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Redirect logs to extension.log for background debugging
const logFile = path.join(__dirname, 'extension.log');
fs.writeFileSync(logFile, `=== Extension started at ${new Date().toISOString()} ===\n`);
const logStream = fs.createWriteStream(logFile, { flags: 'a' });

console.log = function(...args) {
  logStream.write(`[INFO] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')}\n`);
};
console.error = function(...args) {
  logStream.write(`[ERROR] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')}\n`);
};

process.on('uncaughtException', (err) => {
  fs.appendFileSync(logFile, `[CRITICAL Exception] ${err.stack || err}\n`);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  fs.appendFileSync(logFile, `[CRITICAL Rejection] ${reason}\n`);
});

// Read configurations from stdin passed by Neutralino
let rawInput = '';
try {
  rawInput = fs.readFileSync(0, 'utf-8');
} catch (err) {
  console.error('[Extension] Error reading stdin:', err);
  process.exit(1);
}

let initData;
try {
  initData = JSON.parse(rawInput);
} catch (err) {
  console.error('[Extension] Invalid JSON on stdin:', err);
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

ws.on('open', () => {
  console.log(`[Extension] Connected to Neutralino Core on port ${nlPort}`);
});

ws.on('close', (code, reason) => {
  console.log(`[Extension] Neutralino Core connection closed (${code}): ${reason}`);
  cleanup();
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('[Extension] WebSocket Error:', err);
});

ws.on('message', (messageRaw) => {
  let payload;
  try {
    payload = JSON.parse(messageRaw);
  } catch (err) {
    console.error('[Extension] Failed to parse WebSocket message:', err);
    return;
  }

  const { event, data } = payload;
  if (event) {
    handleEvent(event, data);
  }
});

// Send an event back to the Neutralinojs app
function sendToFrontend(event, data) {
  if (ws.readyState !== WebSocket.OPEN) return;
  const response = {
    id: crypto.randomUUID(),
    method: 'app.broadcast',
    accessToken: nlToken,
    data: {
      event,
      data
    }
  };
  ws.send(JSON.stringify(response));
}

// Global cleanup function to shut down active connections
function cleanup() {
  if (shellStream) {
    try { shellStream.end(); } catch (e) {}
    shellStream = null;
  }
  if (sftp) {
    sftp = null; // will close automatically with client
  }
  if (conn) {
    try { conn.end(); } catch (e) {}
    conn = null;
  }
  activeHost = '';
}

// Central event router
function handleEvent(event, data) {
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
      console.warn(`[Extension] Unknown event: ${event}`);
  }
}

// Connect to remote SSH host
function handleConnect(data) {
  cleanup();

  const config = {
    host: data.host,
    port: parseInt(data.port) || 22,
    username: data.username,
    readyTimeout: 20000,
    keepaliveInterval: 10000
  };

  if (data.password) {
    config.password = data.password;
  }

  // Handle private keys
  if (data.privateKeyText) {
    config.privateKey = data.privateKeyText;
    if (data.passphrase) {
      config.passphrase = data.passphrase;
    }
  } else if (data.privateKeyPath) {
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
    activeHost = data.host;
    
    // Initialize SFTP
    conn.sftp((err, sftpInstance) => {
      if (err) {
        sendToFrontend('ssh.error', { message: `SFTP Subsystem Init Failed: ${err.message}` });
        cleanup();
        return;
      }
      sftp = sftpInstance;

      // Start shell stream for terminal interface
      conn.shell({ term: 'xterm-256color', cols: 80, rows: 24 }, (shellErr, stream) => {
        if (shellErr) {
          sendToFrontend('ssh.error', { message: `Interactive Shell Init Failed: ${shellErr.message}` });
          cleanup();
          return;
        }

        shellStream = stream;

        // Feed data stream to terminal
        stream.on('data', (chunk) => {
          sendToFrontend('terminal.data', { data: chunk.toString('utf8') });
        });

        stream.on('close', () => {
          sendToFrontend('ssh.disconnected', { message: 'Connection terminated by remote host' });
          cleanup();
        });

        // Trigger connected confirmation
        sendToFrontend('ssh.connected', { host: data.host, username: data.username });
      });
    });
  });

  conn.on('error', (err) => {
    sendToFrontend('ssh.error', { message: `SSH Connection Error: ${err.message}` });
    cleanup();
  });

  conn.on('close', () => {
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

// Resize terminal window
function handleTerminalResize(data) {
  if (shellStream) {
    try {
      shellStream.setWindow(parseInt(data.rows), parseInt(data.cols), 0, 0);
    } catch (err) {
      console.error('[Extension] Error setting window size:', err);
    }
  }
}

// List directory content
function handleSftpList(data) {
  if (!sftp) {
    sendToFrontend('sftp.list.error', { path: data.path, message: 'SFTP connection is not active' });
    return;
  }

  const targetPath = data.path || '.';

  sftp.readdir(targetPath, (err, list) => {
    if (err) {
      sendToFrontend('sftp.list.error', { path: targetPath, message: err.message });
      return;
    }

    const files = list.map(item => {
      const isDir = item.longname.startsWith('d');
      const isLink = item.longname.startsWith('l');
      return {
        name: item.filename,
        size: item.attrs.size,
        mtime: item.attrs.mtime * 1000, // Unix timestamp in s -> ms
        isDir,
        isLink,
        permissions: item.attrs.permissions,
        longname: item.longname
      };
    });

    sendToFrontend('sftp.list.success', { path: targetPath, files });
  });
}

// Download a remote file
function handleSftpDownload(data) {
  if (!sftp) {
    sendToFrontend('sftp.operation.error', { id: data.id, action: 'download', message: 'SFTP connection is not active' });
    return;
  }

  // Ensure local parent directory exists
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

// Upload a local file
function handleSftpUpload(data) {
  if (!sftp) {
    sendToFrontend('sftp.operation.error', { id: data.id, action: 'upload', message: 'SFTP connection is not active' });
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

// Delete remote file or folder
function handleSftpDelete(data) {
  if (!sftp) {
    sendToFrontend('sftp.operation.error', { action: 'delete', path: data.path, message: 'SFTP connection is not active' });
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

// Rename/Move remote file or folder
function handleSftpRename(data) {
  if (!sftp) {
    sendToFrontend('sftp.operation.error', { action: 'rename', path: data.src, message: 'SFTP connection is not active' });
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

// Create a remote directory
function handleSftpMkdir(data) {
  if (!sftp) {
    sendToFrontend('sftp.operation.error', { action: 'mkdir', path: data.path, message: 'SFTP connection is not active' });
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
