/**
 * ROMANOV — Command Overlay  ·  renderer.js
 * Electron renderer-process script (runs in Chromium, both macOS + Windows)
 *
 * Responsibilities:
 *  1. Input lifecycle (focus, clear, dispatch)
 *  2. Keyboard shortcuts (Enter, Escape, arrow history)
 *  3. Status label cycling via Electron IPC
 *  4. Network address live-update via Electron IPC
 *  5. Platform detection + micro-adjustments
 *  6. Connection state management
 */

'use strict';

/* ── DOM refs ──────────────────────────────────────────────────────── */
const input        = document.getElementById('romanov-input');
const sysLabel     = document.getElementById('sys-status-label');
const opLabel      = document.getElementById('op-status-label');
const netAddrLabel = document.getElementById('net-addr-label');
const connDot      = document.getElementById('conn-dot');

/* ── Platform detection ────────────────────────────────────────────── */
// Electron exposes process.platform in the renderer (if nodeIntegration: true)
// or via a preload-exposed API. We fall back to UA sniffing if neither is available.
const platform = (() => {
  if (typeof process !== 'undefined' && process.platform) return process.platform;
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('win')) return 'win32';
  if (ua.includes('mac')) return 'darwin';
  return 'linux';
})();

const IS_WIN = platform === 'win32';
const IS_MAC = platform === 'darwin';

/* ── Command history (session only) ────────────────────────────────── */
const history   = [];
let   histIndex = -1;

/* ── Status label state ────────────────────────────────────────────── */
const STATUS = Object.freeze({
  IDLE:    { primary: 'SYS.READY',  secondary: 'OP.IDLE'  },
  RUNNING: { primary: 'PROC.RUN',   secondary: 'OP.BUSY'  },
  SYNCING: { primary: 'NET.SYNC',   secondary: 'OP.WAIT'  },
  ERROR:   { primary: 'SYS.FAULT',  secondary: 'OP.ERR'   },
  DONE:    { primary: 'PROC.DONE',  secondary: 'OP.IDLE'  },
});

function setStatus(key) {
  const s = STATUS[key] || STATUS.IDLE;
  if (sysLabel) sysLabel.textContent = s.primary;
  if (opLabel)  opLabel.textContent  = s.secondary;
}

/* ── Connection state ──────────────────────────────────────────────── */
function setConnected(isConnected) {
  if (!connDot) return;
  if (isConnected) {
    connDot.style.background  = 'var(--col-emerald)';
    connDot.style.boxShadow   = '0 0 5px 1.5px rgba(16,185,129,0.85)';
    connDot.title = 'Backend connection live';
  } else {
    connDot.style.background  = '#ef4444';
    connDot.style.boxShadow   = '0 0 5px 1.5px rgba(239,68,68,0.85)';
    connDot.title = 'Backend disconnected';
  }
}

function setNetworkAddress(addr) {
  if (netAddrLabel) netAddrLabel.textContent = addr;
}

/* ── Input dispatch ────────────────────────────────────────────────── */
function dispatchQuery(query) {
  if (!query) return;

  // Push to session history
  if (history[0] !== query) history.unshift(query);
  if (history.length > 50)  history.pop();
  histIndex = -1;

  // Signal "running" state
  setStatus('RUNNING');

  // ── Electron IPC bridge ───────────────────────────────────────────
  // If using contextIsolation: true + preload.js exposing electronAPI:
  if (window.electronAPI?.dispatch) {
    window.electronAPI.dispatch(query);
  } else {
    // Fallback: raw ipcRenderer (nodeIntegration: true)
    try {
      const { ipcRenderer } = require('electron');
      ipcRenderer.send('romanov:dispatch', query);
    } catch (_) {
      // Neither available — log for development
      console.log('[ROMANOV] → dispatch:', query);
    }
  }
}

