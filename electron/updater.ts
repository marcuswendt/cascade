/**
 * Auto-Updater
 *
 * Handles automatic updates via GitHub releases using electron-updater.
 * - Checks for updates on startup (delayed) and periodically
 * - Shows dialogs for update available, downloading, and ready to install
 * - Sends status updates to the renderer process
 */

import { autoUpdater, type UpdateInfo, type ProgressInfo } from 'electron-updater';
import { app, dialog, BrowserWindow } from 'electron';

/**
 * Set up auto-updater for the application
 *
 * @param mainWindow - The main BrowserWindow to send status updates to
 */
export function setupAutoUpdater(mainWindow: BrowserWindow): void {
  // Configure updater
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // Check on startup (delayed to not slow down launch)
  setTimeout(() => {
    checkForUpdates();
  }, 5000);

  // Check every 4 hours
  setInterval(
    () => {
      checkForUpdates();
    },
    4 * 60 * 60 * 1000
  );

  // ============ Update Events ============

  autoUpdater.on('checking-for-update', () => {
    console.log('[Updater] Checking for updates...');
    sendStatus(mainWindow, { status: 'checking' });
  });

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    console.log('[Updater] Update available:', info.version);
    sendStatus(mainWindow, {
      status: 'available',
      version: info.version,
    });

    dialog
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
          autoUpdater.downloadUpdate();
        }
      });
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[Updater] No updates available');
    sendStatus(mainWindow, { status: 'up-to-date' });
  });

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    const percent = Math.round(progress.percent);
    console.log(`[Updater] Download progress: ${percent}%`);
    sendStatus(mainWindow, {
      status: 'downloading',
      percent,
    });
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    console.log('[Updater] Update downloaded:', info.version);
    sendStatus(mainWindow, {
      status: 'ready',
      version: info.version,
    });

    dialog
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
          autoUpdater.quitAndInstall();
        }
      });
  });

  autoUpdater.on('error', (error: Error) => {
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
export function checkForUpdates(): void {
  if (app.isPackaged) {
    autoUpdater.checkForUpdates().catch((err: Error) => {
      console.error('[Updater] Failed to check for updates:', err);
    });
  }
}

/**
 * Send update status to renderer
 */
function sendStatus(mainWindow: BrowserWindow, status: UpdateStatus): void {
  if (!mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', status);
  }
}

/**
 * Update status types
 */
export interface UpdateStatus {
  status: 'checking' | 'available' | 'up-to-date' | 'downloading' | 'ready' | 'error';
  version?: string;
  percent?: number;
  error?: string;
}
