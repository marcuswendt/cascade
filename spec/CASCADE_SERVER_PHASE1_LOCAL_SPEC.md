# Cascade Local: Electron Desktop App

## Overview

Build a standalone Electron desktop app for Cascade that works entirely offline with local filesystem storage. Users open any folder as a project and work without needing an account or internet connection.

**Goal:** Ship a working local-first Cascade app that can be used immediately.

---

## Core Concept

**Project = Folder**

Any folder on your computer can be a Cascade project:

```bash
# Open current directory
cascade .

# Open specific folder
cascade ~/Projects/generative-art

# Double-click a .cascade file
# → Opens containing project folder in Cascade
```

No accounts, no cloud, no internet required.

---

## Project Folder Structure

```
my-project/                        # Any folder on your computer
├── project.json                   # Project metadata (optional, auto-generated)
├── graphs/
│   ├── main.cascade               # Graph files (JSON)
│   ├── experiments.cascade
│   └── components.cascade
└── assets/
    ├── images/
    │   └── texture.png
    ├── fonts/
    │   └── custom.woff2
    └── data/
        └── config.json
```

### project.json (Optional)

Auto-generated from folder name if not present:

```json
{
  "name": "My Project",
  "description": "Generative art experiments",
  "createdAt": "2025-12-20T10:00:00Z",
  "updatedAt": "2025-12-20T15:30:00Z"
}
```

### Graph Files (*.cascade)

Standard JSON format:

```json
{
  "name": "Main Graph",
  "nodes": [...],
  "connections": [...],
  "annotations": [...],
  "viewport": { "x": 0, "y": 0, "zoom": 1 }
}
```

---

## Global App Preferences

User preferences stored separately from projects:

```
~/.cascade/
├── preferences.json               # App settings
├── recent.json                    # Recently opened folders
└── credentials.yaml               # AI API keys (never in projects!)
```

### preferences.json

```json
{
  "theme": "dark",
  "autoSave": true,
  "autoSaveDelay": 2000,
  "editor": {
    "fontSize": 14,
    "tabSize": 2,
    "wordWrap": true
  },
  "window": {
    "width": 1400,
    "height": 900,
    "x": 100,
    "y": 100
  }
}
```

### recent.json

```json
{
  "folders": [
    { "path": "/Users/marcus/Projects/generative-art", "lastOpened": "2025-12-20T15:30:00Z" },
    { "path": "/Users/marcus/Projects/client-work", "lastOpened": "2025-12-19T10:00:00Z" }
  ]
}
```

### credentials.yaml

```yaml
# AI API keys - stored globally, never in project folders
anthropic:
  apiKey: sk-ant-...
openai:
  apiKey: sk-...
google:
  apiKey: AIza...
```

---

## Architecture

### Storage Adapter Interface

Abstract storage so the same editor works locally and (later) in cloud:

```typescript
// src/lib/storage/types.ts

export interface Project {
  name: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Graph {
  slug: string;
  name: string;
  content: GraphContent;
  updatedAt: Date;
}

export interface Asset {
  filename: string;
  path: string;
  mimeType: string;
  sizeBytes: number;
}

export interface StorageAdapter {
  // Project root path
  readonly projectRoot: string;
  
  // Project metadata
  getProject(): Promise<Project>;
  updateProject(data: Partial<Project>): Promise<Project>;
  
  // Graphs
  listGraphs(): Promise<Graph[]>;
  getGraph(slug: string): Promise<Graph | null>;
  saveGraph(slug: string, content: GraphContent): Promise<Graph>;
  createGraph(name: string): Promise<Graph>;
  deleteGraph(slug: string): Promise<void>;
  renameGraph(slug: string, newName: string): Promise<Graph>;
  
  // Assets
  listAssets(): Promise<Asset[]>;
  getAssetUrl(path: string): string;
  importAsset(file: File, targetPath?: string): Promise<Asset>;
  deleteAsset(path: string): Promise<void>;
}
```

### Local Storage Adapter

