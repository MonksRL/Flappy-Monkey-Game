const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const { createDiscordPresence } = require('./discord-presence');

// A packaged build may be launched without a durable parent console. Windows
// can close Electron's inherited stdout/stderr pipe while the app is still
// running; a later diagnostic write would then surface as an uncaught EPIPE
// main-process error. Diagnostics are optional, so quietly detach a broken
// stream instead of allowing it to crash the game.
function ignoreClosedDiagnosticPipe(stream) {
  if (!stream || typeof stream.on !== 'function') return;
  stream.on('error', (error) => {
    if (error?.code !== 'EPIPE') throw error;
  });
}

ignoreClosedDiagnosticPipe(process.stdout);
ignoreClosedDiagnosticPipe(process.stderr);

let mainWindow;
let discordPresence;
const startupSmokeTest = process.env.FLAPPY_SMOKE_TEST === 'true';
let rendererErrorCount = 0;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: startupSmokeTest ? 1000 : 460,
    height: 720,
    minWidth: 460,
    minHeight: 720,
    resizable: true,
    maximizable: true,
    fullscreen: !startupSmokeTest,
    autoHideMenuBar: true,
    show: !startupSmokeTest,
    icon: path.join(__dirname, 'icon.ico'),
    backgroundColor: '#222222',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      // Keep gameplay, WebSocket heartbeats, and animation timers running when
      // the user switches to another window or monitor.
      backgroundThrottling: false
    }
  });

  mainWindow.webContents.setBackgroundThrottling(false);

  mainWindow.loadFile('index.html');

  if (startupSmokeTest) {
    mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      if (level >= 2) {
        rendererErrorCount += 1;
        console.error(`Renderer: ${message} (${sourceId}:${line})`);
      }
    });
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const result = await mainWindow.webContents.executeJavaScript(`(async () => {
            const gate = document.getElementById('onlineStartupGate');
            const auth = document.getElementById('startupAuth');
            const registerEmail = document.getElementById('startupRegisterEmail');
            const settingsAccountPanel = document.getElementById('onlineAccountSettingsPanel');
            const socialPanel = document.getElementById('mpSocialPanel');
            const resetButton = document.getElementById('resetBtn');
            const lobbyButtons = [...document.querySelectorAll('.button-row > button')].filter((button) => getComputedStyle(button).display !== 'none');
            const lobbyLabelsFit = lobbyButtons.every((button) => button.scrollWidth <= button.clientWidth + 1);
            const lobbyButtonWidths = lobbyButtons.map((button) => ({ id: button.id, client: button.clientWidth, scroll: button.scrollWidth }));
            document.getElementById('profileBtn')?.click();
            const activeAccountId = window.flappyGetActiveOnlineAccount?.()?.id || '';
            const profileTestId = activeAccountId || 'FMU_SMOKE_TEST_PUBLIC_ID';
            if (!activeAccountId && typeof applyOnlineAccountToProfile === 'function') {
              applyOnlineAccountToProfile({ id: profileTestId });
            }
            const profileUserIdRow = document.getElementById('profileUserIdRow');
            const profileUserIdVisibleWhenAccount = Boolean(
              profileUserIdRow
              && !profileUserIdRow.hidden
              && document.getElementById('profileUserIdValue')?.textContent.trim() === profileTestId
            );
            document.getElementById('closeProfileMenu')?.click();
            void window.gameConfirm?.('Reset ALL progress? This cannot be undone.', {
              title: 'Reset All Progress?',
              confirmLabel: 'Reset Progress',
              danger: true
            });
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const resetDialog = document.getElementById('flappyGameDialogLayer');
            const resetWarningOpens = Boolean(
              window.FlappyDialog?.isOpen?.()
              && resetDialog?.classList.contains('open')
              && resetDialog.getAttribute('aria-hidden') === 'false'
            );
            const resetWarningText = document.getElementById('flappyGameDialogMessage')?.textContent || '';
            const resetUsesCustomDialog = Boolean(
              resetWarningText.includes('Reset ALL progress')
              && resetDialog?.querySelector('.fm-dialog-confirm')?.textContent.includes('Reset Progress')
            );
            resetDialog?.querySelector('.fm-dialog-cancel')?.click();
            await new Promise((resolve) => setTimeout(resolve, 200));
            document.getElementById('onlineHubBtn')?.click();
            return {
              gateExists: Boolean(gate),
              gateLocked: Boolean(gate && !gate.classList.contains('unlocked')),
              authOpen: Boolean(auth && auth.classList.contains('open')),
              emailFieldExists: Boolean(registerEmail),
              settingsAccountPanelExists: Boolean(settingsAccountPanel),
              socialPanelExists: Boolean(socialPanel),
              resetButtonExists: Boolean(resetButton),
              resetWarningOpens,
              resetUsesCustomDialog,
              onlineHubOpen: Boolean(document.getElementById('onlineModesScreen')?.classList.contains('open')),
              onlineModeCount: document.querySelectorAll('.online-hub-card').length,
              inventoryExists: Boolean(document.getElementById('inventoryMenu')),
              monkeyWorldHiddenAtStartup: getComputedStyle(document.getElementById('monkeyWorldScreen')).display === 'none',
              defenseRankHasLabel: Boolean(document.getElementById('odRankCard')?.textContent.trim()),
              headerLevelBadgeExists: Boolean(document.querySelector('#usernameDisplayHeader .header-level-badge')),
              activeAccountIdFound: Boolean(activeAccountId),
              profileUserIdVisibleWhenAccount,
              lobbyButtonCount: lobbyButtons.length,
              lobbyLabelsFit,
              lobbyButtonWidths,
              viewportWidth: innerWidth,
              lobbyRowWidth: document.querySelector('.button-row')?.clientWidth || 0,
              lobbyRowWrap: document.querySelector('.button-row') ? getComputedStyle(document.querySelector('.button-row')).flexWrap : 'missing',
              lobbyRowCssWidth: document.querySelector('.button-row') ? getComputedStyle(document.querySelector('.button-row')).width : 'missing',
              desktopMediaMatches: matchMedia('(min-width: 900px)').matches,
              gateDisplay: gate ? getComputedStyle(gate).display : 'missing'
            };
          })()`);
          console.log(`STARTUP_UI_RESULT=${JSON.stringify(result)}`);
          const passed = result.gateExists && result.emailFieldExists && result.settingsAccountPanelExists && result.socialPanelExists && result.resetButtonExists && result.resetWarningOpens && result.resetUsesCustomDialog && result.onlineHubOpen && result.onlineModeCount === 4 && result.inventoryExists && result.monkeyWorldHiddenAtStartup && result.defenseRankHasLabel && result.headerLevelBadgeExists && result.profileUserIdVisibleWhenAccount && result.lobbyButtonCount >= 7 && result.lobbyLabelsFit && rendererErrorCount === 0;
          app.exit(passed ? 0 : 1);
        } catch (error) {
          console.error(`Startup UI smoke test failed: ${error.message}`);
          app.exit(1);
        }
      }, 2300);
    });
  }

  if (startupSmokeTest) console.log('✅ Flappy Monkey launched successfully');
}

ipcMain.on('discord-presence:set-enabled', (_event, enabled) => {
  discordPresence?.setEnabled(Boolean(enabled));
});

ipcMain.on('discord-presence:update', (_event, activity) => {
  discordPresence?.updateActivity(activity);
});

ipcMain.handle('discord-presence:get-status', () => discordPresence?.getStatus() || {
  status: 'unavailable',
  configured: false,
  enabled: false
});

app.whenReady().then(() => {
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, _requestingOrigin, details) => {
    if (permission !== 'media') return false;
    const mediaTypes = Array.isArray(details?.mediaTypes) ? details.mediaTypes : [];
    return mediaTypes.length === 0 || (mediaTypes.includes('audio') && !mediaTypes.includes('video'));
  });
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    if (permission !== 'media') { callback(false); return; }
    const mediaTypes = Array.isArray(details?.mediaTypes) ? details.mediaTypes : [];
    callback(mediaTypes.length === 0 || (mediaTypes.includes('audio') && !mediaTypes.includes('video')));
  });
  discordPresence = createDiscordPresence({
    baseDirectory: __dirname,
    onStatus(status) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('discord-presence:status', status);
      }
    }
  });
  createWindow();
});

app.on('window-all-closed', () => {
  discordPresence?.destroy();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
