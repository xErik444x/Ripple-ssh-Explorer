<div align="center">

# ⚡ Ripple SSH

**SSH & SFTP Client** built with [Neutralino.js](https://neutralino.js.org)

Lightweight, fast, and beautiful desktop SSH client with a built-in terminal, file explorer, and file preview — no Electron bloat.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Neutralino.js](https://img.shields.io/badge/Neutralino.js-6.7-blue.svg)](https://neutralino.js.org)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey.svg)]()

</div>

---

## ✨ Features

- **SSH Terminal** — Full xterm.js terminal with custom themes and configurable font size/line height
- **SFTP File Explorer** — Browse, upload, download, rename, and delete remote files
- **File Preview** — Right-click any file to preview images, text, PDFs, video, and audio in-app
- **Connection Profiles** — Save and manage multiple SSH connections with credentials
- **Real-time Progress** — Live transfer progress bars for uploads and downloads
- **Toast Notifications** — Non-blocking feedback for all operations
- **Dark Theme** — Beautiful dark UI with customizable terminal appearance
- **Settings Panel** — Configure font size, line height, and font family in real time
- **Cross-platform** — Runs on Windows, Linux, and macOS

## 📸 Screenshots

**Connection Setup**
![Connection Setup](https://i.imgur.com/nH29sXx.png)

**Connected — Terminal + File Explorer**
![Connected](https://i.imgur.com/s3rdVio.png)

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [pnpm](https://pnpm.io/) (v11+)
- [Neutralino CLI](https://neutralino.js.org/docs/cli/neu-cli)

### Installation

```bash
# Clone the repository
git clone https://github.com/youruser/ripple-ssh.git
cd ripple-ssh

# Install dependencies
pnpm install

# Prepare frontend (copies xterm files)
pnpm prepare

# Run in development mode
pnpm dev
```

### Build for Production

```bash
pnpm build
```

Compiled binaries will be in the `dist/` folder for each platform.

## 🏗️ Architecture

```
┌──────────────────────────┐
│    Frontend (WebView)    │
│  HTML + CSS + main.js    │
│  @xterm/xterm (Terminal) │
└───────────┬──────────────┘
            │ Neutralino.extensions.dispatch
            ▼
┌──────────────────────────┐
│  Neutralino Core Server  │
└───────────┬──────────────┘
            │ app.broadcast
            ▼
┌──────────────────────────┐
│  Node.js Extension       │
│  ssh2 (SSH + SFTP)       │
└───────────┬──────────────┘
            │ SSH / SFTP
            ▼
┌──────────────────────────┐
│    Remote SSH Server     │
└──────────────────────────┘
```

## 📁 Project Structure

```
ripple-ssh/
├── extensions/
│   └── ssh-connector/       # Node.js SSH/SFTP backend extension
│       ├── main.js           # Extension entry point
│       └── package.json
├── resources/
│   ├── css/
│   │   ├── style.css         # Main app styles
│   │   └── xterm.css         # Terminal styles (generated)
│   ├── fonts/                # Bundled Inter, Outfit, Fira Code
│   ├── icons/                # App icons
│   ├── js/
│   │   ├── main.js           # Frontend logic
│   │   ├── neutralino.js     # Neutralino client SDK
│   │   └── xterm*.js         # Terminal libs (generated)
│   └── index.html            # App UI
├── scripts/
│   └── prepare-frontend.js   # Copies xterm files to resources
├── neutralino.config.json    # Neutralino configuration
├── package.json              # Project metadata and scripts
└── pnpm-workspace.yaml       # pnpm workspace config
```

## ⚙️ Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Run in development mode |
| `pnpm build` | Build for production |
| `pnpm prepare` | Copy frontend dependencies |
| `pnpm clean` | Remove build output |
| `pnpm update` | Update Neutralino binaries |

## 🛡️ Security

- SSH credentials are stored locally in your OS config directory (`%APPDATA%/ripple-ssh` on Windows, `~/.config/ripple-ssh` on Linux/macOS)
- Config persists even if you move the executable to another folder
- Automatic migration from old storage on first run
- Path traversal validation on file operations
- Connection race condition protection
- Input sanitization against XSS

## 📄 License

[MIT](LICENSE)

---

Built with 💜 using [Neutralino.js](https://neutralino.js.org), [ssh2](https://github.com/mscdex/ssh2), and [@xterm/xterm](https://xtermjs.org/)