```typescript
// src/lib/storage/local-adapter.ts
import path from 'path';
import fs from 'fs/promises';

export class LocalStorageAdapter implements StorageAdapter {
  constructor(private folderPath: string) {}
  
  get projectRoot(): string {
    return this.folderPath;
  }
  
  async getProject(): Promise<Project> {
    const metaPath = path.join(this.folderPath, 'project.json');
    
    try {
      const content = await fs.readFile(metaPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      // Auto-generate from folder name
      return {
        name: path.basename(this.folderPath),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }
  }
  
  async updateProject(data: Partial<Project>): Promise<Project> {
    const current = await this.getProject();
    const updated = { ...current, ...data, updatedAt: new Date() };
    
    const metaPath = path.join(this.folderPath, 'project.json');
    await fs.writeFile(metaPath, JSON.stringify(updated, null, 2));
    
    return updated;
  }
  
  async listGraphs(): Promise<Graph[]> {
    const graphsDir = path.join(this.folderPath, 'graphs');
    
    try {
      const files = await fs.readdir(graphsDir);
      const graphs = await Promise.all(
        files
          .filter(f => f.endsWith('.cascade'))
          .map(f => this.getGraph(f.replace('.cascade', '')))
      );
      return graphs.filter((g): g is Graph => g !== null);
    } catch {
      return [];
    }
  }
  
  async getGraph(slug: string): Promise<Graph | null> {
    const graphPath = path.join(this.folderPath, 'graphs', `${slug}.cascade`);
    
    try {
      const content = await fs.readFile(graphPath, 'utf-8');
      const parsed = JSON.parse(content);
      const stats = await fs.stat(graphPath);
      
      return {
        slug,
        name: parsed.name || slug,
        content: parsed,
        updatedAt: stats.mtime,
      };
    } catch {
      return null;
    }
  }
  
  async saveGraph(slug: string, content: GraphContent): Promise<Graph> {
    const graphsDir = path.join(this.folderPath, 'graphs');
    await fs.mkdir(graphsDir, { recursive: true });
    
    const graphPath = path.join(graphsDir, `${slug}.cascade`);
    await fs.writeFile(graphPath, JSON.stringify(content, null, 2));
    
    return {
      slug,
      name: content.name || slug,
      content,
      updatedAt: new Date(),
    };
  }
  
  async createGraph(name: string): Promise<Graph> {
    const slug = this.slugify(name);
    const content: GraphContent = {
      name,
      nodes: [],
      connections: [],
      annotations: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    
    return this.saveGraph(slug, content);
  }
  
  async deleteGraph(slug: string): Promise<void> {
    const graphPath = path.join(this.folderPath, 'graphs', `${slug}.cascade`);
    await fs.unlink(graphPath);
  }
  
  async renameGraph(slug: string, newName: string): Promise<Graph> {
    const graph = await this.getGraph(slug);
    if (!graph) throw new Error(`Graph "${slug}" not found`);
    
    const newSlug = this.slugify(newName);
    const newContent = { ...graph.content, name: newName };
    
    // Save with new name
    await this.saveGraph(newSlug, newContent);
    
    // Delete old file if slug changed
    if (newSlug !== slug) {
      await this.deleteGraph(slug);
    }
    
    return { ...graph, slug: newSlug, name: newName, content: newContent };
  }
  
  async listAssets(): Promise<Asset[]> {
    const assetsDir = path.join(this.folderPath, 'assets');
    const assets: Asset[] = [];
    
    async function walk(dir: string, prefix: string = '') {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
          
          if (entry.isDirectory()) {
            await walk(path.join(dir, entry.name), relativePath);
          } else {
            const stats = await fs.stat(path.join(dir, entry.name));
            assets.push({
              filename: entry.name,
              path: `assets/${relativePath}`,
              mimeType: getMimeType(entry.name),
              sizeBytes: stats.size,
            });
          }
        }
      } catch {
        // Directory doesn't exist
      }
    }
    
    await walk(assetsDir);
    return assets;
  }
  
  getAssetUrl(assetPath: string): string {
    // Custom protocol registered by Electron
    return `cascade-asset://${encodeURIComponent(this.folderPath)}/${assetPath}`;
  }
  
  async importAsset(file: File, targetPath?: string): Promise<Asset> {
    const filename = targetPath || file.name;
    const fullPath = path.join(this.folderPath, 'assets', filename);
    
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, Buffer.from(await file.arrayBuffer()));
    
    return {
      filename: path.basename(filename),
      path: `assets/${filename}`,
      mimeType: file.type,
      sizeBytes: file.size,
    };
  }
  
  async deleteAsset(assetPath: string): Promise<void> {
    const fullPath = path.join(this.folderPath, assetPath);
    await fs.unlink(fullPath);
  }
  
  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50) || 'untitled';
  }
}

