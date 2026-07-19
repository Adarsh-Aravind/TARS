// TARS — Electron main process (the one app that actually ships).
//
// Frameless, transparent, always-on-top overlay summoned via Alt+Space.
// The renderer (App.jsx) talks to the FastAPI backend directly over
// fetch/SSE — this process only manages the window, global shortcuts, the
// system tray, and (best effort) spawning the local Python backend.

const { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, nativeImage, screen, session } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

const WINDOW_WIDTH = 800;
const WINDOW_HEIGHT = 800; // roomy so the top-center voice animation has space
const IS_MAC = process.platform === 'darwin';

let win = null;
let tray = null;
let backendProcess = null;
let isQuitting = false;
let voiceMode = false; // top-center "listening" mode — pins the window open

// ---------------------------------------------------------------------------
// Best-effort local backend spawn
// ---------------------------------------------------------------------------
// Identical on all three platforms: if nothing is answering on :8000, start the
// repo's Python backend ourselves. This matters because the app can be started
// two ways — via scripts/launch.py (which starts the backend first) or by
// double-clicking the packaged app (which doesn't). Health-checking first means
// neither path ends up with two backends fighting over the port.
function backendIsReachable() {
  return new Promise((resolve) => {
    const req = require('http').get(
      { host: '127.0.0.1', port: 8000, path: '/health', timeout: 1500 },
      (res) => { res.resume(); resolve(res.statusCode === 200); }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function spawnBackend() {
  if (await backendIsReachable()) {
    console.log('[TARS] Backend already running — not spawning another.');
    return;
  }

  const fs = require('fs');
  const backendDir = path.join(__dirname, '..', '..', 'Backend');
  const venvPython = process.platform === 'win32'
    ? path.join(__dirname, '..', '..', '.venv', 'Scripts', 'python.exe')
    : path.join(__dirname, '..', '..', '.venv', 'bin', 'python');

  // Fall back to a system Python; `python3` is the correct name on macOS/Linux,
  // where bare `python` is often absent entirely.
  const fallback = process.platform === 'win32' ? 'python' : 'python3';
  const pythonExecutable = fs.existsSync(venvPython) ? venvPython : fallback;

  if (!fs.existsSync(backendDir)) {
    console.error('[TARS] Backend directory not found; running UI only.');
    return;
  }

  try {
    backendProcess = spawn(pythonExecutable, ['Main.py'], {
      cwd: backendDir,
      env: { ...process.env, HOST: '127.0.0.1', PORT: '8000', PYTHONUNBUFFERED: '1' },
      stdio: 'inherit',
    });
    backendProcess.on('error', (err) => {
      console.error(`[TARS] Failed to spawn backend (${pythonExecutable}): ${err.message}. Start it manually.`);
      backendProcess = null;
    });
    backendProcess.on('close', (code) => {
      console.log(`[TARS] Backend process exited with code ${code}`);
      backendProcess = null;
    });
  } catch (err) {
    console.error(`[TARS] Could not launch backend: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
function positionWindow() {
  if (!win) return;
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const x = Math.round(display.workArea.x + (display.workAreaSize.width - WINDOW_WIDTH) / 2);
  const y = Math.round(display.workArea.y + display.workAreaSize.height * 0.12);
  win.setPosition(x, y);
}

// Voice "listening" mode: slide the (transparent) window to the top-center of
// the screen so the glass listening island renders right at the top edge — and
// on macOS flush to y=0 so it hugs / blends into the MacBook notch. Also pins
// the window open (blur won't hide it) for the few seconds we're capturing.
function setVoiceMode(active) {
  voiceMode = active;
  if (!win) return;
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const x = Math.round(display.bounds.x + (display.bounds.width - WINDOW_WIDTH) / 2);
  if (active) {
    // macOS: bounds.y is the physical screen top (the notch sits just above the
    // menu bar), so y=0 lets the island tuck under/around it. Windows/Linux:
    // use workArea so we clear the top of the screen cleanly.
    const y = IS_MAC ? display.bounds.y : Math.round(display.workArea.y);
    win.setPosition(x, y);
    if (!win.isVisible()) win.show();
  } else {
    positionWindow();
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    show: false,               // start hidden — this is the "pop up" behavior
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,         // live in the tray, not the taskbar
    alwaysOnTop: true,
    hasShadow: false,          // avoids shadow artifacts on transparent windows
    // NOTE: do NOT set `backgroundMaterial: 'acrylic'` here. On Windows 11 it
    // conflicts with `transparent: true` and DWM paints an opaque gray fill
    // across the whole window instead of blurring the desktop. We keep the
    // window fully transparent and get the frosted-glass look on the pill
    // itself from the CSS `.glassmorphic-panel` (gradient + backdrop-filter).
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,  // required for contextBridge
      nodeIntegration: false,  // security best practice
      backgroundThrottling: false,
    },
  });

  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const isDev = process.env.NODE_ENV !== 'production' && !app.isPackaged;
  if (isDev) {
    win.loadURL('http://localhost:5173').catch(() => {
      win.loadFile(path.join(__dirname, '../dist/index.html'));
    });
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Hide when focus is lost (unless DevTools has focus), so it behaves like
  // Siri instead of a sticky window.
  win.on('blur', () => {
    // Don't vanish mid-listen: while the voice island is up we're capturing
    // from the mic and the window is intentionally unfocused-friendly.
    if (win && !voiceMode && !win.webContents.isDevToolsFocused()) win.hide();
  });

  // Closing just hides — the tray keeps the app alive.
  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });
}

function showOverlay() {
  if (!win) return;
  positionWindow();
  win.show();
  win.focus();
}

function hideOverlay() {
  voiceMode = false;
  if (win && win.isVisible()) win.hide();
}

function summon(channel) {
  showOverlay();
  win.webContents.send(channel);
}

function toggleOverlay() {
  if (!win) return;
  if (win.isVisible()) {
    hideOverlay();
  } else {
    summon('summon-text');
  }
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------
// A 16x16 template icon drawn inline, so the tray entry is actually visible
// without shipping a binary asset. macOS treats `template` images as masks and
// recolours them for light/dark menu bars automatically.
function trayIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">
    <rect x="3" y="1.5" width="4" height="13" rx="1" fill="black"/>
    <rect x="9" y="1.5" width="4" height="13" rx="1" fill="black"/>
  </svg>`;
  const img = nativeImage.createFromDataURL(
    'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')
  );
  if (IS_MAC) img.setTemplateImage(true);
  return img;
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('TARS');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show TARS', accelerator: 'Alt+Space', click: () => summon('summon-text') },
    { label: 'Voice input', accelerator: 'Shift+Alt+Space', click: () => summon('summon-voice') },
    { type: 'separator' },
    {
      label: 'Start at login',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({
          openAtLogin: item.checked,
          openAsHidden: true,      // honoured on macOS; TARS starts in the tray
          args: ['--hidden'],
        });
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]));
  tray.on('click', toggleOverlay);
}

// ---------------------------------------------------------------------------
// IPC (matches the API surface in preload.cjs / App.jsx)
// ---------------------------------------------------------------------------
function registerIpcHandlers() {
  ipcMain.on('hide-overlay', () => hideOverlay());
  ipcMain.on('request-show', () => showOverlay());
  ipcMain.on('set-voice-mode', (_event, active) => setVoiceMode(active));
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
// A second launch (double-clicking the app while it's already in the tray)
// should summon the existing instance, not start a rival one that fails to
// grab the global shortcuts and spawns a second backend.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => summon('summon-text'));

  app.whenReady().then(() => {
    if (IS_MAC && app.dock) app.dock.hide();

    // Grant microphone access (voice input) but deny everything else.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === 'media');
    });

    spawnBackend();
    createWindow();
    createTray();
    registerIpcHandlers();

    // Registration fails silently if another app owns the combo, which would
    // otherwise look like "TARS is broken" with no explanation anywhere.
    const shortcuts = [
      ['Alt+Space', toggleOverlay],
      ['Shift+Alt+Space', () => summon('summon-voice')],
    ];
    for (const [accelerator, handler] of shortcuts) {
      if (!globalShortcut.register(accelerator, handler)) {
        console.warn(`[TARS] Could not register ${accelerator} — another app has it.`);
      }
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  // Stay alive in the tray; only quit explicitly.
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (backendProcess) backendProcess.kill();
});
