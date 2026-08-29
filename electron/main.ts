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

import { app, BrowserWindow, shell, ipcMain, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import { setupProtocols, registerProtocolHandlers } from './protocols';
import { PreferencesManager } from './preferences';
import { createMenu, updateRecentMenu, type MenuHandlers } from './menu';
import { setupAutoUpdater, checkForUpdates } from './updater';

// Set app name (for development mode - productName in electron-builder handles packaged app)
app.setName('Cascade');

// Handle creating/removing shortcuts on Windows when installing/uninstalling
if (process.platform === 'win32') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const squirrel = require('electron-squirrel-startup');
    if (squirrel) app.quit();
  } catch {
    // Not installed, continue
  }
}

// ============ Global State ============

let mainWindow: BrowserWindow | null = null;
let currentProjectPath: string | null = null;
let currentGraphPath: string | null = null;
let isDocumentDirty: boolean = false;
const preferences = new PreferencesManager();

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const VITE_DEV_PORT = 5173;

// Store pending file path for when app launches via file association
let pendingFilePath: string | null = null;

/**
 * Format path for display, replacing home directory with ~
 */
function formatPathForDisplay(filePath: string): string {
  const home = app.getPath('home');
  if (filePath.startsWith(home)) {
    return '~' + filePath.slice(home.length);
  }
  return filePath;
}

/**
 * Update window title with current graph path
 */
function updateWindowTitle(): void {
  if (!mainWindow) return;

  const dirtyIndicator = isDocumentDirty ? ' *' : '';

  if (currentGraphPath) {
    const displayPath = formatPathForDisplay(currentGraphPath);
    mainWindow.setTitle(`${displayPath}${dirtyIndicator} — Cascade`);

    // macOS: Set represented file for proxy icon and dirty dot
    if (process.platform === 'darwin') {
      mainWindow.setRepresentedFilename(currentGraphPath);
      mainWindow.setDocumentEdited(isDocumentDirty);
    }
  } else if (currentProjectPath) {
    const projectName = path.basename(currentProjectPath);
    mainWindow.setTitle(`${projectName}${dirtyIndicator} — Cascade`);
  } else {
    mainWindow.setTitle('Cascade');
  }
}

/**
 * Set document dirty state and update window title
 */
function setDocumentDirty(dirty: boolean): void {
  isDocumentDirty = dirty;
  updateWindowTitle();
}

// ============ Protocol Registration (before app ready) ============

setupProtocols();

// ============ Window Creation ============

/**
 * Create the main application window
 */
async function createWindow(): Promise<void> {
  // Register protocol handlers now that app is ready
  registerProtocolHandlers();

  const windowBounds = preferences.getWindowBounds();

  mainWindow = new BrowserWindow({
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
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Required for fs access in preload
    },
  });

  // Create native menu with recent folders, files and handlers
  const menuHandlers: MenuHandlers = {
    onNewProject: () => createNewProject(),
    onOpen: () => openGraphDialog(),
    onOpenFolder: () => openFolderDialog(),
    onOpenRecentFolder: (folderPath) => openProject(folderPath),
    onOpenRecentFile: (filePath) => handleFileOpen(filePath),
    onClearRecent: () => {
      preferences.clearAllRecent();
      if (mainWindow) updateRecentMenu(mainWindow, [], []);
    },
  };
  createMenu(mainWindow, preferences.getRecentFolders(), preferences.getRecentFiles(), menuHandlers);

  // Load the app
  if (isDev) {
    console.log(`Loading from Vite dev server: http://localhost:${VITE_DEV_PORT}`);
    mainWindow.loadURL(`http://localhost:${VITE_DEV_PORT}`);
    mainWindow.webContents.openDevTools();
  } else {
    const indexPath = path.join(__dirname, '../dist/index.html');
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
      shell.openExternal(url);
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

  if (projectPath && fs.existsSync(projectPath)) {
    // Use specific graph from args, or find most recent
    let graphPath = startupArgs?.graphPath;
    if (!graphPath) {
      const cascadeFile = await findMostRecentCascadeFile(projectPath);
      if (cascadeFile) {
        graphPath = path.join(projectPath, cascadeFile);
      }
    }

    if (graphPath && fs.existsSync(graphPath)) {
      const graphSlug = path.basename(graphPath, '.cascade');
      await openProject(projectPath, graphPath);
      mainWindow?.webContents.send('open-graph', graphSlug);
    } else {
      await openProject(projectPath);
    }
  }

  // Setup auto-updater in production
  if (app.isPackaged) {
    setupAutoUpdater(mainWindow);
  }
}