function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.json': 'application/json',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}
```

---

## Electron App Structure

```
cascade/
├── electron/
│   ├── main.ts                    # Main process
│   ├── preload.ts                 # IPC bridge
│   ├── menu.ts                    # Native menu
│   ├── protocols.ts               # Custom URL protocols
│   ├── preferences.ts             # Global preferences
│   └── updater.ts                 # Auto-update
├── src/
│   ├── lib/
│   │   ├── storage/
│   │   │   ├── types.ts           # StorageAdapter interface
│   │   │   ├── local-adapter.ts   # Filesystem implementation
│   │   │   └── index.ts           # Adapter selection
│   │   ├── editor/                # Editor components
│   │   ├── nodes/                 # Node system
│   │   └── engine/                # Execution engine
│   └── routes/
│       ├── +layout.svelte         # App shell
│       └── +page.svelte           # Main editor view
├── static/
├── build/                         # Icons, entitlements
├── electron-builder.yml
├── svelte.config.js
├── vite.config.ts
└── package.json
```

---

## Main Process

```typescript
// electron/main.ts
import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { setupProtocols } from './protocols';
import { PreferencesManager } from './preferences';
import { createMenu, updateRecentMenu } from './menu';
import { setupAutoUpdater } from './updater';

let mainWindow: BrowserWindow | null = null;
let currentProjectPath: string | null = null;

const preferences = new PreferencesManager();

async function createWindow() {
  // Register custom protocols before creating window
  setupProtocols();
  
  const windowBounds = preferences.get('window', {
    width: 1400,
    height: 900,
  });
  
  mainWindow = new BrowserWindow({
    ...windowBounds,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Required for fs access in preload
    },
  });
  
  // Create native menu
  createMenu(mainWindow, preferences.getRecentFolders());
  
  // Load app
  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '../build/index.html'));
  } else {
    mainWindow.loadURL('http://localhost:5173');
  }
  
  // Inject local mode flag
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.executeJavaScript(`
      window.__CASCADE_LOCAL__ = true;
    `);
  });
  
  // Save window bounds on close
  mainWindow.on('close', () => {
    if (mainWindow) {
      preferences.set('window', mainWindow.getBounds());
    }
  });
  
  // Open project from args or last opened
  const projectPath = getProjectPathFromArgs() || preferences.getLastFolder();
  if (projectPath && fs.existsSync(projectPath)) {
    openProject(projectPath);
  }
  
  // Setup auto-updater in production
  if (app.isPackaged) {
    setupAutoUpdater(mainWindow);
  }
}

function getProjectPathFromArgs(): string | null {
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
  
  // If it's a .cascade file, open the project folder
  if (stats.isFile() && targetPath.endsWith('.cascade')) {
    // Go up from graphs/ to project root
    return path.dirname(path.dirname(targetPath));
  }
  
  return stats.isDirectory() ? targetPath : null;
}

async function openProject(folderPath: string) {
  currentProjectPath = folderPath;
  preferences.addRecentFolder(folderPath);
  
  // Update window title
  const projectName = path.basename(folderPath);
  mainWindow?.setTitle(`${projectName} — Cascade`);
  mainWindow?.setRepresentedFilename(folderPath);
  
  // Update recent menu
  updateRecentMenu(mainWindow!, preferences.getRecentFolders());
  
  // Add to system recent documents
  app.addRecentDocument(folderPath);
  
  // Tell renderer to open project
  mainWindow?.webContents.send('open-project', folderPath);
}

