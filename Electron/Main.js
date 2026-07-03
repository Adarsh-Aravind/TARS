// TARS — Electron main process
// Frameless, transparent, always-on-top overlay that pops up on Alt+Space
// and hides on blur / Escape — this is what makes it behave like Siri
// instead of a static webpage.

const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  screen,
  Tray,
  Menu,
  nativeImage,
  session,
} = require('electron');
const path = require('path');
const http = require('http');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const WINDOW_WIDTH = 680;
const WINDOW_HEIGHT = 88;
const HOTKEY = 'Alt+Space';
const BACKEND_HOST = '127.0.0.1';
const BACKEND_PORT = 8000;
const BACKEND_HEALTH_URL = `http://${BACKEND_HOST}:${BACKEND_PORT}/health`;
const HEALTH_POLL_MS = 5000;

let mainWindow = null;
let tray = null;
let isQuitting = false;

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------
function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth } = primaryDisplay.workAreaSize;

  const x = Math.round((screenWidth - WINDOW_WIDTH) / 2);
  const y = Math.round(primaryDisplay.workArea.y + primaryDisplay.workAreaSize.height * 0.18);

  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false, // start hidden — this IS the "pop up" behavior
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    roundedCorners: true,
    // NOTE: intentionally NOT using native `vibrancy` here. It fights with
    // the CSS backdrop-filter glassmorphism already built into styles.css —
    // the two compositing layers together caused the black-flash-until-drag
    // bug. Let CSS own the glass effect entirely.
    // Windows 11 acrylic (Electron >= 27 via backgroundMaterial) is fine to
    // keep since Windows doesn't have the same conflict.
    backgroundMaterial: process.platform === 'win32' ? 'acrylic' : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  // 'floating' (not 'screen-saver') — screen-saver level is the most
  // aggressive always-on-top tier macOS has and interferes with normal
  // focus/blur semantics, which is why outside clicks weren't hiding the
  // window. 'floating' is what Spotlight/Alfred-style overlays use.
  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  mainWindow.loadFile(path.join(__dirname, '..', 'frontend', 'overlay.html'));

  // Hide (not close) when it loses focus — classic Spotlight/Siri behavior
  mainWindow.on('blur', () => {
    if (mainWindow && !mainWindow.webContents.isDevToolsFocused()) {
      hideOverlay();
    }
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      hideOverlay();
    }
  });

  mainWindow.webContents.once('did-finish-load', () => {
    sendNetworkStatus();
  });
}

// ---------------------------------------------------------------------------
// Show / hide / toggle
// ---------------------------------------------------------------------------
function showOverlay() {
  if (!mainWindow) return;

  // Re-center on whichever display currently has the cursor, so it shows
  // up near the user on multi-monitor setups.
  const cursorPoint = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursorPoint);
  const x = Math.round(display.workArea.x + (display.workAreaSize.width - WINDOW_WIDTH) / 2);
  const y = Math.round(display.workArea.y + display.workAreaSize.height * 0.18);
  mainWindow.setPosition(x, y);

  mainWindow.show();
  mainWindow.focus();
  // Workaround for a known Electron/macOS bug: transparent windows can
  // render as solid black until the compositor is forced to repaint (which
  // is why dragging "revealed" the glass effect). A same-frame size nudge
  // forces that repaint immediately on show, before the user ever sees it.
  const [w, h] = mainWindow.getSize();
  mainWindow.setSize(w, h + 1);
  mainWindow.setSize(w, h);

  mainWindow.webContents.send('tars:show');
}

function hideOverlay() {
  if (!mainWindow || !mainWindow.isVisible()) return;
  mainWindow.webContents.send('tars:hide');
  mainWindow.hide();
}

function toggleOverlay() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    hideOverlay();
  } else {
    showOverlay();
  }
}

// ---------------------------------------------------------------------------
// IPC — mirrors the 6 channels documented in the project README
// ---------------------------------------------------------------------------
function registerIpcHandlers() {
  // renderer -> main: user submitted a command
  ipcMain.on('tars:dispatch', (_event, query) => {
    handleDispatch(query);
  });

  // renderer -> main: explicit hide request (e.g. Escape key)
  ipcMain.on('tars:hide', () => {
    hideOverlay();
  });
  
  ipcMain.on('tars:show-overlay', () => {
    showOverlay();
  });

  ipcMain.on('tars:resize-window', (event, height) => {
    if (mainWindow) {
      mainWindow.setContentSize(WINDOW_WIDTH, height);
    }
  });
}

async function handleDispatch(query) {
  if (!mainWindow) return;
  mainWindow.webContents.send('tars:status', 'RUNNING');

  try {
    const response = await fetch(`http://${BACKEND_HOST}:${BACKEND_PORT}/api/v1/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: query }] }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`Backend responded ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunkStr = decoder.decode(value, { stream: true });
      const lines = chunkStr.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const dataStr = line.substring(6).trim();
          if (!dataStr) continue;
          
          try {
            const data = JSON.parse(dataStr);
            if (data.chunk) {
              mainWindow.webContents.send('tars:reply-chunk', data.chunk);
            } else if (data.detail) {
              mainWindow.webContents.send('tars:error', data.detail);
            }
          } catch (e) {
            // ignore JSON parse errors on incomplete chunks if any
          }
        }
      }
    }

    mainWindow.webContents.send('tars:reply-end');
    mainWindow.webContents.send('tars:status', 'DONE');
  } catch (err) {
    mainWindow.webContents.send('tars:status', 'ERROR');
    mainWindow.webContents.send('tars:error', String(err.message || err));
  }
}

// ---------------------------------------------------------------------------
// Backend connectivity polling -> 'tars:connected' + 'tars:network'
// ---------------------------------------------------------------------------
function sendNetworkStatus() {
  if (!mainWindow) return;
  // renderer.js does `connLabel.textContent = addr` — must be a plain string,
  // not an object.
  mainWindow.webContents.send('tars:network', `${BACKEND_HOST}:${BACKEND_PORT}`);
}

function pollBackendHealth() {
  const req = http.get(BACKEND_HEALTH_URL, { timeout: 2000 }, (res) => {
    const connected = res.statusCode >= 200 && res.statusCode < 300;
    if (mainWindow) mainWindow.webContents.send('tars:connected', connected);
    res.resume();
  });
  req.on('error', () => {
    if (mainWindow) mainWindow.webContents.send('tars:connected', false);
  });
  req.on('timeout', () => req.destroy());
}

// ---------------------------------------------------------------------------
// Tray icon — lets the user quit / reopen without a Dock/taskbar presence
// ---------------------------------------------------------------------------
function createTray() {
  const icon = nativeImage.createEmpty(); // swap in a real .png/.ico asset
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('TARS');
  const menu = Menu.buildFromTemplate([
    { label: 'Show TARS', click: showOverlay },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', toggleOverlay);
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  // macOS: hide the Dock icon so this behaves like a background utility
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide();
  }

  // Allow microphone access for Web Speech API
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true);
    } else {
      callback(false);
    }
  });

  createWindow();
  createTray();
  registerIpcHandlers();

  const registered = globalShortcut.register(HOTKEY, toggleOverlay);
  if (!registered) {
    console.error(`[TARS] Failed to register global shortcut: ${HOTKEY}`);
  }

  pollBackendHealth();
  setInterval(pollBackendHealth, HEALTH_POLL_MS);
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  // Keep the app alive in the tray on all platforms — it's a background overlay.
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});