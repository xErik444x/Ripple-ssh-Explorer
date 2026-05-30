<div align="center">

# ⚡ Ripple SSH

**SSH & SFTP Client** — Single portable executable, no dependencies.

Built with [Wails v2](https://wails.io) + [Go](https://go.dev) + vanilla HTML/CSS/JS.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Wails](https://img.shields.io/badge/Wails-v2-blue.svg)](https://wails.io)
[![Go](https://img.shields.io/badge/Go-1.23-00ADD8.svg)](https://go.dev)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey.svg)]()

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
- **Settings Panel** — Configure font size, line height, and font family in real time

---

## How it works

```
┌──────────────────────────────┐
│    Frontend (WebView)        │
│  HTML + CSS + JS + xterm.js  │
│  Embedded in the binary      │
└──────────┬───────────────────┘
           │ Go bindings (type-safe)
           ▼
┌──────────────────────────────┐
│  Go Backend (compiled in)    │
│  SSH via golang.org/x/crypto │
│  SFTP via github.com/pkg/sftp│
└──────────┬───────────────────┘
           │ SSH / SFTP
           ▼
┌──────────────────────────────┐
│    Remote SSH Server         │
└──────────────────────────────┘
```

Everything is compiled into a **single ~12MB executable** — no Node.js, no npm, no runtime dependencies.

---

## Quick Start

### Option 1: Download the release

1. Download `ripple-ssh-windows-amd64.exe` from [Releases](https://github.com/xErik444x/Ripple-ssh-Explorer/releases)
2. Double-click to run
3. Enter your SSH server details and click Connect

### Option 2: Build from source

**Prerequisites:**
- [Go](https://go.dev/dl/) v1.23+
- [Wails CLI](https://wails.io/docs/gettingstarted/installation): `go install github.com/wailsapp/wails/v2/cmd/wails@latest`
- [Node.js](https://nodejs.org/) v18+ (for frontend build)

```bash
git clone https://github.com/xErik444x/Ripple-ssh-Explorer.git
cd ripple-ssh-wails
npm install --prefix frontend
wails build
```

The executable will be at `build/bin/ripple-ssh.exe`

### Build commands

| Command | Description |
|---------|-------------|
| `wails dev` | Run in development mode with hot reload |
| `wails build` | Build production executable (~12MB) |
| `wails build -devtools` | Build with devtools (F12) for debugging |

---

## Debugging

### Backend logs
The app writes logs to `ripple-ssh.log` in the same directory as the executable. Check this file for SSH/SFTP errors.

### Frontend console
Build with `-devtools` flag, then press F12 in the app window to open the WebView devtools.

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
| ResizeObserver for responsive terminal | ✅ |
| Toast notifications | ✅ |
| Dark theme | ✅ |
| Cross-platform (Windows, Linux, macOS) | ✅ |
| Single portable executable | ✅ |
| No runtime dependencies | ✅ |

---

## Project Structure

```
ripple-ssh-wails/
├── main.go              # App entry point + Wails config
├── app.go               # SSH/SFTP backend (Go methods bound to frontend)
├── go.mod / go.sum      # Go dependencies
├── wails.json           # Wails project config
├── frontend/
│   ├── index.html       # App UI
│   ├── public/
│   │   ├── xterm.js     # Terminal emulator library
│   │   └── xterm-addon-fit.js
│   └── src/
│       ├── main.js      # Frontend logic
│       ├── style.css    # App styles
│       ├── xterm.css    # Terminal styles
│       └── fonts/       # Bundled fonts (Inter, Outfit, Fira Code)
└── build/               # Build output
```

---

## Technology Stack

| Component | Technology |
|-----------|------------|
| Backend | Go 1.23 + golang.org/x/crypto + github.com/pkg/sftp |
| Frontend | Vanilla HTML/CSS/JS |
| Terminal | xterm.js with fit addon |
| Desktop framework | Wails v2.12 |
| WebView | Native (Edge WebView2 / WebKit / GTK) |

---

## License

[MIT](LICENSE)

---

<div align="center">
Made with ❤️ by <a href="https://github.com/xErik444x">Erik Schwerdt</a>
</div>
