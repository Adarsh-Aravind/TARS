const { app, BrowserWindow, ipcMain, globalShortcut } = require('electron');
const path = require('path');

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 800,
    height: 800, // Increased height so top-center animations have space
    show: false, // Start hidden
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    hasShadow: false, // Prevents Windows shadow rendering artifacts on transparent windows
    webPreferences: {
      nodeIntegration: false, // Recommended security practice
      contextIsolation: true, // Required for contextBridge
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev) {
    win.loadURL('http://localhost:5173');
    // win.webContents.openDevTools({ mode: 'detach' }); // Commented out to avoid popping up by default
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Handle IPC calls
  ipcMain.on('hide-overlay', () => {
    win.hide(); // Hide the window instead of quitting
  });

  ipcMain.on('request-show', () => {
    if (win) {
      win.show();
      win.focus();
    }
  });

  win.on('blur', () => {
    win.hide();
  });

  ipcMain.on('dispatch-query', (event, query) => {
    console.log(`Dispatching query: ${query}`);
    setTimeout(() => {
      let count = 0;
      const response = `TARS Response: I received "${query}". Processing complete.`;
      const words = response.split(' ');
      const interval = setInterval(() => {
        if (count < words.length) {
          event.sender.send('reply-chunk', (count === 0 ? '' : ' ') + words[count]);
          count++;
        } else {
          clearInterval(interval);
          event.sender.send('reply-end');
        }
      }, 100);
    }, 500);
  });
}

app.whenReady().then(() => {
  createWindow();

  // Register Global Shortcut for Text Input
  globalShortcut.register('Alt+Space', () => {
    if (win) {
      win.show();
      win.focus();
      win.webContents.send('summon-text');
    }
  });
  
  // Register Global Shortcut for Voice Input (Optional mapping, e.g. Shift+Alt+Space)
  globalShortcut.register('Shift+Alt+Space', () => {
    if (win) {
      win.show();
      win.focus();
      win.webContents.send('summon-voice');
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
