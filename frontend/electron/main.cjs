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

// ---------------------------------------------------------------------------
// Best-effort local backend spawn
// ---------------------------------------------------------------------------
// On macOS we assume the backend is reached over a Live Share / port-forward
// tunnel, so we don't spawn Python locally. On Windows/Linux we try the repo
// venv, then fall back to `python` on PATH. If it can't start, the renderer
// simply shows "disconnected" and the user can start it manually.
function spawnBackend() {
  if (IS_MAC) {
    console.log('[TARS] Skipping local backend spawn on macOS.');
    return;
  }

  const backendDir = path.join(__dirname, '..', '..', 'Backend');
  const venvPython = process.platform === 'win32'
    ? path.join(__dirname, '..', '..', '.venv', 'Scripts', 'python.exe')
    : path.join(__dirname, '..', '..', '.venv', 'bin', 'python');

  const fs = require('fs');
  const pythonExecutable = fs.existsSync(venvPython) ? venvPython : 'python';

  try {
    backendProcess = spawn(pythonExecutable, ['Main.py'], {
      cwd: backendDir,
      env: { ...process.env, HOST: '127.0.0.1', PORT: '8000' },
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
    backgroundMaterial: process.platform === 'win32' ? 'acrylic' : undefined,
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
    if (win && !win.webContents.isDevToolsFocused()) win.hide();
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
function createTray() {
  // Empty native image keeps a valid (if blank) tray entry without shipping an
  // icon asset; the tooltip/menu still work.
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip('TARS');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show TARS', click: () => summon('summon-text') },
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
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
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

  globalShortcut.register('Alt+Space', toggleOverlay);       // text input
  globalShortcut.register('Shift+Alt+Space', () => summon('summon-voice')); // voice input

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

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
