// TARS — Electron main process
// Frameless, transparent, always-on-top overlay that pops up on Alt+Space
// and hides on blur / Escape — this is what makes it behave like Siri
// instead of a static webpage.
//
// ⚠️ DEPRECATED: this root-level /Electron folder is an earlier prototype.
// The app that actually ships now lives in /frontend/electron (main.cjs +
// preload.cjs), driven by /frontend/package.json's "electron" script.
// This file is kept only for reference — don't build from this folder.
// It's also missing the auto-spawn of the Python backend (see spawnBackend
// below, which is never called), so running it as-is requires the
// backend to already be started manually.

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
const net = require('net');
const { spawn } = require('child_process');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const WINDOW_WIDTH = 700;
const WINDOW_HEIGHT = 480;
const HOTKEY = 'Alt+Space';

// DYNAMIC RUNTIME CROSS-OS DETECTION:
const IS_MAC = process.platform === 'darwin';

const BACKEND_HOST = '127.0.0.1';
let BACKEND_PORT = 8000; // Default fallback for Live Share port forwarding tunnels
let BACKEND_HEALTH_URL = `http://${BACKEND_HOST}:${BACKEND_PORT}/health`;
const HEALTH_POLL_MS = 5000;

let mainWindow = null;
let tray = null;
let isQuitting = false;
let backendProcess = null;

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function spawnBackend(port) {
  // If running on Mac, do not try to run Python locally.
  if (IS_MAC) {
    console.log('[TARS] Live Share Mode: Bypassing local Python backend spawn on macOS.');
    return;
  }

  const dbPath = path.join(app.getPath('userData'), 'tars.db');
  const pythonExecutable = 'python'; // Windows ecosystem executable standard
  const scriptPath = path.join(__dirname, '..', 'Backend', 'Main.py');
  
  backendProcess = spawn(pythonExecutable, [scriptPath], {
    env: { ...process.env, PORT: port.toString(), SQLITE_PATH: dbPath },
    stdio: 'inherit'
  });
  
  backendProcess.on('close', (code) => {
    console.log(`[TARS] Backend process exited with code ${code}`);
  });
}

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
    backgroundMaterial: process.platform === 'win32' ? 'acrylic' : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'Preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173').catch(() => {
      console.log('[TARS] Vite dev server not running, loading built index.html');
      mainWindow.loadFile(path.join(__dirname, '../frontend/dist/index.html'));
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../frontend/dist/index.html'));
  }

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

  const cursorPoint = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursorPoint);
  const x = Math.round(display.workArea.x + (display.workAreaSize.width - WINDOW_WIDTH) / 2);
  const y = Math.round(display.workArea.y + display.workAreaSize.height * 0.18);
  mainWindow.setPosition(x, y);

  mainWindow.show();
  mainWindow.focus();
  
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
  ipcMain.on('tars:dispatch', (_event, query) => {
    handleDispatch(query);
  });

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
  const icon = nativeImage.createEmpty(); 
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
// Wake-word process listener
// ---------------------------------------------------------------------------
let wakeProcess = null;

function startWakeWordListener() {
  if (IS_MAC) {
    console.log('[TARS] Live Share Mode: Bypassing wake-word listener background process on macOS.');
    return;
  }

  const pythonBin = 'python';
  const scriptPath = path.join(__dirname, '../Backend/wake_word.py');

  console.log(`[TARS] Spawning wake-word listener process: ${pythonBin} ${scriptPath}`);
  wakeProcess = spawn(pythonBin, [scriptPath]);

  wakeProcess.stdout.on('data', (data) => {
    const text = data.toString().trim();
    if (text.includes('WAKE')) {
      console.log('[TARS] Wake word detected! Showing overlay window.');
      showOverlay();
    }
  });

  wakeProcess.stderr.on('data', (data) => {
    console.error(`[TARS Wake Listener] ${data.toString().trim()}`);
  });

  wakeProcess.on('close', (code) => {
    console.log(`[TARS] Wake word listener process exited with code ${code}`);
  });
}

// ---------------------------------------------------------------------------
// App lifecycle — Adaptive Cross-Platform Bootstrapper
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide();
  }

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true);
    } else {
      callback(false);
    }
  });

  // HARD OVERWRITE FOR YOUR MACBOOK LIVE SHARE SESSION:
  // Point directly to the port forwarding loopback tunnel
  BACKEND_PORT = 8000; 
  BACKEND_HEALTH_URL = `http://${BACKEND_HOST}:${BACKEND_PORT}/health`;
  
  createWindow();
  createTray();
  registerIpcHandlers();

  const registered = globalShortcut.register(HOTKEY, toggleOverlay);
  if (!registered) console.error(`[TARS] Shortcut registration failed: ${HOTKEY}`);

  pollBackendHealth();
  setInterval(pollBackendHealth, HEALTH_POLL_MS);
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (backendProcess) backendProcess.kill();
  if (wakeProcess) wakeProcess.kill();
});

app.on('window-all-closed', () => {});

app.on('before-quit', () => {
  isQuitting = true;
  if (backendProcess) backendProcess.kill();
  if (wakeProcess) wakeProcess.kill();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});