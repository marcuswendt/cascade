"use strict";
/**
 * Cascade Electron Main Process
 *
 * Entry point for the Electron application. Manages:
 * - Window creation and lifecycle
 * - Project folder management
 * - Native menu integration
 * - File associations and deep links
 * - Custom protocols for local assets
 * - Auto-updates
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const protocols_1 = require("./protocols");
const preferences_1 = require("./preferences");
const menu_1 = require("./menu");
const updater_1 = require("./updater");
// Set app name (for development mode - productName in electron-builder handles packaged app)
electron_1.app.setName('Cascade');
// Handle creating/removing shortcuts on Windows when installing/uninstalling
if (process.platform === 'win32') {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const squirrel = require('electron-squirrel-startup');
        if (squirrel)
            electron_1.app.quit();
    }
    catch {
        // Not installed, continue
    }
}
// ============ Global State ============
let mainWindow = null;
let currentProjectPath = null;
let currentGraphPath = null;
let isDocumentDirty = false;
const preferences = new preferences_1.PreferencesManager();
const isDev = process.env.NODE_ENV === 'development' || !electron_1.app.isPackaged;
const VITE_DEV_PORT = 5173;
// Store pending file path for when app launches via file association
let pendingFilePath = null;
/**
 * Format path for display, replacing home directory with ~
 */
function formatPathForDisplay(filePath) {
    const home = electron_1.app.getPath('home');
    if (filePath.startsWith(home)) {
        return '~' + filePath.slice(home.length);
    }
    return filePath;
}
/**
 * Update window title with current graph path
 */
function updateWindowTitle() {
    if (!mainWindow)
        return;
    const dirtyIndicator = isDocumentDirty ? ' *' : '';
    if (currentGraphPath) {
        const displayPath = formatPathForDisplay(currentGraphPath);
        mainWindow.setTitle(`${displayPath}${dirtyIndicator} — Cascade`);
        // macOS: Set represented file for proxy icon and dirty dot
        if (process.platform === 'darwin') {
            mainWindow.setRepresentedFilename(currentGraphPath);
            mainWindow.setDocumentEdited(isDocumentDirty);
        }
    }
    else if (currentProjectPath) {
        const projectName = path_1.default.basename(currentProjectPath);
        mainWindow.setTitle(`${projectName}${dirtyIndicator} — Cascade`);
    }
    else {
        mainWindow.setTitle('Cascade');
    }
}
/**
 * Set document dirty state and update window title
 */
function setDocumentDirty(dirty) {
    isDocumentDirty = dirty;
    updateWindowTitle();
}
// ============ Protocol Registration (before app ready) ============
(0, protocols_1.setupProtocols)();
// ============ Window Creation ============
/**
 * Create the main application window
 */
