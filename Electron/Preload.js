// TARS — preload script
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
    ipcRenderer.send('tars:dispatch', query);
  },
  hideOverlay: () => ipcRenderer.send('tars:hide'),
  showOverlay: () => ipcRenderer.send('tars:show-overlay'),
  resizeWindow: (height) => ipcRenderer.send('tars:resize-window', height),

  // main -> renderer
  onStatusUpdate: (callback) =>
    ipcRenderer.on('tars:status', (_event, key) => callback(key)),
  onNetworkUpdate: (callback) =>
    ipcRenderer.on('tars:network', (_event, addr) => callback(addr)),
  onConnectionState: (callback) =>
    ipcRenderer.on('tars:connected', (_event, live) => callback(live)),
  onOverlayShow: (callback) =>
    ipcRenderer.on('tars:show', () => callback()),

  // extras (optional — only used if you wire live token streaming)
  onReplyChunk: (callback) =>
    ipcRenderer.on('tars:reply-chunk', (_event, chunk) => callback(chunk)),
  onReplyEnd: (callback) =>
    ipcRenderer.on('tars:reply-end', () => callback()),
  onError: (callback) =>
    ipcRenderer.on('tars:error', (_event, message) => callback(message)),
});

// Fix: overlay.html ships with <body class="preview-bg"> for browser
// preview. That class paints an opaque background, which defeats
// `transparent: true` in Electron. Strip it as soon as the DOM exists —
// preload only ever runs inside Electron, so this is safe.
window.addEventListener('DOMContentLoaded', () => {
  document.body.classList.remove('preview-bg');
});