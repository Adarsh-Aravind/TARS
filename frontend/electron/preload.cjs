const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Static platform info (so the renderer can style the notch-blended voice
  // island on macOS vs a floating glass pill elsewhere).
  platform: process.platform,

  // Listeners
  onConnectionState: (callback) => ipcRenderer.on('connection-state', (_event, connected) => callback(connected)),
  onNetworkUpdate: (callback) => ipcRenderer.on('network-update', (_event, addr) => callback(addr)),
  onStatusUpdate: (callback) => ipcRenderer.on('status-update', (_event, key) => callback(key)),
  onReplyChunk: (callback) => ipcRenderer.on('reply-chunk', (_event, chunk) => callback(chunk)),
  onReplyEnd: (callback) => ipcRenderer.on('reply-end', () => callback()),
  onError: (callback) => ipcRenderer.on('error', (_event, msg) => callback(msg)),
  onOverlayShow: (callback) => ipcRenderer.on('overlay-show', () => callback()),
  onSummonText: (callback) => ipcRenderer.on('summon-text', () => callback()),
  onSummonVoice: (callback) => ipcRenderer.on('summon-voice', () => callback()),

  // Senders
  hideOverlay: () => ipcRenderer.send('hide-overlay'),
  requestShow: () => ipcRenderer.send('request-show'),
  // Enter/leave the top-center "listening" mode (repositions the window to the
  // top of the screen / notch and pins it open while active).
  setVoiceMode: (active) => ipcRenderer.send('set-voice-mode', !!active)
});
