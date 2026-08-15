const { app, BrowserWindow, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 460,
        height: 820,
        icon: path.join(__dirname, 'favicon.ico'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    mainWindow.loadFile('index.html');

    // Auto Updater Setup
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => {
        mainWindow.webContents.send('update-message', '🔄 Checking for updates...');
    });

    autoUpdater.on('update-available', (info) => {
        mainWindow.webContents.send('update-message', `✅ Update available! Version ${info.version} downloading...`);
    });

    autoUpdater.on('update-not-available', () => {
        mainWindow.webContents.send('update-message', '🎉 You are up to date!');
    });

    autoUpdater.on('update-downloaded', () => {
        mainWindow.webContents.send('update-message', '✅ Update downloaded! Restart the game to apply it.');
    });

    autoUpdater.on('error', (err) => {
        mainWindow.webContents.send('update-message', '❌ Update error: ' + err.message);
    });
}

// IPC for "Check for Updates" button in your HTML
ipcMain.on('check-for-updates', () => {
    autoUpdater.checkForUpdatesAndNotify();
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});