async function openFolder() {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Open Project Folder',
  });
  
  if (!result.canceled && result.filePaths[0]) {
    await openProject(result.filePaths[0]);
    return result.filePaths[0];
  }
  return null;
}

// IPC Handlers
ipcMain.handle('open-folder-dialog', openFolder);
ipcMain.handle('get-current-project', () => currentProjectPath);
ipcMain.handle('get-recent-folders', () => preferences.getRecentFolders());

ipcMain.handle('reveal-in-finder', (_, filePath: string) => {
  shell.showItemInFolder(filePath);
});

ipcMain.handle('get-preferences', () => preferences.getAll());
ipcMain.handle('set-preference', (_, key: string, value: any) => {
  preferences.set(key, value);
});

ipcMain.handle('get-credentials', () => preferences.getCredentials());
ipcMain.handle('set-credentials', (_, credentials: any) => {
  preferences.setCredentials(credentials);
});

// App lifecycle
app.whenReady().then(createWindow);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Handle file/folder opening via Finder (macOS)
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  
  if (!fs.existsSync(filePath)) return;
  
  const stats = fs.statSync(filePath);
  
  if (stats.isDirectory()) {
    if (mainWindow) {
      openProject(filePath);
    } else {
      // App not ready yet, store for later
      app.whenReady().then(() => openProject(filePath));
    }
  } else if (filePath.endsWith('.cascade')) {
    const projectPath = path.dirname(path.dirname(filePath));
    const graphSlug = path.basename(filePath, '.cascade');
    
    if (mainWindow) {
      openProject(projectPath);
      mainWindow.webContents.send('open-graph', graphSlug);
    }
  }
});
```

---

## Preload Script

```typescript
// electron/preload.ts
import { contextBridge, ipcRenderer } from 'electron';
import fs from 'fs/promises';
import path from 'path';

// Expose safe APIs to renderer
contextBridge.exposeInMainWorld('cascadeElectron', {
  // Project management
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
  getCurrentProject: () => ipcRenderer.invoke('get-current-project'),
  getRecentFolders: () => ipcRenderer.invoke('get-recent-folders'),
  revealInFinder: (filePath: string) => ipcRenderer.invoke('reveal-in-finder', filePath),
  
  // Preferences
  getPreferences: () => ipcRenderer.invoke('get-preferences'),
  setPreference: (key: string, value: any) => ipcRenderer.invoke('set-preference', key, value),
  getCredentials: () => ipcRenderer.invoke('get-credentials'),
  setCredentials: (credentials: any) => ipcRenderer.invoke('set-credentials', credentials),
  
  // Updates
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  
  // File system (for storage adapter)
  fs: {
    readFile: (filePath: string) => fs.readFile(filePath, 'utf-8'),
    writeFile: (filePath: string, content: string) => fs.writeFile(filePath, content),
    readdir: (dirPath: string) => fs.readdir(dirPath, { withFileTypes: true }),
    mkdir: (dirPath: string) => fs.mkdir(dirPath, { recursive: true }),
    unlink: (filePath: string) => fs.unlink(filePath),
    stat: (filePath: string) => fs.stat(filePath),
    exists: async (filePath: string) => {
      try {
        await fs.access(filePath);
        return true;
      } catch {
        return false;
      }
    },
  },
  
  path: {
    join: (...args: string[]) => path.join(...args),
    dirname: (p: string) => path.dirname(p),
    basename: (p: string, ext?: string) => path.basename(p, ext),
    extname: (p: string) => path.extname(p),
  },
  
  // Events from main process
  onOpenProject: (callback: (path: string) => void) => {
    ipcRenderer.on('open-project', (_, path) => callback(path));
    return () => ipcRenderer.removeAllListeners('open-project');
  },
  onOpenGraph: (callback: (slug: string) => void) => {
    ipcRenderer.on('open-graph', (_, slug) => callback(slug));
    return () => ipcRenderer.removeAllListeners('open-graph');
  },
  onMenuAction: (callback: (action: string) => void) => {
    ipcRenderer.on('menu-action', (_, action) => callback(action));
    return () => ipcRenderer.removeAllListeners('menu-action');
  },
  onUpdateStatus: (callback: (status: any) => void) => {
    ipcRenderer.on('update-status', (_, status) => callback(status));
    return () => ipcRenderer.removeAllListeners('update-status');
  },
});

