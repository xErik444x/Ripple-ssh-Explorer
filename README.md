<div align="center">

# ⚡ Ripple SSH

**SSH & SFTP Client** — Single portable executable, no dependencies.

Built with [Wails v3](https://v3.wails.io) + [Go](https://go.dev) + vanilla HTML/CSS/JS.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Wails](https://img.shields.io/badge/Wails-v3-blue.svg)](https://v3.wails.io)
[![Go](https://img.shields.io/badge/Go-1.24-00ADD8.svg)](https://go.dev)
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
- [Go](https://go.dev/dl/) v1.24+
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

## Debugging

### Backend logs
The app writes logs to `ripple-ssh.log` in the same directory as the executable. Check this file for SSH/SFTP errors.

### Frontend console
In desktop mode, press F12 to open devtools. In server mode, open your browser's devtools (F12).

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

## Technology Stack

| Component | Technology |
|-----------|------------|
| Backend | Go 1.24 + golang.org/x/crypto + github.com/pkg/sftp |
| Frontend | Vanilla HTML/CSS/JS |
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
