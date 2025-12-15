# Cascade Electron Integration Specification

## Overview

This specification describes converting Cascade from a browser-based application (requiring a separate server process) into an Electron desktop application that bundles the Express server internally. The app will also continue to work in a browser when the server is run separately.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Server strategy | Bundle Express server | Reuse existing code, maintain browser compatibility |
| Window management | Single window + Dockview | Consistent cross-platform UX, simpler implementation |
| Target platform | macOS first | Smoothest development experience, expand later |
| Updates | Manual | Avoid infrastructure complexity initially |
| Exported bundles | Serverless HTML | Already implemented, no change needed |

---

## Architecture

### Current Architecture (Browser Mode)

```
┌─────────────────────────────────────────────────────────────┐
│  Terminal 1                    Terminal 2                   │
│  ┌─────────────────────┐      ┌─────────────────────────┐   │
│  │  Express Server     │      │  Vite Dev Server        │   │
│  │  localhost:3030     │◄────►│  localhost:5173         │   │
│  │  + WebSocket :3031  │      │  (Svelte Frontend)      │   │
│  └─────────────────────┘      └─────────────────────────┘   │
│           │                              │                  │
│           ▼                              ▼                  │
│  ~/cascade-projects/           Browser Tab                  │
└─────────────────────────────────────────────────────────────┘
```

### Electron Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Cascade.app                                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Main Process (Node.js)                              │   │
│  │  ┌─────────────────────────────────────────────┐    │   │
│  │  │  Embedded Express Server (localhost:3030)    │    │   │
│  │  │  + WebSocket Server (localhost:3031)         │    │   │
│  │  └─────────────────────────────────────────────┘    │   │
│  │                        │                             │   │
│  │                   IPC Bridge                         │   │
│  │                        │                             │   │
│  │  ┌─────────────────────────────────────────────┐    │   │
│  │  │  Renderer Process (Chromium)                 │    │   │
│  │  │  ┌───────────────────────────────────────┐  │    │   │
│  │  │  │  Svelte Frontend + Dockview           │  │    │   │
│  │  │  │  (loads built frontend or dev server) │  │    │   │
│  │  │  └───────────────────────────────────────┘  │    │   │
│  │  └─────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                  │
│                          ▼                                  │
│                 ~/cascade-projects/                         │
└─────────────────────────────────────────────────────────────┘
```

### Dual-Mode Operation

The same codebase supports both modes:

```
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│   Browser Mode                    Electron Mode                │
│   ────────────                    ─────────────                │
│                                                                │
│   npm run server                  npm run electron:dev         │
│   npm run dev                           OR                     │
│   Open localhost:5173             npm run electron:build       │
│                                   Open Cascade.app             │
│                                                                │
│   ┌─────────────┐                ┌─────────────────────┐      │
│   │ Browser Tab │                │ Electron Window     │      │
│   └──────┬──────┘                └──────────┬──────────┘      │
│          │                                  │                  │
│          ▼                                  ▼                  │
│   ┌─────────────┐                ┌─────────────────────┐      │
│   │ Svelte App  │                │ Svelte App          │      │
│   └──────┬──────┘                └──────────┬──────────┘      │
│          │                                  │                  │
│          │  HTTP/WS                         │  HTTP/WS         │
│          ▼                                  ▼                  │
│   ┌─────────────┐                ┌─────────────────────┐      │
│   │ Express     │                │ Express (embedded)  │      │
│   │ (separate)  │                │ in main process     │      │
│   └─────────────┘                └─────────────────────┘      │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

### New Files

```
cascade/
├── electron/                        # NEW: Electron-specific code
│   ├── main.ts                      # Main process entry
│   ├── preload.ts                   # Preload script (security bridge)
│   ├── server.ts                    # Server lifecycle management
│   └── menu.ts                      # Native menu configuration
├── src/                             # Frontend (unchanged)
├── server/                          # Express server (unchanged)
├── resources/                       # NEW: App resources
│   ├── icon.icns                    # macOS icon
│   ├── icon.ico                     # Windows icon
│   └── icon.png                     # Linux icon
├── electron-builder.yaml           # NEW: Build configuration
├── package.json                     # Updated with Electron deps
└── ...
```

---

## Implementation

### 1. Main Process (`electron/main.ts`)

