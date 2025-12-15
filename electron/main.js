/**
 * Cascade Electron Main Process
 *
 * Entry point for the Electron application. Manages:
 * - Window creation and lifecycle
 * - Embedded Express server
 * - Native menu integration
 * - File associations and deep links
 */
import { app, BrowserWindow, shell, ipcMain, dialog } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { startServer, stopServer } from './server.js';
import { createMenu } from './menu.js';
import { addToRecentProjects } from './recent.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Handle creating/removing shortcuts on Windows when installing/uninstalling
// This is handled at runtime, not at compile time
if (process.platform === 'win32') {
    try {
        // Dynamic import for optional dependency
        const mod = 'electron-squirrel-startup';
        const squirrel = await import(/* webpackIgnore: true */ mod);
        if (squirrel.default)
            app.quit();
    }
    catch {
        // Not installed, continue
    }
}
let mainWindow = null;
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const SERVER_PORT = 3030;
const VITE_DEV_PORT = 5173;
// Store pending file path for when app launches via file association
let pendingFilePath = null;
/**
 * Create the main application window
 */
async function createWindow() {
    // Start the Express server before creating the window
    console.log('Starting embedded server...');
    await startServer();
    console.log('Server started');
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 800,
        minHeight: 600,
        // macOS-specific styling
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
        trafficLightPosition: { x: 16, y: 16 },
        vibrancy: process.platform === 'darwin' ? 'sidebar' : undefined,
        // Dark theme background to prevent flash
        backgroundColor: '#1a1a1a',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });
    // Load the app
    if (isDev) {
        // Development: load from Vite dev server
        console.log(`Loading from Vite dev server: http://localhost:${VITE_DEV_PORT}`);
        mainWindow.loadURL(`http://localhost:${VITE_DEV_PORT}`);
        mainWindow.webContents.openDevTools();
    }
    else {
        // Production: load built files
        const indexPath = path.join(__dirname, '../dist/index.html');
        console.log(`Loading from built files: ${indexPath}`);
        mainWindow.loadFile(indexPath);
    }
    // Open external links in default browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http')) {
            shell.openExternal(url);
        }
        return { action: 'deny' };
    });
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
    // Handle pending file open (from file association launch)
    mainWindow.webContents.on('did-finish-load', () => {
        if (pendingFilePath) {
            mainWindow?.webContents.send('file:open', pendingFilePath);
            pendingFilePath = null;
        }
    });
    // Set up native menu
    createMenu(mainWindow);
}
// ============ IPC Handlers ============
// App info
ipcMain.handle('app:getVersion', () => app.getVersion());
ipcMain.handle('app:getName', () => app.getName());
ipcMain.handle('app:getPath', (_event, name) => {
    return app.getPath(name);
});
// Native dialogs
ipcMain.handle('dialog:showSave', async (_event, options) => {
    if (!mainWindow)
        return { canceled: true };
    return dialog.showSaveDialog(mainWindow, options);
});
ipcMain.handle('dialog:showOpen', async (_event, options) => {
    if (!mainWindow)
        return { canceled: true, filePaths: [] };
    return dialog.showOpenDialog(mainWindow, options);
});
// Window controls
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
        mainWindow.unmaximize();
    }
    else {
        mainWindow?.maximize();
    }
});
ipcMain.on('window:close', () => mainWindow?.close());
// Shell operations
ipcMain.on('shell:showItemInFolder', (_event, filePath) => {
    shell.showItemInFolder(filePath);
});
ipcMain.on('shell:openExternal', (_event, url) => {
    shell.openExternal(url);
});
// Project operations
ipcMain.on('project:opened', (_event, projectPath) => {
    addToRecentProjects(projectPath);
});
// ============ App Lifecycle ============
// macOS: re-create window when dock icon clicked
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
// Quit when all windows closed (except macOS)
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
// Clean shutdown
app.on('before-quit', async () => {
    console.log('Shutting down server...');
    await stopServer();
});
// ============ File Associations ============
// macOS: Handle file open from Finder
app.on('open-file', (event, filePath) => {
    event.preventDefault();
    if (filePath.endsWith('.cascade') || filePath.endsWith('.cascade.json')) {
        if (mainWindow) {
            // App already running, send to renderer
            mainWindow.webContents.send('file:open', filePath);
            mainWindow.focus();
        }
        else {
            // App not running yet, store for when window is ready
            pendingFilePath = filePath;
        }
    }
});
// Windows/Linux: Handle file open via command line args
function handleFileArg() {
    const filePath = process.argv.find(arg => arg.endsWith('.cascade') || arg.endsWith('.cascade.json'));
    if (filePath) {
        pendingFilePath = filePath;
    }
}
// ============ Deep Links (cascade://) ============
// Set as default protocol handler
if (process.defaultApp) {
    if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient('cascade', process.execPath, [path.resolve(process.argv[1])]);
    }
}
else {
    app.setAsDefaultProtocolClient('cascade');
}
// macOS: Handle protocol URL
app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
});
// Windows/Linux: Single instance handling for deep links
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
}
else {
    app.on('second-instance', (_event, commandLine) => {
        // Someone tried to run a second instance, focus our window
        if (mainWindow) {
            if (mainWindow.isMinimized())
                mainWindow.restore();
            mainWindow.focus();
        }
        // Handle deep link from command line
        const url = commandLine.find(arg => arg.startsWith('cascade://'));
        if (url) {
            handleDeepLink(url);
        }
    });
}
/**
 * Handle cascade:// deep links
 */
function handleDeepLink(url) {
    try {
        const parsed = new URL(url);
        switch (parsed.hostname) {
            case 'open':
                const projectPath = parsed.searchParams.get('path');
                const projectName = parsed.searchParams.get('project');
                if (projectPath) {
                    mainWindow?.webContents.send('deeplink:open', { path: projectPath });
                }
                else if (projectName) {
                    mainWindow?.webContents.send('deeplink:open', { name: projectName });
                }
                break;
            case 'new':
                const template = parsed.searchParams.get('template');
                mainWindow?.webContents.send('deeplink:new', { template });
                break;
            default:
                console.warn('Unknown deep link:', url);
        }
    }
    catch (err) {
        console.error('Failed to parse deep link:', url, err);
    }
}
// ============ Start the App ============
handleFileArg();
app.whenReady().then(createWindow);
