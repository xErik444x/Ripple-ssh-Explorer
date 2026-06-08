<div align="center">

# ⚡ Ripple SSH

**SSH & SFTP Client** — Single portable executable, no dependencies.

Built with [Wails v3](https://v3.wails.io) + [Go](https://go.dev) + vanilla HTML/CSS/JS.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Wails](https://img.shields.io/badge/Wails-v3-blue.svg)](https://v3.wails.io)
[![Go](https://img.shields.io/badge/Go-1.25-00ADD8.svg)](https://go.dev)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux-lightgrey.svg)]()
[![Build and Release](https://github.com/xErik444x/Ripple-ssh-Explorer/actions/workflows/build-and-release.yml/badge.svg?branch=main)](https://github.com/xErik444x/Ripple-ssh-Explorer/actions/workflows/build-and-release.yml)
<p>
  <a href="https://github.com/xErik444x/Ripple-ssh-Explorer/releases/latest">
    <img src="https://img.shields.io/badge/Download-Latest_Release-2ea44f?style=for-the-badge&logo=github" alt="Download Latest Release">
  </a>
</p>

</div>

---

## 📸 Screenshots

**Connection Setup**
![Connection Setup](https://i.imgur.com/nH29sXx.png)

**Connected — Terminal + File Explorer**
![Connected](https://i.imgur.com/s3rdVio.png)

**Server mode for linux without gtk library**
<img width="1682" height="878" alt="image" src="https://github.com/user-attachments/assets/0ba3d2fc-6864-4540-931b-917eb5e5aee8" />

---

## What it does

Ripple SSH is a lightweight desktop SSH client that lets you connect to remote servers via SSH. It includes:

- **Interactive Terminal** — Full PTY terminal with xterm.js, custom themes, and configurable font settings
- **SFTP File Explorer** — Browse, upload, download, rename, and delete remote files with a graphical interface
- **File Preview** — Right-click any file to preview images, text, PDFs, video, and audio directly in the app
- **Connection Profiles** — Save and manage multiple SSH connections with credentials
- **Context Menu** — Right-click to copy/paste in the terminal, manage files in the explorer
- **Real-time Transfer Progress** — Live progress bars for file uploads and downloads
- **Multi-Tab Support** — Open multiple SSH connections in separate tabs. Each tab has its own terminal, connection, and SFTP session.
- **AI Assistant** — Connect to any OpenAI-compatible API (OpenAI, OpenRouter, Ollama, OpenCode, etc.) for local or cloud AI assistance
- **Server Mode** — Run as an HTTP server, access from any browser. No GUI dependencies needed.
- **Settings Panel** — Configure font size, line height, and font family in real time

---

## Quick Start

### Option 1: Download the release

[![Download Latest Release](https://img.shields.io/badge/Download-Latest_Release-2ea44f?style=for-the-badge&logo=github)](https://github.com/xErik444x/Ripple-ssh-Explorer/releases/latest)

Choose your platform:

| File | Platform | Description |
|------|----------|-------------|
| `ripple-ssh-windows-amd64.exe` | Windows | Desktop app with native WebView2 window |
| `ripple-ssh-linux-amd64` | Linux | Desktop app with WebKitGTK window (`sudo apt install libwebkit2gtk-4.1-dev`) |
| `ripple-ssh-linux-amd64-server` | Linux | **Server mode** — pure HTTP server, no GUI dependencies. Open `http://localhost:8080` in your browser. |

### Option 2: Build from source

**Prerequisites:**
- [Go](https://go.dev/dl/) v1.25+
- [Wails CLI](https://v3.wails.io/getting-started/installation/): `go install github.com/wailsapp/wails/v3/cmd/wails3@latest`
- [Node.js](https://nodejs.org/) v18+ (for frontend build)

```bash
git clone https://github.com/xErik444x/Ripple-ssh-Explorer.git
cd Ripple-ssh-Explorer
npm install --prefix frontend
wails3 build
```

The executable will be at `bin/ripple-ssh.exe` (Windows) or `bin/ripple-ssh` (Linux).

### Build commands

| Command | Description |
|---------|-------------|
| `wails3 dev` | Run in development mode with hot reload |
| `wails3 build` | Build production executable |
| `wails3 task build:server` | Build Linux server mode executable |
| `wails3 task run:server` | Build and run server mode |

---

## 🤖 AI Assistant

Connect to any **OpenAI-compatible API** — local or cloud. Compatible with:

| Service | Endpoint |
|---------|----------|
| **OpenAI** | `https://api.openai.com/v1` |
| **OpenRouter** | `https://openrouter.ai/api/v1` |
| **Ollama** (local) | `http://localhost:11434/v1` |
| **OpenCode** | Your local OpenCode endpoint |
| **Any OpenAI proxy** | Whatever endpoint you use |

### How to use

1. Click the **AI** button in the top header (appears when connected to a server)
2. Enter your **API Endpoint** and **API Key** (leave blank for local services)
3. Click **Test Connection** to fetch available models
4. Select a model and click **Save & Start Chat**
5. Ask about SSH commands, errors, or configurations

### Features

- **Chat interface** — Ask questions like "What does `chmod 777` do?" or "How do I find which process is using port 8080?"
- **Markdown rendering** — Responses are rendered with code blocks, bold, lists, and headers for readability
- **Explain with AI** — Select text in the terminal, right-click, and choose **Explain with AI** for instant analysis
- **Multiple conversations** — Create named chat tabs with the `＋` button. Each conversation has its own history
- **Retry on error** — If a response fails, a **↻ Retry** button appears to resend the message
- **Model switching** — Change models on the fly from the chat view without losing conversation
- **Model search** — Filter models by name when there are many available
- **Conversation persistence** — All chats are saved to disk (`%APPDATA%/ripple-ssh/ai/chats.json`) and restored on app restart
- **Activity logging** — All AI requests and errors are logged to `ripple-ssh.log`

### HTTP error messages

| Code | Message |
|------|---------|
| 429 | "Model is not available (rate limited). Try a different model." |
| 401/403 | "Authentication failed. Check your API key." |
| 404 | "Model not found. Check that the model name is correct." |
| 500/502/503 | "AI server error. Try again later or use a different model." |

---

## 📑 Multi-Tab System

Each SSH connection opens in its own tab. You can have multiple connections (or the same server with different users) open simultaneously.

- **New tab** — Click the `+` button next to the last tab
- **Switch tabs** — Click any tab to switch between connections
- **Close tab** — Click the `×` button or middle-click. Connected tabs are gracefully disconnected first.
- **Per-tab SFTP** — Each tab has its own file explorer showing that connection's filesystem. SFTP follows the active tab.

---

## Debugging

### Backend logs
The app writes logs to `ripple-ssh.log` in the same directory as the executable. Check this file for SSH/SFTP/AI errors.

### Frontend console
In desktop mode, press F12 to open devtools. In server mode, open your browser's devtools (F12).

---

## Project Structure

```
ripple-ssh-explorer/
├── app/                    # Go backend
│   ├── app.go              # App lifecycle, tab connections
│   ├── ssh.go              # SSH connection management
│   ├── terminal.go         # PTY terminal sessions
│   ├── sftp.go             # File transfer operations
│   └── ai.go               # AI config, test connection, chat
├── frontend/src/           # JavaScript modules
│   ├── main.js             # Entry point, init, tabs, events
│   ├── state.js            # Shared state variables
│   ├── ui.js               # Utilities, toast, markdown
│   ├── terminal.js         # Terminal init & resize
│   ├── profiles.js         # Connection profiles CRUD
│   ├── settings.js         # Terminal settings dialog
│   ├── ai.js               # AI assistant (chat, config, convos)
│   ├── sftp.js             # SFTP file browser & transfers
│   └── preview.js          # File preview dialog
└── build/                  # Build configurations
```

---

## Features

| Feature | Status |
|---------|--------|
| SSH connection (password + key) | ✅ |
| Interactive terminal with fit-to-container | ✅ |
| SFTP file listing and navigation | ✅ |
| File upload with progress | ✅ |
| File download with progress | ✅ |
| File delete | ✅ |
| File rename | ✅ |
| Create directory | ✅ |
| File preview (images, text, PDF, video, audio) | ✅ |
| Connection profiles (save/load) | ✅ |
| Terminal settings (font, size, line height) | ✅ |
| Right-click context menu (copy/paste) | ✅ |
| Ctrl+Shift+C / Ctrl+Shift+V shortcuts | ✅ |
| Auto-scroll to latest terminal output | ✅ |
| ResizeObserver + window resize for responsive terminal | ✅ |
| Toast notifications | ✅ |
| Dark theme | ✅ |
| Cross-platform (Windows, Linux, macOS) | ✅ |
| Single portable executable | ✅ |
| No runtime dependencies | ✅ |
| **Multi-Tab connections** | ✅ |
| **Per-tab SFTP filesystem** | ✅ |
| **AI Assistant (any OpenAI-compatible API)** | ✅ |
| **Explain commands from terminal context menu** | ✅ |
| **Streaming chat with local LLM** | ✅ |
| **Multiple conversations with persistence** | ✅ |
| **Markdown rendering** | ✅ |
| **Model search & switching** | ✅ |
| **Modular frontend (9 JS modules)** | ✅ |

---

## Technology Stack

| Component | Technology |
|-----------|------------|
| Backend | Go 1.25 + golang.org/x/crypto + github.com/pkg/sftp |
| Frontend | Vanilla JS (ES modules), no framework |
| Terminal | xterm.js with fit addon |
| Desktop framework | Wails v3 |
| WebView | Native (Edge WebView2 / WebKitGTK) |

---

## License

[MIT](LICENSE)

---

<div align="center">
Made with ❤️ by <a href="https://github.com/xErik444x">Erik Schwerdt</a>
</div>