```typescript
import { app, BrowserWindow, shell } from 'electron';
import path from 'path';
import { startServer, stopServer } from './server';
import { createMenu } from './menu';

// Handle creating/removing shortcuts on Windows when installing/uninstalling
if (require('electron-squirrel-startup')) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;

const isDev = process.env.NODE_ENV === 'development';
const SERVER_PORT = 3030;
const VITE_DEV_PORT = 5173;

async function createWindow() {
  // Start the Express server before creating the window
  await startServer();

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    
    // macOS-specific
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    vibrancy: 'sidebar',
    
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
    mainWindow.loadURL(`http://localhost:${VITE_DEV_PORT}`);
    mainWindow.webContents.openDevTools();
  } else {
    // Production: load built files
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
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

  // Set up native menu
  createMenu(mainWindow);
}

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
  await stopServer();
});

// Start the app
app.whenReady().then(createWindow);
```

### 2. Server Lifecycle (`electron/server.ts`)

```typescript
import { fork, ChildProcess } from 'child_process';
import path from 'path';
import waitOn from 'wait-on';

let serverProcess: ChildProcess | null = null;

const SERVER_PORT = 3030;
const WS_PORT = 3031;

export async function startServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const serverPath = path.join(__dirname, '../server/dist/index.js');
    
    // Fork the server as a child process
    serverProcess = fork(serverPath, [], {
      env: {
        ...process.env,
        PORT: String(SERVER_PORT),
        WS_PORT: String(WS_PORT),
        // Use app-specific data directory
        CASCADE_PROJECTS_DIR: getCascadeProjectsDir(),
      },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });

    serverProcess.stdout?.on('data', (data) => {
      console.log(`[Server] ${data}`);
    });

    serverProcess.stderr?.on('data', (data) => {
      console.error(`[Server Error] ${data}`);
    });

    serverProcess.on('error', (err) => {
      console.error('Failed to start server:', err);
      reject(err);
    });

    // Wait for server to be ready
    waitOn({
      resources: [`http://localhost:${SERVER_PORT}/api/health`],
      timeout: 10000,
    })
      .then(() => {
        console.log('Server is ready');
        resolve();
      })
      .catch(reject);
  });
}

export async function stopServer(): Promise<void> {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
}

function getCascadeProjectsDir(): string {
  const { app } = require('electron');
  // Use standard location: ~/cascade-projects
  // Could also use app.getPath('userData') for sandboxed storage
  return path.join(app.getPath('home'), 'cascade-projects');
}
```

### 3. Preload Script (`electron/preload.ts`)

The preload script provides a secure bridge between renderer and main process:

```typescript
import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// specific Electron features without exposing the full API
contextBridge.exposeInMainWorld('cascade', {
  // Platform detection
  platform: process.platform,
  isElectron: true,
  
  // App info
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  
  // Native dialogs (optional enhancement)
  showSaveDialog: (options: any) => ipcRenderer.invoke('dialog:showSave', options),
  showOpenDialog: (options: any) => ipcRenderer.invoke('dialog:showOpen', options),
  
  // Window controls (for custom titlebar if needed)
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  
  // File reveal (show in Finder/Explorer)
  showItemInFolder: (path: string) => ipcRenderer.send('shell:showItemInFolder', path),
});

// TypeScript declaration for the exposed API
declare global {
  interface Window {
    cascade?: {
      platform: string;
      isElectron: boolean;
      getVersion: () => Promise<string>;
      showSaveDialog: (options: any) => Promise<any>;
      showOpenDialog: (options: any) => Promise<any>;
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      showItemInFolder: (path: string) => void;
    };
  }
}
```

### 4. Native Menu (`electron/menu.ts`)

```typescript
import { app, Menu, BrowserWindow, shell, dialog } from 'electron';

