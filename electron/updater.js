"use strict";
/**
 * Auto-Updater
 *
 * Handles automatic updates via GitHub releases using electron-updater.
 * - Checks for updates on startup (delayed) and periodically
 * - Shows dialogs for update available, downloading, and ready to install
 * - Sends status updates to the renderer process
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupAutoUpdater = setupAutoUpdater;
exports.checkForUpdates = checkForUpdates;
const electron_updater_1 = require("electron-updater");
const electron_1 = require("electron");
/**
 * Set up auto-updater for the application
 *
 * @param mainWindow - The main BrowserWindow to send status updates to
 */
function setupAutoUpdater(mainWindow) {
    // Configure updater
    electron_updater_1.autoUpdater.autoDownload = false;
    electron_updater_1.autoUpdater.autoInstallOnAppQuit = true;
    // Check on startup (delayed to not slow down launch)
    setTimeout(() => {
        checkForUpdates();
    }, 5000);
    // Check every 4 hours
    setInterval(() => {
        checkForUpdates();
    }, 4 * 60 * 60 * 1000);
    // ============ Update Events ============
    electron_updater_1.autoUpdater.on('checking-for-update', () => {
        console.log('[Updater] Checking for updates...');
        sendStatus(mainWindow, { status: 'checking' });
    });
    electron_updater_1.autoUpdater.on('update-available', (info) => {
        console.log('[Updater] Update available:', info.version);
        sendStatus(mainWindow, {
            status: 'available',
            version: info.version,
        });
        electron_1.dialog
            .showMessageBox(mainWindow, {
            type: 'info',
            title: 'Update Available',
            message: `Cascade ${info.version} is available.`,
            detail: 'Would you like to download it now?',
            buttons: ['Download', 'Later'],
            defaultId: 0,
            cancelId: 1,
        })
            .then(({ response }) => {
            if (response === 0) {
                electron_updater_1.autoUpdater.downloadUpdate();
            }
        });
    });
    electron_updater_1.autoUpdater.on('update-not-available', () => {
        console.log('[Updater] No updates available');
        sendStatus(mainWindow, { status: 'up-to-date' });
    });
    electron_updater_1.autoUpdater.on('download-progress', (progress) => {
        const percent = Math.round(progress.percent);
        console.log(`[Updater] Download progress: ${percent}%`);
        sendStatus(mainWindow, {
            status: 'downloading',
            percent,
        });
    });
    electron_updater_1.autoUpdater.on('update-downloaded', (info) => {
        console.log('[Updater] Update downloaded:', info.version);
        sendStatus(mainWindow, {
            status: 'ready',
            version: info.version,
        });
        electron_1.dialog
            .showMessageBox(mainWindow, {
            type: 'info',
            title: 'Update Ready',
            message: `Cascade ${info.version} is ready to install.`,
            detail: 'Restart now to update?',
            buttons: ['Restart', 'Later'],
            defaultId: 0,
            cancelId: 1,
        })
            .then(({ response }) => {
            if (response === 0) {
                electron_updater_1.autoUpdater.quitAndInstall();
            }
        });
    });
    electron_updater_1.autoUpdater.on('error', (error) => {
        console.error('[Updater] Error:', error);
        sendStatus(mainWindow, {
            status: 'error',
            error: error.message,
        });
    });
}
/**
 * Manually check for updates
 */
function checkForUpdates() {
    if (electron_1.app.isPackaged) {
        electron_updater_1.autoUpdater.checkForUpdates().catch((err) => {
            console.error('[Updater] Failed to check for updates:', err);
        });
    }
}
/**
 * Send update status to renderer
 */
function sendStatus(mainWindow, status) {
    if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-status', status);
    }
}