async function createWindow() {
    // Register protocol handlers now that app is ready
    (0, protocols_1.registerProtocolHandlers)();
    const windowBounds = preferences.getWindowBounds();
    mainWindow = new electron_1.BrowserWindow({
        ...windowBounds,
        minWidth: 800,
        minHeight: 600,
        // macOS-specific styling
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
        trafficLightPosition: { x: 16, y: 16 },
        vibrancy: process.platform === 'darwin' ? 'sidebar' : undefined,
        // Dark theme background to prevent flash
        backgroundColor: '#1a1a1a',
        webPreferences: {
            preload: path_1.default.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false, // Required for fs access in preload
        },
    });
    // Create native menu with recent folders, files and handlers
    const menuHandlers = {
        onNewProject: () => createNewProject(),
        onOpen: () => openGraphDialog(),
        onOpenFolder: () => openFolderDialog(),
        onOpenRecentFolder: (folderPath) => openProject(folderPath),
        onOpenRecentFile: (filePath) => handleFileOpen(filePath),
        onClearRecent: () => {
            preferences.clearAllRecent();
            if (mainWindow)
                (0, menu_1.updateRecentMenu)(mainWindow, [], []);
        },
    };
    (0, menu_1.createMenu)(mainWindow, preferences.getRecentFolders(), preferences.getRecentFiles(), menuHandlers);
    // Load the app
    if (isDev) {
        console.log(`Loading from Vite dev server: http://localhost:${VITE_DEV_PORT}`);
        mainWindow.loadURL(`http://localhost:${VITE_DEV_PORT}`);
        mainWindow.webContents.openDevTools();
    }
    else {
        const indexPath = path_1.default.join(__dirname, '../dist/index.html');
        console.log(`Loading from built files: ${indexPath}`);
        mainWindow.loadFile(indexPath);
    }
    // Inject local mode flag
    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow?.webContents.executeJavaScript(`
      window.__CASCADE_LOCAL__ = true;
    `);
        // Handle pending file open (from file association launch)
        if (pendingFilePath) {
            handleFileOpen(pendingFilePath);
            pendingFilePath = null;
        }
    });
    // Open external links in default browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http')) {
            electron_1.shell.openExternal(url);
        }
        return { action: 'deny' };
    });
    // Save window bounds on close
    mainWindow.on('close', () => {
        if (mainWindow) {
            preferences.setWindowBounds(mainWindow.getBounds());
        }
    });
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
    // Open project from args or last opened
    const startupArgs = getPathsFromArgs();
    const projectPath = startupArgs?.projectPath || preferences.getLastFolder();
    if (projectPath && fs_1.default.existsSync(projectPath)) {
        // Use specific graph from args, or find most recent
        let graphPath = startupArgs?.graphPath;
        if (!graphPath) {
            const cascadeFile = await findMostRecentCascadeFile(projectPath);
            if (cascadeFile) {
                graphPath = path_1.default.join(projectPath, cascadeFile);
            }
        }
        if (graphPath && fs_1.default.existsSync(graphPath)) {
            const graphSlug = path_1.default.basename(graphPath, '.cascade');
            await openProject(projectPath, graphPath);
            mainWindow?.webContents.send('open-graph', graphSlug);
        }
        else {
            await openProject(projectPath);
        }
    }
    // Setup auto-updater in production
    if (electron_1.app.isPackaged) {
        (0, updater_1.setupAutoUpdater)(mainWindow);
    }
}
/**
 * Get project and graph path from command line arguments
 */
function getPathsFromArgs() {
    const args = process.argv.slice(electron_1.app.isPackaged ? 1 : 2);
    if (args.length === 0)
        return null;
    let targetPath = args[0];
    // Handle "cascade ."
    if (targetPath === '.') {
        targetPath = process.cwd();
    }
    // Resolve to absolute path
    targetPath = path_1.default.resolve(targetPath);
    if (!fs_1.default.existsSync(targetPath)) {
        return null;
    }
    const stats = fs_1.default.statSync(targetPath);
    // If it's a .cascade file, return both project and graph path
    if (stats.isFile() && targetPath.endsWith('.cascade')) {
        const projectPath = findProjectRoot(targetPath);
        return { projectPath, graphPath: targetPath };
    }
    return stats.isDirectory() ? { projectPath: targetPath } : null;
}
/**
 * Open a project folder
 */
async function openProject(folderPath, graphPath) {
    currentProjectPath = folderPath;
    currentGraphPath = graphPath || null;
    preferences.addRecentFolder(folderPath);
    // Track recent file if a graph was opened
    if (graphPath) {
        preferences.addRecentFile(graphPath, folderPath);
    }
    // Update recent menu with both folders and files
    if (mainWindow) {
        (0, menu_1.updateRecentMenu)(mainWindow, preferences.getRecentFolders(), preferences.getRecentFiles());
    }
    // Add to system recent documents
    electron_1.app.addRecentDocument(folderPath);
    if (graphPath) {
        electron_1.app.addRecentDocument(graphPath);
    }
    // Tell renderer to open project
    mainWindow?.webContents.send('open-project', folderPath);
    // Reset dirty state and update window title
    isDocumentDirty = false;
    updateWindowTitle();
    console.log(`[Project] Opened: ${folderPath}`);
}
/**
 * Set the current graph path and update window title
 */
function setCurrentGraph(graphPath) {
    currentGraphPath = graphPath;
    // Track in recent files if we have a project
    if (currentProjectPath) {
        preferences.addRecentFile(graphPath, currentProjectPath);
        // Update recent menu
        if (mainWindow) {
            (0, menu_1.updateRecentMenu)(mainWindow, preferences.getRecentFolders(), preferences.getRecentFiles());
        }
    }
    updateWindowTitle();
}
/**
 * Handle opening a file (from file association or drag-drop)
 */
