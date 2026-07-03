/**
 * ROMANOV — renderer.js
 * Electron renderer-process script · macOS + Windows
 *
 * Responsibilities:
 *  1. Input lifecycle (focus, clear, dispatch on Enter)
 *  2. Keyboard shortcuts (Enter · Escape · ↑↓ history · Ctrl/Cmd+L)
 *  3. Status UI updates (dot + label) driven by IPC or internal state
 *  4. Connection indicator (live/dead dot)
 *  5. Network address live-update via IPC
 *  6. Voice input via Web Speech API (mic button)
 *  7. Platform detection + micro-adjustments
 *  8. IPC bridge — works with both contextIsolation modes
 *
 * NOTE: Show/hide is handled entirely by Electron (globalShortcut + BrowserWindow).
 *       We only react to the 'romanov:show' event to re-focus the input.
 */

'use strict';

/* ── DOM refs ──────────────────────────────────────────────────── */
const input       = document.getElementById('romanov-input');
const statusDot   = document.getElementById('status-dot');
const statusText  = document.getElementById('status-text');
const connDot     = document.getElementById('conn-dot');
const connLabel   = document.getElementById('conn-label');
const micBtn      = document.getElementById('mic-btn');
const iconIdle    = document.getElementById('icon-idle');
const iconRunning = document.getElementById('icon-running');
const iconMic     = document.getElementById('icon-mic');

/* ── Platform detection ─────────────────────────────────────────── */
const platform = (() => {
  if (typeof process !== 'undefined' && process.platform) return process.platform;
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('win'))  return 'win32';
  if (ua.includes('mac'))  return 'darwin';
  return 'linux';
})();

const IS_WIN = platform === 'win32';
const IS_MAC = platform === 'darwin';

document.documentElement.dataset.platform = platform;

/* ── Command history (session only, max 50) ─────────────────────── */
const cmdHistory = [];
let   histIndex  = -1;

/* ── Status machine ─────────────────────────────────────────────── */
const STATUS_MAP = Object.freeze({
  IDLE:      { dot: 'idle',      label: 'Ready'     },
  RUNNING:   { dot: 'running',   label: 'Processing' },
  SYNCING:   { dot: 'running',   label: 'Syncing'   },
  DONE:      { dot: 'done',      label: 'Done'      },
  ERROR:     { dot: 'error',     label: 'Error'     },
  LISTENING: { dot: 'listening', label: 'Listening' },
});

function setStatus(key = 'IDLE') {
  const s = STATUS_MAP[key] || STATUS_MAP.IDLE;

  // Update dot class
  statusDot.className = `status-dot ${s.dot}`;

  // Update label text
  statusText.textContent = s.label;

  // Swap leading icon
  iconIdle.classList.toggle('hidden',    key !== 'IDLE' && key !== 'DONE');
  iconRunning.classList.toggle('hidden', key !== 'RUNNING' && key !== 'SYNCING');
  iconMic.classList.toggle('hidden',     key !== 'LISTENING');
}

/* ── Connection indicator ───────────────────────────────────────── */
function setConnected(isConnected) {
  connDot.className = `conn-dot ${isConnected ? 'connected' : 'disconnected'}`;
  connDot.title     = isConnected ? 'Backend connected' : 'Backend disconnected';
}

function setNetworkAddress(addr) {
  if (connLabel) connLabel.textContent = addr;
}

/* ── Dispatch query to backend via IPC ─────────────────────────── */
function dispatchQuery(query) {
  if (!query) return;

  // Save to history (deduplicate head)
  if (cmdHistory[0] !== query) cmdHistory.unshift(query);
  if (cmdHistory.length > 50)  cmdHistory.pop();
  histIndex = -1;

  setStatus('RUNNING');

  // IPC bridge — preload API (contextIsolation: true)
  if (window.electronAPI?.dispatch) {
    window.electronAPI.dispatch(query);
    return;
  }

  // IPC bridge — raw ipcRenderer (nodeIntegration: true)
  try {
    const { ipcRenderer } = require('electron');
    ipcRenderer.send('romanov:dispatch', query);
    return;
  } catch (_) { /* not in Electron */ }

  // Browser dev: log
  console.log('[ROMANOV] dispatch →', query);
}