// Type definitions for renderer
declare global {
  interface Window {
    __CASCADE_LOCAL__?: boolean;
    cascadeElectron: {
      openFolderDialog: () => Promise<string | null>;
      getCurrentProject: () => Promise<string | null>;
      getRecentFolders: () => Promise<string[]>;
      revealInFinder: (path: string) => Promise<void>;
      getPreferences: () => Promise<any>;
      setPreference: (key: string, value: any) => Promise<void>;
      getCredentials: () => Promise<any>;
      setCredentials: (credentials: any) => Promise<void>;
      checkForUpdates: () => Promise<void>;
      fs: {
        readFile: (path: string) => Promise<string>;
        writeFile: (path: string, content: string) => Promise<void>;
        readdir: (path: string) => Promise<any[]>;
        mkdir: (path: string) => Promise<void>;
        unlink: (path: string) => Promise<void>;
        stat: (path: string) => Promise<any>;
        exists: (path: string) => Promise<boolean>;
      };
      path: {
        join: (...args: string[]) => string;
        dirname: (p: string) => string;
        basename: (p: string, ext?: string) => string;
        extname: (p: string) => string;
      };
      onOpenProject: (callback: (path: string) => void) => () => void;
      onOpenGraph: (callback: (slug: string) => void) => () => void;
      onMenuAction: (callback: (action: string) => void) => () => void;
      onUpdateStatus: (callback: (status: any) => void) => () => void;
    };
  }
}
```

---

## Custom Protocols

```typescript
// electron/protocols.ts
import { protocol, net } from 'electron';
import path from 'path';
import fs from 'fs';

export function setupProtocols() {
  // Must be called before app is ready
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'cascade-asset',
      privileges: {
        secure: true,
        supportFetchAPI: true,
        stream: true,
      },
    },
  ]);
}

// Call after app is ready
export function registerProtocolHandlers() {
  // Serve local assets: cascade-asset://encoded-project-path/assets/image.png
  protocol.handle('cascade-asset', (request) => {
    const url = new URL(request.url);
    const projectPath = decodeURIComponent(url.hostname);
    const assetPath = decodeURIComponent(url.pathname.slice(1)); // Remove leading /
    
    const fullPath = path.join(projectPath, assetPath);
    
    // Security: ensure path is within project folder
    if (!fullPath.startsWith(projectPath)) {
      return new Response('Forbidden', { status: 403 });
    }
    
    return net.fetch(`file://${fullPath}`);
  });
}
```

---

## Native Menu

```typescript
// electron/menu.ts
import { Menu, app, BrowserWindow, shell } from 'electron';
import path from 'path';

