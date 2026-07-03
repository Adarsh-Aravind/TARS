// ROMANOV — preload script
// Runs in an isolated context and exposes a minimal, safe API to the
// renderer via contextBridge. This is what renderer.js's "preload API"
// branch talks to when contextIsolation: true.

const { contextBridge, ipcRenderer } = require('electron');

// NOTE: method names below match renderer.js EXACTLY — it calls
// window.electronAPI.dispatch / .hideOverlay / .onStatusUpdate /
// .onNetworkUpdate / .onConnectionState / .onOverlayShow.
// Do not rename these without also updating renderer.js.
contextBridge.exposeInMainWorld('electronAPI', {
  // renderer -> main
  dispatch: (query) => {
    if (typeof query !== 'string') return;
    ipcRenderer.send('romanov:dispatch', query);
  },
  hideOverlay: () => ipcRenderer.send('romanov:hide'),

  // main -> renderer
  onStatusUpdate: (callback) =>
    ipcRenderer.on('romanov:status', (_event, key) => callback(key)),
  onNetworkUpdate: (callback) =>
    ipcRenderer.on('romanov:network', (_event, addr) => callback(addr)),
  onConnectionState: (callback) =>
    ipcRenderer.on('romanov:connected', (_event, live) => callback(live)),
  onOverlayShow: (callback) =>
    ipcRenderer.on('romanov:show', () => callback()),

  // extras (optional — only used if you wire live token streaming)
  onStreamChunk: (callback) =>
    ipcRenderer.on('romanov:stream-chunk', (_event, chunk) => callback(chunk)),
  onError: (callback) =>
    ipcRenderer.on('romanov:error', (_event, message) => callback(message)),
});

// Fix: overlay.html ships with <body class="preview-bg"> for browser
// preview. That class paints an opaque background, which defeats
// `transparent: true` in Electron. Strip it as soon as the DOM exists —
// preload only ever runs inside Electron, so this is safe.
window.addEventListener('DOMContentLoaded', () => {
  document.body.classList.remove('preview-bg');
});