export function createMenu(mainWindow: BrowserWindow) {
  const isMac = process.platform === 'darwin';

  const template: Electron.MenuItemConstructorOptions[] = [
    // App menu (macOS only)
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        {
          label: 'Preferences...',
          accelerator: 'CmdOrCtrl+,',
          click: () => mainWindow.webContents.send('menu:preferences'),
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
          label: 'New Project',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow.webContents.send('menu:newProject'),
        },
        {
          label: 'Open Project...',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow.webContents.send('menu:openProject'),
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow.webContents.send('menu:save'),
        },
        { type: 'separator' },
        {
          label: 'Export as HTML...',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => mainWindow.webContents.send('menu:exportHTML'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' as const } : { role: 'quit' as const },
      ],
    },

    // Edit menu
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'delete' as const },
        { type: 'separator' as const },
        { role: 'selectAll' as const },
      ],
    },

    // View menu
    {
      label: 'View',
      submenu: [
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        { role: 'toggleDevTools' as const },
        { type: 'separator' as const },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const },
      ],
    },

    // Graph menu (Cascade-specific)
    {
      label: 'Graph',
      submenu: [
        {
          label: 'Run All',
          accelerator: 'CmdOrCtrl+Enter',
          click: () => mainWindow.webContents.send('menu:runAll'),
        },
        {
          label: 'Stop All',
          accelerator: 'CmdOrCtrl+.',
          click: () => mainWindow.webContents.send('menu:stopAll'),
        },
        { type: 'separator' },
        {
          label: 'Home View',
          accelerator: 'H',
          click: () => mainWindow.webContents.send('menu:homeView'),
        },
        {
          label: 'Frame Selection',
          accelerator: 'F',
          click: () => mainWindow.webContents.send('menu:frameSelection'),
        },
      ],
    },

    // Window menu
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
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
          click: () => shell.openExternal('https://cascade.dev/docs'),
        },
        {
          label: 'Report Issue',
          click: () => shell.openExternal('https://github.com/cascade/cascade/issues'),
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
```

### 5. Frontend Integration (`src/lib/electron.ts`)

Utility for detecting and using Electron features:

```typescript
/**
 * Electron integration utilities
 * Provides graceful fallbacks for browser mode
 */

export const isElectron = typeof window !== 'undefined' && !!window.cascade?.isElectron;

export const platform = window.cascade?.platform ?? 'web';

/**
 * Show native save dialog (falls back to browser download)
 */
export async function showSaveDialog(options: {
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}): Promise<string | null> {
  if (isElectron) {
    const result = await window.cascade!.showSaveDialog(options);
    return result.canceled ? null : result.filePath;
  }
  // Browser fallback: return null, let caller use download approach
  return null;
}

/**
 * Show native open dialog (falls back to file input)
 */
export async function showOpenDialog(options: {
  filters?: Array<{ name: string; extensions: string[] }>;
  properties?: Array<'openFile' | 'openDirectory' | 'multiSelections'>;
}): Promise<string[] | null> {
  if (isElectron) {
    const result = await window.cascade!.showOpenDialog(options);
    return result.canceled ? null : result.filePaths;
  }
  // Browser fallback: return null, let caller use input[type=file]
  return null;
}

/**
 * Reveal file in system file manager
 */
export function showInFolder(filePath: string): void {
  if (isElectron) {
    window.cascade!.showItemInFolder(filePath);
  }
}

/**
 * Listen for menu commands from main process
 */
export function onMenuCommand(
  command: string,
  callback: () => void
): () => void {
  if (!isElectron) return () => {};
  
  const handler = (_event: any, cmd: string) => {
    if (cmd === command) callback();
  };
  
  // This would need ipcRenderer.on exposed via preload
  // For now, use custom events dispatched by preload
  window.addEventListener(`cascade:menu:${command}`, callback);
  return () => window.removeEventListener(`cascade:menu:${command}`, callback);
}
```

---

## Build Configuration

### `electron-builder.yaml`

```yaml
appId: dev.cascade.app
productName: Cascade
copyright: Copyright © 2024 Cascade

directories:
  output: release
  buildResources: resources

files:
  - dist/**/*
  - electron/**/*
  - server/dist/**/*
  - package.json

extraMetadata:
  main: electron/main.js

mac:
  target:
    - target: dmg
      arch:
        - x64
        - arm64
    - target: zip
      arch:
        - x64
        - arm64
  icon: resources/icon.icns
  category: public.app-category.developer-tools
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: resources/entitlements.mac.plist
  entitlementsInherit: resources/entitlements.mac.plist

dmg:
  contents:
    - x: 130
      y: 220
    - x: 410
      y: 220
      type: link
      path: /Applications
  window:
    width: 540
    height: 380

# Windows config (for later)
win:
  target:
    - nsis
  icon: resources/icon.ico

# Linux config (for later)  
linux:
  target:
    - AppImage
  icon: resources/icon.png
  category: Development
```

### `resources/entitlements.mac.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
  <key>com.apple.security.network.client</key>
  <true/>
  <key>com.apple.security.network.server</key>
  <true/>
  <key>com.apple.security.files.user-selected.read-write</key>
  <true/>
</dict>
</plist>
```

---

## Package.json Updates

```json
{
  "name": "cascade",
  "version": "0.1.0",
  "description": "Visual programming for generative art",
  "main": "electron/main.js",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "server": "cd server && npm run dev",
    
    "electron:dev": "concurrently \"npm run server\" \"npm run dev\" \"wait-on http://localhost:5173 && electron .\"",
    "electron:build": "npm run build && npm run server:build && electron-builder",
    "electron:build:mac": "npm run electron:build -- --mac",
    "electron:build:win": "npm run electron:build -- --win",
    "electron:build:linux": "npm run electron:build -- --linux",
    
    "server:build": "cd server && npm run build",
    
    "postinstall": "electron-builder install-app-deps"
  },
  "devDependencies": {
    "electron": "^28.0.0",
    "electron-builder": "^24.9.0",
    "concurrently": "^8.2.0",
    "wait-on": "^7.2.0"
  },
  "dependencies": {
    "electron-updater": "^6.1.0"
  },
  "build": {
    "extends": "electron-builder.yaml"
  }
}
```

---

## Development Workflow

### Running in Development

```bash
# Terminal: Start everything with one command
npm run electron:dev