function hideOverlay() {
  input.value = '';
  histIndex   = -1;
  input.blur();

  if (window.electronAPI?.hideOverlay) {
    window.electronAPI.hideOverlay();
  } else {
    try {
      const { ipcRenderer } = require('electron');
      ipcRenderer.send('romanov:hide');
    } catch (_) {
      // browser preview — no-op
      console.log('[ROMANOV] Overlay hide requested');
    }
  }
}

/* ── Keyboard handler ──────────────────────────────────────────────── */
input.addEventListener('keydown', (e) => {

  switch (e.key) {

    /* Enter: dispatch */
    case 'Enter': {
      const query = input.value.trim();
      if (query) {
        dispatchQuery(query);
        input.value = '';
      }
      break;
    }

    /* Escape: hide */
    case 'Escape': {
      hideOverlay();
      break;
    }

    /* Arrow Up: previous history entry */
    case 'ArrowUp': {
      e.preventDefault();
      if (history.length === 0) break;
      histIndex = Math.min(histIndex + 1, history.length - 1);
      input.value = history[histIndex];
      // Move cursor to end
      requestAnimationFrame(() => {
        input.selectionStart = input.selectionEnd = input.value.length;
      });
      break;
    }

    /* Arrow Down: next history entry */
    case 'ArrowDown': {
      e.preventDefault();
      histIndex = Math.max(histIndex - 1, -1);
      input.value = histIndex === -1 ? '' : history[histIndex];
      requestAnimationFrame(() => {
        input.selectionStart = input.selectionEnd = input.value.length;
      });
      break;
    }

    /* Ctrl+L / Cmd+L: clear input */
    case 'l':
    case 'L': {
      const mod = IS_MAC ? e.metaKey : e.ctrlKey;
      if (mod) { e.preventDefault(); input.value = ''; }
      break;
    }
  }
});

/* ── Electron IPC listeners (preload API pattern) ──────────────────── */

// Status updates from main process
if (window.electronAPI?.onStatusUpdate) {
  window.electronAPI.onStatusUpdate((key) => setStatus(key));
}

// Network address live update
if (window.electronAPI?.onNetworkUpdate) {
  window.electronAPI.onNetworkUpdate((addr) => setNetworkAddress(addr));
}

// Connection state
if (window.electronAPI?.onConnectionState) {
  window.electronAPI.onConnectionState((connected) => setConnected(connected));
}

// Overlay shown → re-focus and reset status
if (window.electronAPI?.onOverlayShow) {
  window.electronAPI.onOverlayShow(() => {
    setStatus('IDLE');
    requestAnimationFrame(() => input.focus());
  });
}

// Alternative: raw ipcRenderer (if nodeIntegration: true)
try {
  const { ipcRenderer } = require('electron');
  ipcRenderer.on('romanov:status',     (_, key)       => setStatus(key));
  ipcRenderer.on('romanov:network',    (_, addr)      => setNetworkAddress(addr));
  ipcRenderer.on('romanov:connected',  (_, connected) => setConnected(connected));
  ipcRenderer.on('romanov:show',       ()             => {
    setStatus('IDLE');
    requestAnimationFrame(() => input.focus());
  });
} catch (_) {
  // contextIsolation mode or browser preview — IPC handled via electronAPI above
}

/* ── Platform micro-adjustments ────────────────────────────────────── */
if (IS_WIN) {
  // Windows renders fonts slightly heavier — back off weight a step
  document.documentElement.style.setProperty('--font-weight-adjust', '300');

  // Windows Electron: vibrancy/acrylic requires the window to have
  // `backgroundMaterial: 'acrylic'` set in BrowserWindow options.
  // Flag it on the DOM so main.js can detect renderer readiness.
  document.documentElement.dataset.platform = 'win32';
}

if (IS_MAC) {
  document.documentElement.dataset.platform = 'darwin';
}

/* ── Auto-focus on DOMContentLoaded ───────────────────────────────── */
window.addEventListener('DOMContentLoaded', () => {
  requestAnimationFrame(() => input.focus());
});

/* ── Export helpers for main process if needed ─────────────────────── */
if (typeof module !== 'undefined') {
  module.exports = { setStatus, setNetworkAddress, setConnected };
}