function handleFileOpen(filePath) {
    if (!fs_1.default.existsSync(filePath))
        return;
    const stats = fs_1.default.statSync(filePath);
    if (stats.isDirectory()) {
        openProject(filePath);
    }
    else if (filePath.endsWith('.cascade')) {
        // Open the project folder and navigate to the graph
        const projectPath = findProjectRoot(filePath);
        const graphSlug = path_1.default.basename(filePath, '.cascade');
        openProject(projectPath, filePath);
        mainWindow?.webContents.send('open-graph', graphSlug);
    }
}
/**
 * Find the most recently modified .cascade file in a folder
 */
async function findMostRecentCascadeFile(folderPath) {
    try {
        const files = await fs_1.default.promises.readdir(folderPath);
        const cascadeFiles = files.filter(f => f.endsWith('.cascade'));
        if (cascadeFiles.length === 0)
            return null;
        // Get stats for all cascade files and find the most recent
        const fileStats = await Promise.all(cascadeFiles.map(async (file) => {
            const filePath = path_1.default.join(folderPath, file);
            const stats = await fs_1.default.promises.stat(filePath);
            return { file, mtime: stats.mtimeMs };
        }));
        // Sort by modification time (most recent first)
        fileStats.sort((a, b) => b.mtime - a.mtime);
        return fileStats[0].file;
    }
    catch {
        return null;
    }
}
/**
 * Show folder picker and open selected folder
 */
async function openFolderDialog() {
    if (!mainWindow)
        return null;
    const result = await electron_1.dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory', 'createDirectory'],
        title: 'Open Project Folder',
    });
    if (!result.canceled && result.filePaths[0]) {
        const folderPath = result.filePaths[0];
        // Find most recently modified .cascade file in the folder
        const cascadeFile = await findMostRecentCascadeFile(folderPath);
        if (cascadeFile) {
            const graphPath = path_1.default.join(folderPath, cascadeFile);
            const graphSlug = path_1.default.basename(cascadeFile, '.cascade');
            await openProject(folderPath, graphPath);
            mainWindow?.webContents.send('open-graph', graphSlug);
        }
        else {
            await openProject(folderPath);
        }
        return folderPath;
    }
    return null;
}
/**
 * Find project root from a file path
 * Walks up the directory tree looking for a graphs/ folder or project.json
 */
function findProjectRoot(filePath) {
    let dir = path_1.default.dirname(filePath);
    // If the file is in a graphs/ folder, go up one level
    if (path_1.default.basename(dir) === 'graphs') {
        return path_1.default.dirname(dir);
    }
    // Walk up looking for project markers
    let current = dir;
    for (let i = 0; i < 5; i++) {
        // Check for graphs/ folder or project.json
        const graphsDir = path_1.default.join(current, 'graphs');
        const projectJson = path_1.default.join(current, 'project.json');
        if (fs_1.default.existsSync(graphsDir) || fs_1.default.existsSync(projectJson)) {
            return current;
        }
        const parent = path_1.default.dirname(current);
        if (parent === current)
            break; // Reached root
        current = parent;
    }
    // Fallback: use parent directory of the file
    return dir;
}
/**
 * Show file picker for .cascade files and open the project
 */
async function openGraphDialog() {
    if (!mainWindow)
        return null;
    const result = await electron_1.dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        title: 'Open Graph',
        filters: [
            { name: 'Cascade Graphs', extensions: ['cascade'] },
            { name: 'All Files', extensions: ['*'] },
        ],
    });
    if (!result.canceled && result.filePaths[0]) {
        const filePath = result.filePaths[0];
        const graphSlug = path_1.default.basename(filePath, '.cascade');
        const projectPath = findProjectRoot(filePath);
        await openProject(projectPath, filePath);
        mainWindow?.webContents.send('open-graph', graphSlug);
        return { projectPath, graphSlug };
    }
    return null;
}
/**
 * Create a new project with folder structure
 * User selects a folder, we create project structure inside it
 */