# This runs concurrently:
# 1. Express server (port 3030)
# 2. Vite dev server (port 5173)  
# 3. Electron window (loads localhost:5173)
```

### Running Browser-Only (No Electron)

```bash
# Terminal 1: Server
npm run server

# Terminal 2: Frontend
npm run dev

# Open http://localhost:5173 in browser
```

### Building for Distribution

```bash
# Build macOS app
npm run electron:build:mac

# Output in release/
# - Cascade-0.1.0-arm64.dmg
# - Cascade-0.1.0-x64.dmg
# - Cascade-0.1.0-arm64-mac.zip
# - Cascade-0.1.0-x64-mac.zip
```

---

## Security Considerations

### Code Execution Sandboxing

User-defined node code runs in the renderer process. Current mitigations:

1. **contextIsolation: true** - Renderer can't access Node.js directly
2. **sandbox: true** - Renderer runs in Chromium sandbox
3. **Preload whitelist** - Only specific APIs exposed via `window.cascade`

### Future Consideration: Web Worker Isolation

For stronger isolation of user code:

```typescript
// Execute user node code in a Web Worker
const worker = new Worker('node-executor.js');
worker.postMessage({ code: userCode, inputs: nodeInputs });
worker.onmessage = (e) => {
  // Receive outputs, update node state
};
```

### Credential Protection

The credentials file (`~/.cascade/credentials.yaml`) is:
- Read only by the Express server (main process)
- Never exposed to renderer
- Never included in exported bundles

---

## Implementation Phases

### Phase 1: Basic Shell (Day 1)
- [ ] Create `electron/` directory structure
- [ ] Implement `main.ts` with window creation
- [ ] Implement `server.ts` for server lifecycle
- [ ] Basic `preload.ts` with platform detection
- [ ] Update `package.json` with Electron deps
- [ ] Test dev workflow: `npm run electron:dev`

### Phase 2: Native Menu (Day 1-2)
- [ ] Implement `menu.ts` with full menu structure
- [ ] Wire menu commands to frontend via IPC
- [ ] Handle menu events in Svelte components
- [ ] macOS-specific menu behaviors
- [ ] **Open Recent submenu integration**

### Phase 3: Native Enhancements (Day 2-3)
- [ ] Native file dialogs (save/open)
- [ ] Drag and drop from Finder
- [ ] "Show in Finder" for project files
- [ ] Window state persistence (size, position)
- [ ] **Recent projects tracking** (`app.addRecentDocument`)
- [ ] **File association handling** (`open-file` event)
- [ ] **Deep link handling** (`open-url` event, `cascade://` protocol)

