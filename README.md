# ROMANOV

> A shared repo among us friends to learn by interacting and building together.

A lightweight, frameless **Electron automation command overlay** that floats over your desktop on demand — summoned via a global hotkey (`Alt + Space`). Designed for both **macOS** and **Windows**.

---

## ✦ What it looks like

A single, compact **750 × 68 px** horizontal pill — pure glass, zero chrome. Think Siri meets TARS.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ● SYS.READY  │  Awaiting automation query or terminal sequence...  │ BACKEND TUNNEL │
│    OP.IDLE    │                                                      │ 127.0.0.1:8000 ●│
└─────────────────────────────────────────────────────────────────────────────┘
```

- **Left** — Live telemetry dot + system status labels  
- **Center** — Transparent command input  
- **Right** — Backend network bridge address + live connection dot  

---

## ✦ Frontend Structure

```
ROMANOV/
└── frontend/
    ├── overlay.html   ← Lean HTML shell (semantic, ARIA, CSP header)
    ├── styles.css     ← Full design system (glassmorphism, shadows, animations)
    └── renderer.js    ← Input logic, Electron IPC bridge, platform detection
```

### `overlay.html`
- Frameless, fully transparent Electron window target
- Semantic HTML5 with ARIA roles (`dialog`, `search`, `aria-live`)
- Content Security Policy meta tag pre-configured
- Remove `preview-bg` from `<body>` when loading in Electron

### `styles.css`
- **Glassmorphism 2.0** — `backdrop-filter: blur(44px) saturate(220%)`
- **Neumorphic depth** — 6-layer box-shadow stack (ambient + inset bevel)
- **Design tokens** — all colors, fonts, and spacing as CSS custom properties
- Cross-platform fixes — autofill flash, Windows scrollbar, High Contrast mode
- Full animation suite — pulse dot, halo ring, CRT flicker, slide-in entry

### `renderer.js`
- Dual IPC mode — works with `contextIsolation: true` (preload API) **and** `nodeIntegration: true` (raw `ipcRenderer`)
- Command history — `↑`/`↓` arrows cycle the last 50 dispatched queries
- Keyboard shortcuts — `Enter` dispatch · `Escape` hide · `Ctrl/Cmd+L` clear
- Status machine — `IDLE` → `RUNNING` → `DONE` / `ERROR` driven by IPC events
- Platform detection — macOS vs Windows micro-adjustments applied at runtime

---

## ✦ Electron Setup

### `BrowserWindow` options

```js
const { BrowserWindow } = require('electron');
const path = require('path');

const overlay = new BrowserWindow({
  width:  750,
  height: 68,
  frame:       false,         // no title bar
  transparent: true,          // glass works
  backgroundColor: '#00000000',
  hasShadow:   false,         // macOS: CSS handles shadows
  alwaysOnTop: true,
  skipTaskbar: true,

  // Windows 11 acrylic blur
  backgroundMaterial: 'acrylic',

  // macOS vibrancy
  // vibrancy: 'under-window',

  webPreferences: {
    contextIsolation: true,
    nodeIntegration:  false,
    preload: path.join(__dirname, 'preload.js'),
  },
});

overlay.loadFile('frontend/overlay.html');
overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
```

### `preload.js` (contextBridge API)

```js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  dispatch:          (query)    => ipcRenderer.send('romanov:dispatch', query),
  hideOverlay:       ()         => ipcRenderer.send('romanov:hide'),
  onStatusUpdate:    (callback) => ipcRenderer.on('romanov:status',    (_, v) => callback(v)),
  onNetworkUpdate:   (callback) => ipcRenderer.on('romanov:network',   (_, v) => callback(v)),
  onConnectionState: (callback) => ipcRenderer.on('romanov:connected', (_, v) => callback(v)),
  onOverlayShow:     (callback) => ipcRenderer.on('romanov:show',      ()     => callback()),
});
```

### Global hotkey (`Alt + Space`)

```js
const { globalShortcut, BrowserWindow } = require('electron');

app.whenReady().then(() => {
  globalShortcut.register('Alt+Space', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win.isVisible()) {
      win.hide();
    } else {
      win.show();
      win.focus();
      win.webContents.send('romanov:show');
    }
  });
});
```

---

## ✦ IPC Event Reference

| Channel | Direction | Payload | Description |
|---|---|---|---|
| `romanov:dispatch` | renderer → main | `string` | User-submitted command query |
| `romanov:hide` | renderer → main | — | Request to hide the overlay window |
| `romanov:show` | main → renderer | — | Overlay shown — re-focus input |
| `romanov:status` | main → renderer | `string` (key) | Status key: `IDLE` `RUNNING` `SYNCING` `ERROR` `DONE` |
| `romanov:network` | main → renderer | `string` | New network address e.g. `192.168.1.5:9000` |
| `romanov:connected` | main → renderer | `boolean` | Backend connection live/dead |

---

## ✦ Keyboard Shortcuts

| Key | Action |
|---|---|
| `Enter` | Dispatch command to backend |
| `Escape` | Clear input and hide overlay |
| `↑` / `↓` | Cycle command history (last 50) |
| `Ctrl+L` / `Cmd+L` | Clear input field |

---

## ✦ Browser Preview

Open `frontend/overlay.html` directly in Chrome/Edge to preview without Electron.  
The `preview-bg` class on `<body>` renders a dark radial gradient background so the glass effect is visible.

> Remove `class="preview-bg"` from `<body>` before loading in Electron.

---

## ✦ Tech Stack

| Layer | Technology |
|---|---|
| Shell | HTML5 (semantic, ARIA) |
| Styles | Vanilla CSS + Tailwind CSS (CDN) |
| Scripts | Vanilla JS (ES2020, no bundler required) |
| Runtime | Electron (Chromium renderer) |
| Font | JetBrains Mono → Consolas → SF Mono (fallback chain) |
| Platforms | macOS 12+ · Windows 10/11 |

---

## ✦ Contributing

This is a shared learning repo. PRs, experiments, and half-baked ideas are all welcome.  
Open an issue or push a branch — we figure it out together.