export function createMenu(window: BrowserWindow, recentFolders: string[]) {
  const template = buildMenuTemplate(window, recentFolders);
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

export function updateRecentMenu(window: BrowserWindow, recentFolders: string[]) {
  createMenu(window, recentFolders);
}

function buildMenuTemplate(
  window: BrowserWindow,
  recentFolders: string[]
): Electron.MenuItemConstructorOptions[] {
  const isMac = process.platform === 'darwin';
  
  const recentSubmenu: Electron.MenuItemConstructorOptions[] = recentFolders.length > 0
    ? [
        ...recentFolders.slice(0, 10).map(folder => ({
          label: path.basename(folder),
          sublabel: folder,
          click: () => window.webContents.send('menu-action', `open-recent:${folder}`),
        })),
        { type: 'separator' as const },
        {
          label: 'Clear Recent',
          click: () => window.webContents.send('menu-action', 'clear-recent'),
        },
      ]
    : [{ label: 'No Recent Folders', enabled: false }];
  
  return [
    // App menu (macOS only)
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        {
          label: 'Preferences...',
          accelerator: 'CmdOrCtrl+,',
          click: () => window.webContents.send('menu-action', 'preferences'),
        },
        { type: 'separator' as const },
        { role: 'services' as const },
        { type: 'separator' as const },
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const },
      ],
    }] : []),
    
    // File menu
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Folder...',
          accelerator: 'CmdOrCtrl+O',
          click: () => window.webContents.send('menu-action', 'open-folder'),
        },
        {
          label: 'Open Recent',
          submenu: recentSubmenu,
        },
        { type: 'separator' },
        {
          label: 'New Graph',
          accelerator: 'CmdOrCtrl+N',
          click: () => window.webContents.send('menu-action', 'new-graph'),
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => window.webContents.send('menu-action', 'save'),
        },
        { type: 'separator' },
        {
          label: 'Reveal in Finder',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => window.webContents.send('menu-action', 'reveal-in-finder'),
        },
        { type: 'separator' },
        {
          label: 'Export HTML...',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => window.webContents.send('menu-action', 'export-html'),
        },
        ...(isMac ? [] : [
          { type: 'separator' as const },
          { role: 'quit' as const },
        ]),
      ],
    },
    
    // Edit menu
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    
    // View menu
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    
    // Window menu
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [
          { type: 'separator' as const },
          { role: 'front' as const },
        ] : [
          { role: 'close' as const },
        ]),
      ],
    },
    
    // Help menu
    {
      label: 'Help',
      submenu: [
        {
          label: 'Documentation',
          click: () => shell.openExternal('https://cascade.field.io/docs'),
        },
        {
          label: 'Report Issue',
          click: () => shell.openExternal('https://github.com/field-io/cascade/issues'),
        },
        { type: 'separator' },
        {
          label: 'Check for Updates...',
          click: () => window.webContents.send('menu-action', 'check-updates'),
        },
      ],
    },
  ];
}
```

---

## Preferences Manager

```typescript
// electron/preferences.ts
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';

export class PreferencesManager {
  private prefsPath: string;
  private recentPath: string;
  private credentialsPath: string;
  private prefs: Record<string, any> = {};
  private recent: { folders: Array<{ path: string; lastOpened: string }> } = { folders: [] };
  
  constructor() {
    const dataDir = path.join(app.getPath('home'), '.cascade');
    
    // Ensure directory exists
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    this.prefsPath = path.join(dataDir, 'preferences.json');
    this.recentPath = path.join(dataDir, 'recent.json');
    this.credentialsPath = path.join(dataDir, 'credentials.yaml');
    
    this.load();
  }
  
  private load() {
    // Load preferences
    try {
      if (fs.existsSync(this.prefsPath)) {
        this.prefs = JSON.parse(fs.readFileSync(this.prefsPath, 'utf-8'));
      }
    } catch (e) {
      console.error('Failed to load preferences:', e);
    }
    
    // Load recent folders
    try {
      if (fs.existsSync(this.recentPath)) {
        this.recent = JSON.parse(fs.readFileSync(this.recentPath, 'utf-8'));
      }
    } catch (e) {
      console.error('Failed to load recent:', e);
    }
  }
  
  get<T>(key: string, defaultValue?: T): T {
    return this.prefs[key] ?? defaultValue;
  }
  
  set(key: string, value: any) {
    this.prefs[key] = value;
    fs.writeFileSync(this.prefsPath, JSON.stringify(this.prefs, null, 2));
  }
  
  getAll(): Record<string, any> {
    return { ...this.prefs };
  }
  
  getRecentFolders(): string[] {
    return this.recent.folders
      .sort((a, b) => new Date(b.lastOpened).getTime() - new Date(a.lastOpened).getTime())
      .map(f => f.path)
      .filter(p => fs.existsSync(p));
  }
  
  getLastFolder(): string | null {
    const folders = this.getRecentFolders();
    return folders[0] || null;
  }
  
  addRecentFolder(folderPath: string) {
    // Remove if already exists
    this.recent.folders = this.recent.folders.filter(f => f.path !== folderPath);
    
    // Add to front
    this.recent.folders.unshift({
      path: folderPath,
      lastOpened: new Date().toISOString(),
    });
    
    // Keep max 20
    this.recent.folders = this.recent.folders.slice(0, 20);
    
    fs.writeFileSync(this.recentPath, JSON.stringify(this.recent, null, 2));
  }
  