// ============ Project Management ============

interface StartupArgs {
  projectPath: string;
  graphPath?: string;
}

/**
 * Get project and graph path from command line arguments
 */
function getPathsFromArgs(): StartupArgs | null {
  const args = process.argv.slice(app.isPackaged ? 1 : 2);
  if (args.length === 0) return null;

  let targetPath = args[0];

  // Handle "cascade ."
  if (targetPath === '.') {
    targetPath = process.cwd();
  }

  // Resolve to absolute path
  targetPath = path.resolve(targetPath);

  if (!fs.existsSync(targetPath)) {
    return null;
  }

  const stats = fs.statSync(targetPath);

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
async function openProject(folderPath: string, graphPath?: string): Promise<void> {
  currentProjectPath = folderPath;
  currentGraphPath = graphPath || null;
  preferences.addRecentFolder(folderPath);

  // Track recent file if a graph was opened
  if (graphPath) {
    preferences.addRecentFile(graphPath, folderPath);
  }

  // Update recent menu with both folders and files
  if (mainWindow) {
    updateRecentMenu(mainWindow, preferences.getRecentFolders(), preferences.getRecentFiles());
  }

  // Add to system recent documents
  app.addRecentDocument(folderPath);
  if (graphPath) {
    app.addRecentDocument(graphPath);
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
function setCurrentGraph(graphPath: string): void {
  currentGraphPath = graphPath;

  // Track in recent files if we have a project
  if (currentProjectPath) {
    preferences.addRecentFile(graphPath, currentProjectPath);
    // Update recent menu
    if (mainWindow) {
      updateRecentMenu(mainWindow, preferences.getRecentFolders(), preferences.getRecentFiles());
    }
  }

  updateWindowTitle();
}

/**
 * Handle opening a file (from file association or drag-drop)
 */
function handleFileOpen(filePath: string): void {
  if (!fs.existsSync(filePath)) return;

  const stats = fs.statSync(filePath);

  if (stats.isDirectory()) {
    openProject(filePath);
  } else if (filePath.endsWith('.cascade')) {
    // Open the project folder and navigate to the graph
    const projectPath = findProjectRoot(filePath);
    const graphSlug = path.basename(filePath, '.cascade');

    openProject(projectPath, filePath);
    mainWindow?.webContents.send('open-graph', graphSlug);
  }
}

/**
 * Find the most recently modified .cascade file in a folder
 */
async function findMostRecentCascadeFile(folderPath: string): Promise<string | null> {
  try {
    const files = await fs.promises.readdir(folderPath);
    const cascadeFiles = files.filter(f => f.endsWith('.cascade'));

    if (cascadeFiles.length === 0) return null;

    // Get stats for all cascade files and find the most recent
    const fileStats = await Promise.all(
      cascadeFiles.map(async file => {
        const filePath = path.join(folderPath, file);
        const stats = await fs.promises.stat(filePath);
        return { file, mtime: stats.mtimeMs };
      })
    );

    // Sort by modification time (most recent first)
    fileStats.sort((a, b) => b.mtime - a.mtime);

    return fileStats[0].file;
  } catch {
    return null;
  }
}

/**
 * Show folder picker and open selected folder
 */
async function openFolderDialog(): Promise<string | null> {
  if (!mainWindow) return null;

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Open Project Folder',
  });

  if (!result.canceled && result.filePaths[0]) {
    const folderPath = result.filePaths[0];

    // Find most recently modified .cascade file in the folder
    const cascadeFile = await findMostRecentCascadeFile(folderPath);

    if (cascadeFile) {
      const graphPath = path.join(folderPath, cascadeFile);
      const graphSlug = path.basename(cascadeFile, '.cascade');
      await openProject(folderPath, graphPath);
      mainWindow?.webContents.send('open-graph', graphSlug);
    } else {
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
function findProjectRoot(filePath: string): string {
  let dir = path.dirname(filePath);

  // If the file is in a graphs/ folder, go up one level
  if (path.basename(dir) === 'graphs') {
    return path.dirname(dir);
  }

  // Walk up looking for project markers
  let current = dir;
  for (let i = 0; i < 5; i++) {
    // Check for graphs/ folder or project.json
    const graphsDir = path.join(current, 'graphs');
    const projectJson = path.join(current, 'project.json');

    if (fs.existsSync(graphsDir) || fs.existsSync(projectJson)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) break; // Reached root
    current = parent;
  }

  // Fallback: use parent directory of the file
  return dir;
}

/**
 * Show file picker for .cascade files and open the project
 */
async function openGraphDialog(): Promise<{ projectPath: string; graphSlug: string } | null> {
  if (!mainWindow) return null;

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Open Graph',
    filters: [
      { name: 'Cascade Graphs', extensions: ['cascade'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (!result.canceled && result.filePaths[0]) {
    const filePath = result.filePaths[0];
    const graphSlug = path.basename(filePath, '.cascade');
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
async function createNewProject(): Promise<string | null> {
  if (!mainWindow) return null;

  // Ask user to select a project folder
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Project Folder',
    buttonLabel: 'Create Project',
    properties: ['openDirectory', 'createDirectory'],
  });

  if (result.canceled || !result.filePaths[0]) return null;

  const projectPath = result.filePaths[0];
  const projectName = path.basename(projectPath);

  try {
    // Check if this is already a project (has .cascade files)
    const existingFiles = fs.existsSync(projectPath)
      ? (await fs.promises.readdir(projectPath)).filter(f => f.endsWith('.cascade'))
      : [];

    if (existingFiles.length > 0) {
      // Already has cascade files, open the most recent one
      const cascadeFile = await findMostRecentCascadeFile(projectPath);
      if (cascadeFile) {
        const graphPath = path.join(projectPath, cascadeFile);
        const graphSlug = path.basename(cascadeFile, '.cascade');
        await openProject(projectPath, graphPath);
        mainWindow?.webContents.send('open-graph', graphSlug);
        return projectPath;
      }
    }

    // Create assets folder
    await fs.promises.mkdir(path.join(projectPath, 'assets'), { recursive: true });

    // Create project.json
    const projectMeta = {
      name: projectName,
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await fs.promises.writeFile(
      path.join(projectPath, 'project.json'),
      JSON.stringify(projectMeta, null, 2)
    );

    // Create initial cascade file with project name + version number
    const graphFileName = `${projectName}1.cascade`;
    const graphPath = path.join(projectPath, graphFileName);
    const initialGraph = {
      name: projectName,
      version: 1,
      nodes: [],
      connections: [],
      annotations: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    await fs.promises.writeFile(graphPath, JSON.stringify(initialGraph, null, 2));

    // Open the new project with the graph
    await openProject(projectPath, graphPath);
    mainWindow?.webContents.send('open-graph', `${projectName}1`);

    console.log(`[Project] Created new project: ${projectPath}`);
    return projectPath;
  } catch (err) {
    console.error('Failed to create project:', err);
    dialog.showErrorBox('Error', `Failed to create project: ${(err as Error).message}`);
    return null;
  }
}

// ============ IPC Handlers ============

// App info
ipcMain.handle('app:getVersion', () => app.getVersion());
ipcMain.handle('app:getName', () => app.getName());
ipcMain.handle('app:getPath', (_event, name: string) => {
  return app.getPath(name as any);
});

// Project management
ipcMain.handle('open-folder-dialog', openFolderDialog);
ipcMain.handle('open-graph-dialog', openGraphDialog);
ipcMain.handle('create-new-project', createNewProject);
ipcMain.handle('get-current-project', () => currentProjectPath);
ipcMain.handle('get-current-graph', () => currentGraphPath);
ipcMain.handle('set-current-graph', (_event, graphPath: string) => {
  setCurrentGraph(graphPath);
});
ipcMain.handle('set-document-dirty', (_event, dirty: boolean) => {
  setDocumentDirty(dirty);
});
ipcMain.handle('get-recent-folders', () => preferences.getRecentFolders());
ipcMain.handle('get-recent-files', () => preferences.getRecentFiles());

// Shell operations
ipcMain.handle('reveal-in-finder', (_event, filePath: string) => {
  shell.showItemInFolder(filePath);
});
ipcMain.on('shell:showItemInFolder', (_event, filePath: string) => {
  shell.showItemInFolder(filePath);
});
ipcMain.on('shell:openExternal', (_event, url: string) => {
  shell.openExternal(url);
});

// Preferences
ipcMain.handle('get-preferences', () => preferences.getAll());
ipcMain.handle('set-preference', (_event, key: string, value: any) => {
  preferences.set(key, value);
});

// Credentials
ipcMain.handle('get-credentials', () => preferences.getCredentials());
ipcMain.handle('set-credentials', (_event, credentials: any) => {
  preferences.setCredentials(credentials);
});

// Updates
ipcMain.handle('check-for-updates', () => {
  checkForUpdates();
});

// Native dialogs
ipcMain.handle('dialog:showSave', async (_event, options: Electron.SaveDialogOptions) => {
  if (!mainWindow) return { canceled: true };
  return dialog.showSaveDialog(mainWindow, options);
});

ipcMain.handle('dialog:showOpen', async (_event, options: Electron.OpenDialogOptions) => {
  if (!mainWindow) return { canceled: true, filePaths: [] };
  return dialog.showOpenDialog(mainWindow, options);
});

// Window controls
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.on('window:close', () => mainWindow?.close());

// File system operations
ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
  try {
    return await fs.promises.readFile(filePath, 'utf-8');
  } catch (err) {
    throw new Error((err as Error).message);
  }
});

ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
  try {
    await fs.promises.writeFile(filePath, content, 'utf-8');
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});

ipcMain.handle('fs:readdir', async (_event, dirPath: string) => {
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    return entries.map(e => ({
      name: e.name,
      isDirectory: () => e.isDirectory(),
      isFile: () => e.isFile(),
    }));
  } catch (err) {
    throw new Error((err as Error).message);
  }
});

ipcMain.handle('fs:mkdir', async (_event, dirPath: string) => {
  try {
    await fs.promises.mkdir(dirPath, { recursive: true });
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});

ipcMain.handle('fs:unlink', async (_event, filePath: string) => {
  try {
    await fs.promises.unlink(filePath);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});

ipcMain.handle('fs:stat', async (_event, filePath: string) => {
  try {
    const stats = await fs.promises.stat(filePath);
    return {
      size: stats.size,
      mtime: stats.mtime.toISOString(),
      mtimeMs: stats.mtimeMs,
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
    };
  } catch (err) {
    throw new Error((err as Error).message);
  }
});

ipcMain.handle('fs:exists', async (_event, filePath: string) => {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('fs:fileExists', async (_event, filePath: string) => {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
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

// ============ File Associations ============

// macOS: Handle file/folder open from Finder
app.on('open-file', (event, filePath) => {
  event.preventDefault();

  if (!fs.existsSync(filePath)) return;

  if (mainWindow) {
    handleFileOpen(filePath);
    mainWindow.focus();
  } else {
    // App not running yet, store for when window is ready
    pendingFilePath = filePath;
  }
});

// Windows/Linux: Handle file open via command line args
function handleFileArg(): void {
  const filePath = process.argv.find(
    arg => arg.endsWith('.cascade') || arg.endsWith('.cascade.json')
  );
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
} else {
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
} else {
  app.on('second-instance', (_event, commandLine) => {
    // Someone tried to run a second instance, focus our window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
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
function handleDeepLink(url: string): void {
  try {
    const parsed = new URL(url);

    switch (parsed.hostname) {
      case 'open':
        const projectPath = parsed.searchParams.get('path');
        const projectName = parsed.searchParams.get('project');

        if (projectPath) {
          openProject(projectPath);
        } else if (projectName) {
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
  } catch (err) {
    console.error('Failed to parse deep link:', url, err);
  }
}

// ============ Start the App ============

handleFileArg();
app.whenReady().then(createWindow);