/* ── Hide overlay ──────────────────────────────────────────────── */
function hideOverlay() {
  input.value = '';
  histIndex   = -1;
  setStatus('IDLE');
  stopListening();

  if (window.electronAPI?.hideOverlay) {
    window.electronAPI.hideOverlay();
    return;
  }

  try {
    const { ipcRenderer } = require('electron');
    ipcRenderer.send('romanov:hide');
    return;
  } catch (_) { /* not in Electron */ }

  // Browser preview: just clear
  console.log('[ROMANOV] hide requested');
}

/* ── Keyboard handler ───────────────────────────────────────────── */
input.addEventListener('keydown', (e) => {
  switch (e.key) {

    case 'Enter': {
      const query = input.value.trim();
      if (query) {
        dispatchQuery(query);
        input.value = '';
      }
      break;
    }

    case 'Escape': {
      hideOverlay();
      break;
    }

    case 'ArrowUp': {
      e.preventDefault();
      if (!cmdHistory.length) break;
      histIndex = Math.min(histIndex + 1, cmdHistory.length - 1);
      input.value = cmdHistory[histIndex];
      requestAnimationFrame(() => {
        input.selectionStart = input.selectionEnd = input.value.length;
      });
      break;
    }

    case 'ArrowDown': {
      e.preventDefault();
      histIndex   = Math.max(histIndex - 1, -1);
      input.value = histIndex === -1 ? '' : cmdHistory[histIndex];
      requestAnimationFrame(() => {
        input.selectionStart = input.selectionEnd = input.value.length;
      });
      break;
    }

    case 'l':
    case 'L': {
      const mod = IS_MAC ? e.metaKey : e.ctrlKey;
      if (mod) { e.preventDefault(); input.value = ''; }
      break;
    }
  }
});

/* ── Voice input (Web Speech API) ───────────────────────────────── */
let recognition = null;
let isListening = false;

function startListening() {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    console.warn('[ROMANOV] Speech recognition not supported.');
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous      = false;
  recognition.interimResults  = true;
  recognition.lang            = 'en-US';

  recognition.onstart = () => {
    isListening = true;
    micBtn.classList.add('listening');
    setStatus('LISTENING');
    input.placeholder = 'Listening…';
  };

  recognition.onresult = (e) => {
    const transcript = Array.from(e.results)
      .map(r => r[0].transcript)
      .join('');
    input.value = transcript;

    // If final result, auto-dispatch
    if (e.results[e.results.length - 1].isFinal) {
      stopListening();
      if (transcript.trim()) {
        dispatchQuery(transcript.trim());
        input.value = '';
      }
    }
  };

  recognition.onerror = (e) => {
    console.warn('[ROMANOV] Voice error:', e.error);
    stopListening();
  };

  recognition.onend = () => {
    stopListening();
  };

  recognition.start();
}

function stopListening() {
  if (recognition) {
    try { recognition.stop(); } catch (_) {}
    recognition = null;
  }
  isListening = false;
  micBtn.classList.remove('listening');
  if (statusDot.classList.contains('listening')) setStatus('IDLE');
  input.placeholder = 'Ask anything or give a command…';
}

micBtn.addEventListener('click', () => {
  if (isListening) {
    stopListening();
  } else {
    startListening();
  }
});

/* ── IPC listeners ──────────────────────────────────────────────── */

// Preload API pattern (contextIsolation: true)
if (window.electronAPI) {
  window.electronAPI.onStatusUpdate?.((key)       => setStatus(key));
  window.electronAPI.onNetworkUpdate?.((addr)      => setNetworkAddress(addr));
  window.electronAPI.onConnectionState?.((live)    => setConnected(live));
  window.electronAPI.onOverlayShow?.(() => {
    setStatus('IDLE');
    requestAnimationFrame(() => input.focus());
  });
}

// Raw ipcRenderer (nodeIntegration: true)
try {
  const { ipcRenderer } = require('electron');
  ipcRenderer.on('romanov:status',    (_, key)  => setStatus(key));
  ipcRenderer.on('romanov:network',   (_, addr) => setNetworkAddress(addr));
  ipcRenderer.on('romanov:connected', (_, live) => setConnected(live));
  ipcRenderer.on('romanov:show', () => {
    setStatus('IDLE');
    requestAnimationFrame(() => input.focus());
  });
} catch (_) {
  // contextIsolation mode or browser — handled above
}

/* ── Windows font tweak ─────────────────────────────────────────── */
if (IS_WIN) {
  document.documentElement.style.setProperty('--font-weight-adjust', '300');
}

/* ── Auto-focus ─────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  requestAnimationFrame(() => input.focus());
});