async function createNewProject() {
    if (!mainWindow)
        return null;
    // Ask user to select a project folder
    const result = await electron_1.dialog.showOpenDialog(mainWindow, {
        title: 'Select Project Folder',
        buttonLabel: 'Create Project',
        properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0])
        return null;
    const projectPath = result.filePaths[0];
    const projectName = path_1.default.basename(projectPath);
    try {
        // Check if this is already a project (has .cascade files)
        const existingFiles = fs_1.default.existsSync(projectPath)
            ? (await fs_1.default.promises.readdir(projectPath)).filter(f => f.endsWith('.cascade'))
            : [];
        if (existingFiles.length > 0) {
            // Already has cascade files, open the most recent one
            const cascadeFile = await findMostRecentCascadeFile(projectPath);
            if (cascadeFile) {
                const graphPath = path_1.default.join(projectPath, cascadeFile);
                const graphSlug = path_1.default.basename(cascadeFile, '.cascade');
                await openProject(projectPath, graphPath);
                mainWindow?.webContents.send('open-graph', graphSlug);
                return projectPath;
            }
        }
        // Create assets folder
        await fs_1.default.promises.mkdir(path_1.default.join(projectPath, 'assets'), { recursive: true });
        // Create project.json
        const projectMeta = {
            name: projectName,
            version: '1.0.0',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        await fs_1.default.promises.writeFile(path_1.default.join(projectPath, 'project.json'), JSON.stringify(projectMeta, null, 2));
        // Create initial cascade file with project name + version number
        const graphFileName = `${projectName}1.cascade`;
        const graphPath = path_1.default.join(projectPath, graphFileName);
        const initialGraph = {
            name: projectName,
            version: 1,
            nodes: [],
            connections: [],
            annotations: [],
            viewport: { x: 0, y: 0, zoom: 1 },
        };
        await fs_1.default.promises.writeFile(graphPath, JSON.stringify(initialGraph, null, 2));
        // Open the new project with the graph
        await openProject(projectPath, graphPath);
        mainWindow?.webContents.send('open-graph', `${projectName}1`);
        console.log(`[Project] Created new project: ${projectPath}`);
        return projectPath;
    }
    catch (err) {
        console.error('Failed to create project:', err);
        electron_1.dialog.showErrorBox('Error', `Failed to create project: ${err.message}`);
        return null;
    }
}
// ============ IPC Handlers ============
// App info
electron_1.ipcMain.handle('app:getVersion', () => electron_1.app.getVersion());
electron_1.ipcMain.handle('app:getName', () => electron_1.app.getName());
electron_1.ipcMain.handle('app:getPath', (_event, name) => {
    return electron_1.app.getPath(name);
});
// Project management
electron_1.ipcMain.handle('open-folder-dialog', openFolderDialog);
electron_1.ipcMain.handle('open-graph-dialog', openGraphDialog);
electron_1.ipcMain.handle('create-new-project', createNewProject);
electron_1.ipcMain.handle('get-current-project', () => currentProjectPath);
electron_1.ipcMain.handle('get-current-graph', () => currentGraphPath);
electron_1.ipcMain.handle('set-current-graph', (_event, graphPath) => {
    setCurrentGraph(graphPath);
});
electron_1.ipcMain.handle('set-document-dirty', (_event, dirty) => {
    setDocumentDirty(dirty);
});
electron_1.ipcMain.handle('get-recent-folders', () => preferences.getRecentFolders());
electron_1.ipcMain.handle('get-recent-files', () => preferences.getRecentFiles());
// Shell operations
electron_1.ipcMain.handle('reveal-in-finder', (_event, filePath) => {
    electron_1.shell.showItemInFolder(filePath);
});
electron_1.ipcMain.on('shell:showItemInFolder', (_event, filePath) => {
    electron_1.shell.showItemInFolder(filePath);
});
electron_1.ipcMain.on('shell:openExternal', (_event, url) => {
    electron_1.shell.openExternal(url);
});
// Preferences
electron_1.ipcMain.handle('get-preferences', () => preferences.getAll());
electron_1.ipcMain.handle('set-preference', (_event, key, value) => {
    preferences.set(key, value);
});
// Credentials
electron_1.ipcMain.handle('get-credentials', () => preferences.getCredentials());
electron_1.ipcMain.handle('set-credentials', (_event, credentials) => {
    preferences.setCredentials(credentials);
});
// Updates
electron_1.ipcMain.handle('check-for-updates', () => {
    (0, updater_1.checkForUpdates)();
});
// Native dialogs
electron_1.ipcMain.handle('dialog:showSave', async (_event, options) => {
    if (!mainWindow)
        return { canceled: true };
    return electron_1.dialog.showSaveDialog(mainWindow, options);
});
electron_1.ipcMain.handle('dialog:showOpen', async (_event, options) => {
    if (!mainWindow)
        return { canceled: true, filePaths: [] };
    return electron_1.dialog.showOpenDialog(mainWindow, options);
});
// Window controls
electron_1.ipcMain.on('window:minimize', () => mainWindow?.minimize());
electron_1.ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
        mainWindow.unmaximize();
    }
    else {
        mainWindow?.maximize();
    }
});
electron_1.ipcMain.on('window:close', () => mainWindow?.close());
// File system operations
electron_1.ipcMain.handle('fs:readFile', async (_event, filePath) => {
    try {
        return await fs_1.default.promises.readFile(filePath, 'utf-8');
    }
    catch (err) {
        throw new Error(err.message);
    }
});
electron_1.ipcMain.handle('fs:writeFile', async (_event, filePath, content) => {
    try {
        await fs_1.default.promises.writeFile(filePath, content, 'utf-8');
        return { success: true };
    }
    catch (err) {
        return { success: false, error: err.message };
    }
});
electron_1.ipcMain.handle('fs:readdir', async (_event, dirPath) => {
    try {
        const entries = await fs_1.default.promises.readdir(dirPath, { withFileTypes: true });
        return entries.map(e => ({
            name: e.name,
            isDirectory: () => e.isDirectory(),
            isFile: () => e.isFile(),
        }));
    }
    catch (err) {
        throw new Error(err.message);
    }
});
electron_1.ipcMain.handle('fs:mkdir', async (_event, dirPath) => {
    try {
        await fs_1.default.promises.mkdir(dirPath, { recursive: true });
        return { success: true };
    }
    catch (err) {
        return { success: false, error: err.message };
    }
});
electron_1.ipcMain.handle('fs:unlink', async (_event, filePath) => {
    try {
        await fs_1.default.promises.unlink(filePath);
        return { success: true };
    }
    catch (err) {
        return { success: false, error: err.message };
    }
});
electron_1.ipcMain.handle('fs:stat', async (_event, filePath) => {
    try {
        const stats = await fs_1.default.promises.stat(filePath);
        return {
            size: stats.size,
            mtime: stats.mtime.toISOString(),
            mtimeMs: stats.mtimeMs,
            isDirectory: stats.isDirectory(),
            isFile: stats.isFile(),
        };
    }
    catch (err) {
        throw new Error(err.message);
    }
});
electron_1.ipcMain.handle('fs:exists', async (_event, filePath) => {
    try {
        await fs_1.default.promises.access(filePath, fs_1.default.constants.F_OK);
        return true;
    }
    catch {
        return false;
    }
});
electron_1.ipcMain.handle('fs:fileExists', async (_event, filePath) => {
    try {
        await fs_1.default.promises.access(filePath, fs_1.default.constants.F_OK);
        return true;
    }
    catch {
        return false;
    }
});
// ============ App Lifecycle ============
// macOS: re-create window when dock icon clicked
electron_1.app.on('activate', () => {
    if (electron_1.BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
// Quit when all windows closed (except macOS)
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
// ============ File Associations ============
// macOS: Handle file/folder open from Finder
electron_1.app.on('open-file', (event, filePath) => {
    event.preventDefault();
    if (!fs_1.default.existsSync(filePath))
        return;
    if (mainWindow) {
        handleFileOpen(filePath);
        mainWindow.focus();
    }
    else {
        // App not running yet, store for when window is ready
        pendingFilePath = filePath;
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
        electron_1.app.setAsDefaultProtocolClient('cascade', process.execPath, [path_1.default.resolve(process.argv[1])]);
    }
}
else {
    electron_1.app.setAsDefaultProtocolClient('cascade');
}
// macOS: Handle protocol URL
electron_1.app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
});
// Windows/Linux: Single instance handling for deep links
const gotTheLock = electron_1.app.requestSingleInstanceLock();
if (!gotTheLock) {
    electron_1.app.quit();
}
else {
    electron_1.app.on('second-instance', (_event, commandLine) => {
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
                    openProject(projectPath);
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
electron_1.app.whenReady().then(createWindow);
