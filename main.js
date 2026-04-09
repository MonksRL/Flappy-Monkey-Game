const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 460,
    height: 820,
    icon: path.join(__dirname, 'favicon.ico'),   // optional
    webPreferences: {
      nodeIntegration: true,      // REQUIRED for your updater code
      contextIsolation: false     // REQUIRED for your updater code
    }
  });

  win.loadFile('index.html');
  // win.webContents.openDevTools(); // remove for release
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});