  clearRecentFolders() {
    this.recent.folders = [];
    fs.writeFileSync(this.recentPath, JSON.stringify(this.recent, null, 2));
  }
  
  getCredentials(): Record<string, any> {
    try {
      if (fs.existsSync(this.credentialsPath)) {
        return yaml.load(fs.readFileSync(this.credentialsPath, 'utf-8')) as Record<string, any>;
      }
    } catch (e) {
      console.error('Failed to load credentials:', e);
    }
    return {};
  }
  
  setCredentials(credentials: Record<string, any>) {
    fs.writeFileSync(this.credentialsPath, yaml.dump(credentials));
  }
}
```

---

## Auto-Updater

```typescript
// electron/updater.ts
import { autoUpdater } from 'electron-updater';
import { app, dialog, BrowserWindow } from 'electron';
import log from 'electron-log';

export function setupAutoUpdater(mainWindow: BrowserWindow) {
  autoUpdater.logger = log;
  log.transports.file.level = 'info';
  
  // Don't auto-download, let user decide
  autoUpdater.autoDownload = false;
  
  // Check on startup (delayed)
  setTimeout(() => {
    autoUpdater.checkForUpdates();
  }, 5000);
  
  // Check every 4 hours
  setInterval(() => {
    autoUpdater.checkForUpdates();
  }, 4 * 60 * 60 * 1000);
  
  autoUpdater.on('update-available', (info) => {
    mainWindow.webContents.send('update-status', {
      status: 'available',
      version: info.version,
    });
    
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Available',
      message: `Cascade ${info.version} is available.`,
      detail: 'Would you like to download it now?',
      buttons: ['Download', 'Later'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.downloadUpdate();
      }
    });
  });
  
  autoUpdater.on('download-progress', (progress) => {
    mainWindow.webContents.send('update-status', {
      status: 'downloading',
      percent: Math.round(progress.percent),
    });
  });
  
  autoUpdater.on('update-downloaded', (info) => {
    mainWindow.webContents.send('update-status', {
      status: 'ready',
      version: info.version,
    });
    
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Ready',
      message: `Cascade ${info.version} is ready to install.`,
      detail: 'Restart now to update.',
      buttons: ['Restart', 'Later'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });
  
  autoUpdater.on('error', (error) => {
    log.error('Update error:', error);
  });
}

export function checkForUpdates() {
  autoUpdater.checkForUpdates();
}
```

---

## Electron Builder Config

```yaml
# electron-builder.yml
appId: io.field.cascade
productName: Cascade
directories:
  output: dist

# Auto-update
publish:
  provider: github
  owner: field-io
  repo: cascade
  releaseType: release

mac:
  category: public.app-category.developer-tools
  icon: build/icon.icns
  darkModeSupport: true
  hardenedRuntime: true
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
  notarize: true
  target:
    - target: dmg
      arch: [x64, arm64]
    - target: zip
      arch: [x64, arm64]

fileAssociations:
  - ext: cascade
    name: Cascade Graph
    description: Cascade visual programming graph
    icon: build/cascade-file.icns
    role: Editor

protocols:
  - name: Cascade URL
    schemes:
      - cascade

dmg:
  background: build/dmg-background.png
  iconSize: 100
  contents:
    - x: 130
      y: 220
    - x: 410
      y: 220
      type: link
      path: /Applications
```

### macOS Entitlements

```xml
<!-- build/entitlements.mac.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.allow-dyld-environment-variables</key>
  <true/>
  <key>com.apple.security.network.client</key>
  <true/>
  <key>com.apple.security.files.user-selected.read-write</key>
  <true/>
