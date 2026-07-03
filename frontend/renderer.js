/**
 * TARS — renderer.js
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
 *       We only react to the 'tars:show' event to re-focus the input.
 */

'use strict';

/* ── DOM refs ──────────────────────────────────────────────────── */
const input       = document.getElementById('tars-input');
const statusDot   = document.getElementById('status-dot');
const statusText  = document.getElementById('status-text');
const connDot     = document.getElementById('conn-dot');
const connLabel   = document.getElementById('conn-label');
const micBtn      = document.getElementById('mic-btn');
const iconIdle    = document.getElementById('icon-idle');
const iconRunning = document.getElementById('icon-running');
const iconMic     = document.getElementById('icon-mic');
const replyBox    = document.getElementById('reply-box');
const replyContent = document.getElementById('reply-content');

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
  if (replyContent) replyContent.textContent = '';


  // IPC bridge — preload API (contextIsolation: true)
  if (window.electronAPI?.dispatch) {
    window.electronAPI.dispatch(query);
    return;
  }

  // IPC bridge — raw ipcRenderer (nodeIntegration: true)
  try {
    const { ipcRenderer } = require('electron');
    ipcRenderer.send('tars:dispatch', query);
    return;
  } catch (_) { /* not in Electron */ }

  // Browser dev: log
  console.log('[TARS] dispatch →', query);
}

/* ── Hide overlay ──────────────────────────────────────────────── */
function hideOverlay() {
  input.value = '';
  histIndex   = -1;
  if (replyBox) replyBox.classList.add('hidden');
  if (replyContent) replyContent.textContent = '';
  if (window.electronAPI?.resizeWindow) window.electronAPI.resizeWindow(68);
  setStatus('IDLE');
  stopListening();

  if (window.electronAPI?.hideOverlay) {
    window.electronAPI.hideOverlay();
    return;
  }

  try {
    const { ipcRenderer } = require('electron');
    ipcRenderer.send('tars:hide');
    return;
  } catch (_) { /* not in Electron */ }

  // Browser preview: just clear
  console.log('[TARS] hide requested');
}

/* ── Keyboard handler ───────────────────────────────────────────── */
input.addEventListener('keydown', (e) => {
  switch (e.key) {

    case 'Enter': {
      const query = input.value.trim();
      if (query) {
        window.isVoiceMode = false;
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
      if (mod) { 
        e.preventDefault(); 
        input.value = ''; 
        if (replyBox) replyBox.classList.add('hidden');
        if (replyContent) replyContent.textContent = '';
        if (window.electronAPI?.resizeWindow) window.electronAPI.resizeWindow(68);
      }
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
    console.warn('[TARS] Speech recognition not supported.');
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
        // Disabled native auto-dispatch for now since we're building a Python wake word engine.
        // If we want to use the mic button for dictation, we can uncomment this:
        // window.isVoiceMode = true;
        // dispatchQuery(transcript.trim());
        // input.value = '';
      }
    }
  };

  recognition.onerror = (e) => {
    console.warn('[TARS] Voice error:', e.error);
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
    // startListening(); // Old web speech API
    startListeningFromBackend();
  }
});

async function startListeningFromBackend() {
  isListening = true;
  micBtn.classList.add('listening');
  setStatus('LISTENING');
  input.placeholder = 'Listening via TARS voice engine…';
  input.value = '';

  try {
    const res = await fetch('http://127.0.0.1:8000/api/v1/audio/listen');
    if (res.ok) {
      const data = await res.json();
      const transcript = data.text;
      
      if (transcript && transcript.trim()) {
        input.value = transcript;
        window.isVoiceMode = true;
        dispatchQuery(transcript.trim());
        input.value = '';
      }
    }
  } catch (e) {
    console.error('Failed to listen from backend', e);
  } finally {
    isListening = false;
    micBtn.classList.remove('listening');
    if (statusDot.classList.contains('listening')) setStatus('IDLE');
    input.placeholder = 'Ask anything or give a command…';
  }
}

/* ── Wake word SSE Listener ─────────────────────────────────────── */
const eventSource = new EventSource('http://127.0.0.1:8000/api/v1/events');
eventSource.addEventListener('wakeup', () => {
  if (window.electronAPI?.showOverlay) {
    window.electronAPI.showOverlay();
  }
  // Briefly wait for overlay to appear before recording
  setTimeout(() => {
    if (!isListening) startListeningFromBackend();
  }, 300);
});

/* ── IPC listeners ──────────────────────────────────────────────── */

let sentenceBuffer = "";
let audioQueue = [];
let isPlaying = false;

function playNextAudio() {
  if (isPlaying || audioQueue.length === 0) return;
  isPlaying = true;
  const url = audioQueue.shift();
  const audio = new Audio(url);
  audio.onended = () => {
    isPlaying = false;
    playNextAudio();
  };
  audio.play();
}

// Preload API pattern (contextIsolation: true)
if (window.electronAPI) {
  window.electronAPI.onStatusUpdate?.((key)       => setStatus(key));
  window.electronAPI.onNetworkUpdate?.((addr)      => setNetworkAddress(addr));
  window.electronAPI.onConnectionState?.((live)    => setConnected(live));
  window.electronAPI.onOverlayShow?.(() => {
    setStatus('IDLE');
    if (replyBox) replyBox.classList.add('hidden');
    if (window.electronAPI?.resizeWindow) window.electronAPI.resizeWindow(68);
    requestAnimationFrame(() => input.focus());
  });
  window.electronAPI.onReplyChunk?.((chunk) => {
    if (replyBox && replyBox.classList.contains('hidden')) {
      replyBox.classList.remove('hidden');
      if (window.electronAPI?.resizeWindow) window.electronAPI.resizeWindow(400);
    }
    if (replyContent) {
      replyContent.textContent += chunk;
      replyBox.scrollTop = replyBox.scrollHeight;
    }

    if (window.isVoiceMode) {
      sentenceBuffer += chunk;
      // Simple sentence boundary detection
      if (/[.!?]\s+$/.test(sentenceBuffer) || /\n/.test(sentenceBuffer)) {
        const textToSpeak = sentenceBuffer.trim();
        sentenceBuffer = "";
        
        if (textToSpeak) {
           const url = `http://127.0.0.1:8000/api/v1/audio/synthesize?text=${encodeURIComponent(textToSpeak)}`;
           audioQueue.push(url);
           playNextAudio();
        }
      }
    }
  });
  
  window.electronAPI.onReplyEnd?.(() => {
    if (window.isVoiceMode && sentenceBuffer.trim()) {
      const url = `http://127.0.0.1:8000/api/v1/audio/synthesize?text=${encodeURIComponent(sentenceBuffer.trim())}`;
      audioQueue.push(url);
      playNextAudio();
      sentenceBuffer = "";
    }
  });
}

// Raw ipcRenderer (nodeIntegration: true)
try {
  const { ipcRenderer } = require('electron');
  ipcRenderer.on('tars:status',    (_, key)  => setStatus(key));
  ipcRenderer.on('tars:network',   (_, addr) => setNetworkAddress(addr));
  ipcRenderer.on('tars:connected', (_, live) => setConnected(live));
  ipcRenderer.on('tars:show', () => {
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