### Phase 4: Build & Package (Day 3-4)
- [ ] Configure `electron-builder.yaml`
- [ ] Create app icons (icns, ico, png)
- [ ] **Create document icon** for `.cascade` files
- [ ] **Configure file associations** in builder config
- [ ] **Configure protocol handler** in builder config
- [ ] Test unsigned build locally
- [ ] Create DMG with proper layout
- [ ] Test installation flow

### Phase 5: Polish (Day 4-5)
- [ ] Custom titlebar styling for macOS
- [ ] About dialog with version info
- [ ] **Test file association** (double-click .cascade)
- [ ] **Test deep links** (cascade://open?...)
- [ ] Performance testing
- [ ] Documentation

---

## File Checklist

New files to create:

```
electron/
├── main.ts              # Main process entry
├── preload.ts           # Security bridge
├── server.ts            # Server lifecycle
├── menu.ts              # Native menus
└── recent.ts            # Recent projects tracking

resources/
├── icon.icns            # 1024x1024 macOS app icon
├── icon.ico             # Windows app icon (multiple sizes)
├── icon.png             # 512x512 Linux app icon
├── cascade-doc.icns     # macOS document icon for .cascade files
├── cascade-doc.ico      # Windows document icon
├── entitlements.mac.plist
└── dmg-background.png   # Optional DMG background

src/lib/
└── electron.ts          # Frontend Electron utilities

Root:
├── electron-builder.yaml
└── package.json         # (update existing)
```

---

## Recent Projects

Integrate with macOS native "Open Recent" submenu.

### Implementation

```typescript
// electron/recent.ts
import { app } from 'electron';
import path from 'path';

/**
 * Add a project to the recent documents list
 */
export function addToRecentProjects(projectPath: string): void {
  // Add to macOS recent documents
  app.addRecentDocument(projectPath);
}

/**
 * Clear recent documents
 */
export function clearRecentProjects(): void {
  app.clearRecentDocuments();
}
```

### Menu Integration

Update `menu.ts` to include Open Recent:

```typescript
// In File menu submenu:
{
  label: 'Open Recent',
  role: 'recentDocuments',
  submenu: [
    {
      label: 'Clear Recent',
      role: 'clearRecentDocuments',
    },
  ],
},
```

### Triggering Recent Addition

Call `addToRecentProjects()` when:
- Opening a project
- Creating a new project
- Saving a project for the first time

```typescript
// In main.ts, handle when frontend opens a project
ipcMain.on('project:opened', (_event, projectPath: string) => {
  addToRecentProjects(projectPath);
});
```

---

## File Associations

Register `.cascade` as the project file extension. When double-clicked, opens in Cascade.

### electron-builder.yaml additions

```yaml
mac:
  # ... existing config ...
  fileAssociations:
    - ext: cascade
      name: Cascade Project
      description: Cascade Visual Programming Project
      icon: resources/cascade-doc.icns
      role: Editor

# For Windows (future)
win:
  fileAssociations:
    - ext: cascade
      name: Cascade Project
      description: Cascade Visual Programming Project
      icon: resources/cascade-doc.ico

# For Linux (future)
linux:
  mimeTypes:
    - application/x-cascade
```

### Handling File Open

```typescript
// electron/main.ts

// macOS: Handle file open from Finder
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  
  if (filePath.endsWith('.cascade') || filePath.endsWith('.cascade.json')) {
    if (mainWindow) {
      // App already running, send to renderer
      mainWindow.webContents.send('file:open', filePath);
      mainWindow.focus();
    } else {
      // App not running yet, store for when window is ready
      global.pendingFilePath = filePath;
    }
  }
});

// In createWindow(), after window is ready:
mainWindow.webContents.on('did-finish-load', () => {
  if (global.pendingFilePath) {
    mainWindow.webContents.send('file:open', global.pendingFilePath);
    global.pendingFilePath = null;
  }
});

// Windows/Linux: Handle file open via command line args
const filePath = process.argv.find(arg => 
  arg.endsWith('.cascade') || arg.endsWith('.cascade.json')
);
if (filePath) {
  // Handle same as above
}
```

### Frontend Handler

```typescript
// src/lib/electron.ts
export function onFileOpen(callback: (filePath: string) => void): () => void {
  if (!isElectron) return () => {};
  
  const handler = (_event: any, filePath: string) => callback(filePath);
  window.addEventListener('cascade:file:open', ((e: CustomEvent) => {
    callback(e.detail);
  }) as EventListener);
  
  return () => {
    window.removeEventListener('cascade:file:open', handler as EventListener);
  };
}
```

### File Extension Migration

Consider using `.cascade` instead of `.cascade.json` for cleaner associations:

| Current | Proposed |
|---------|----------|
| `graph.cascade.json` | `project.cascade` |

The file is still JSON internally, just with a cleaner extension. This is optional—we can keep `.cascade.json` and associate both.

---

## Deep Links (cascade:// Protocol)

Register `cascade://` URL protocol for opening projects and triggering actions.

### URL Scheme

```
cascade://open?path=/Users/marcus/cascade-projects/my-project
cascade://open?project=my-project
cascade://new
cascade://new?template=particles
```

### electron-builder.yaml additions

```yaml
mac:
  # ... existing config ...
  protocols:
    - name: Cascade
      schemes:
        - cascade
```

### Protocol Handler

```typescript
// electron/main.ts

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

// Windows/Linux: Handle via second-instance
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

function handleDeepLink(url: string): void {
  try {
    const parsed = new URL(url);
    
    switch (parsed.hostname) {
      case 'open':
        const projectPath = parsed.searchParams.get('path');
        const projectName = parsed.searchParams.get('project');
        
        if (projectPath) {
          mainWindow?.webContents.send('deeplink:open', { path: projectPath });
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
```

---

## Future: Auto-Updates via GitHub

Currently manual updates only. Future implementation will use GitHub Releases with `electron-updater`.

### Planned Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  GitHub Repository                                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Releases                                            │   │
│  │  ├── v0.1.0                                         │   │
│  │  │   ├── Cascade-0.1.0-arm64.dmg                   │   │
│  │  │   ├── Cascade-0.1.0-x64.dmg                     │   │
│  │  │   ├── Cascade-0.1.0-arm64-mac.zip              │   │
│  │  │   ├── Cascade-0.1.0-x64-mac.zip                │   │
│  │  │   └── latest-mac.yml                            │   │
│  │  └── v0.2.0                                         │   │
│  │       └── ...                                       │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ electron-updater checks
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Cascade.app                                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  On startup: check for updates                       │   │
│  │  If available: prompt user to download               │   │
│  │  Download in background                              │   │
│  │  Install on next restart                             │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Future electron-builder.yaml additions

```yaml
publish:
  provider: github
  owner: your-username
  repo: cascade
  releaseType: release
```

### Future Implementation Stub

```typescript
// electron/updater.ts (for future use)
import { autoUpdater } from 'electron-updater';
import { dialog, BrowserWindow } from 'electron';

export function initAutoUpdater(mainWindow: BrowserWindow): void {
  // Disable for now - manual updates only
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Available',
      message: `Version ${info.version} is available. Download now?`,
      buttons: ['Download', 'Later'],
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.downloadUpdate();
      }
    });
  });

  autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Ready',
      message: 'Update downloaded. Restart to install?',
      buttons: ['Restart', 'Later'],
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });

  // Check for updates (uncomment when ready)
  // autoUpdater.checkForUpdates();
}
```

---

## Distribution Notes

### Current: Development/Testing Only

For personal use, no code signing needed:

```bash
# Build unsigned for local testing
npm run electron:build:mac

# macOS will show "unidentified developer" warning
# Right-click > Open to bypass, or:
xattr -cr /Applications/Cascade.app
```

### Future: Public Distribution

When ready for wider distribution:

1. **Apple Developer Account** ($99/year)
   - Code signing certificate
   - Notarization for Gatekeeper
   
2. **GitHub Actions** for CI/CD
   - Build on push to release branch
   - Auto-publish to GitHub Releases
   - Code sign in CI (secrets in GitHub)

3. **Update electron-builder.yaml**
   ```yaml
   mac:
     notarize:
       teamId: YOUR_TEAM_ID
   ```

---

## Resolved Decisions

| Question | Decision |
|----------|----------|
| Custom titlebar | No, use macOS `hiddenInset` |
| Recent projects | Yes, native macOS Open Recent |
| File associations | Yes, `.cascade` extension |
| Deep links | Yes, `cascade://` protocol |
| Updates | Manual now, GitHub Releases later |
| Distribution | Dev/testing only for now |

---

*Specification version: 1.1*
*Last updated: 2024*