</dict>
</plist>
```

---

## Package.json Scripts

```json
{
  "name": "cascade",
  "version": "0.4.0",
  "scripts": {
    "dev": "vite dev",
    "dev:electron": "concurrently \"vite dev\" \"wait-on http://localhost:5173 && electron .\"",
    "build": "vite build",
    "build:electron": "npm run build && electron-builder --mac",
    "preview": "vite preview",
    "check": "svelte-kit sync && svelte-check",
    "electron": "electron .",
    "pack": "electron-builder --dir",
    "dist": "electron-builder --mac --publish never",
    "publish": "electron-builder --mac --publish always"
  },
  "main": "electron/main.js",
  "devDependencies": {
    "electron": "^33.0.0",
    "electron-builder": "^25.0.0",
    "electron-updater": "^6.0.0",
    "concurrently": "^8.0.0",
    "wait-on": "^7.0.0"
  }
}
```

---

## Implementation Phases

### Phase 1.1: Project Structure (2-3 days)

1. **Initialize Electron in existing project**
   - Add electron dependencies
   - Create electron/ folder structure
   - Setup basic main process
   - Configure electron-builder

2. **Storage adapter**
   - Create StorageAdapter interface
   - Implement LocalStorageAdapter
   - Wire up to existing editor

### Phase 1.2: Core Functionality (3-4 days)

1. **File operations**
   - Open folder dialog
   - Load project metadata
   - List/load/save graphs
   - Asset management

2. **Preload bridge**
   - Expose fs operations safely
   - IPC communication setup
   - Type definitions

### Phase 1.3: Native Integration (2-3 days)

1. **macOS integration**
   - Native menu
   - File associations (.cascade)
   - Custom protocol (cascade-asset://)
   - Recent documents

2. **Preferences**
   - Global preferences (~/.cascade/)
   - Window state persistence
   - AI credentials storage

### Phase 1.4: Polish & Distribution (2-3 days)

1. **Auto-updater**
   - GitHub releases integration
   - Update UI notifications

2. **Build & sign**
   - Code signing
   - Notarization
   - DMG creation
   - Test installation

---

## Success Criteria

- [x] `cascade .` opens current folder as project
- [x] Double-clicking .cascade file opens Cascade
- [x] Graphs save/load from filesystem
- [x] Assets load via cascade-asset:// protocol
- [x] Recent folders tracked and accessible
- [x] AI credentials stored in ~/.cascade/credentials.yaml
- [x] Auto-update checks and installs
- [x] DMG builds available (unsigned - code signing TODO)

### Additional Implemented Features

- [x] Window title shows current graph path with `~` prefix (e.g., `~/Projects/test/graph.cascade`)
- [x] Window title updates on Save As
- [x] Dirty indicator (`*`) in window title for unsaved changes
- [x] macOS proxy icon with represented filename
- [x] Open Folder (⌘⇧O) auto-opens first .cascade file in folder
- [x] Save As defaults to current project folder
- [x] Native save/open dialogs via Electron IPC
- [x] Preferences dialog for AI API keys (Settings)
- [x] Graph open events sync between main and renderer processes

### Testing Checklist

**Project Operations:**

- [x] Create new project (⌘⇧N) - creates folder structure with graphs/
- [x] Open folder (⌘⇧O) - opens folder picker, loads first .cascade file
- [x] Open graph file (⌘O) - opens .cascade file directly
- [x] Recent folders menu shows last opened projects

**Save Operations:**

- [x] Save (⌘S) - saves to current file, shows confirmation
- [x] Save As (⌘⇧S) - opens save dialog in current project folder
- [x] New file shows `*` indicator until first save
- [x] Modified file shows `*` indicator until saved

**Window Title:**

- [x] Shows full path with `~` prefix for home directory
- [x] Updates immediately after Save As
- [x] Updates when opening new graph
- [x] Shows dirty indicator when modified

**macOS Integration:**

- [ ] Proxy icon in title bar (click to show path)
- [ ] Dirty dot indicator on close button
- [ ] Double-click .cascade file in Finder opens app
- [ ] Recent Documents in Dock menu

---

## What's NOT in This Phase

- User accounts / authentication
- Cloud storage (Vercel Postgres, R2)
- Online sharing
- Version history (unlimited)
- Collaboration features

These come in Phase 2 (Cloud Mode).
