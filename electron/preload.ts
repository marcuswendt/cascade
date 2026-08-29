/**
 * Electron Preload Script
 *
 * Provides a secure bridge between the renderer process and main process.
 * Exposes specific, safe APIs via contextBridge for:
 * - Project management (open folders, recent projects)
 * - File system operations (for storage adapter)
 * - Native dialogs and window controls
 * - Preferences and credentials
 * - Update notifications
 */

import { contextBridge, ipcRenderer } from 'electron';

// ============ CascadeElectron API ============
// Used by LocalStorageAdapter and other new features

contextBridge.exposeInMainWorld('cascadeElectron', {
  // ============ Project Management ============

  /** Open folder picker dialog */
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),

  /** Open graph file picker dialog */
  openGraphDialog: () => ipcRenderer.invoke('open-graph-dialog'),

  /** Create a new project with folder structure */
  createNewProject: () => ipcRenderer.invoke('create-new-project'),

  /** Get current project path */
  getCurrentProject: () => ipcRenderer.invoke('get-current-project'),

  /** Get current graph file path */
  getCurrentGraph: () => ipcRenderer.invoke('get-current-graph'),

  /** Set current graph file path (updates window title) */
  setCurrentGraph: (graphPath: string) => ipcRenderer.invoke('set-current-graph', graphPath),

  /** Set document dirty state (updates window title with asterisk) */
  setDocumentDirty: (dirty: boolean) => ipcRenderer.invoke('set-document-dirty', dirty),

  /** Get list of recent project folders */
  getRecentFolders: () => ipcRenderer.invoke('get-recent-folders'),

  /** Get list of recent graph files */
  getRecentFiles: () => ipcRenderer.invoke('get-recent-files'),

  /** Reveal file/folder in system file manager */
  revealInFinder: (filePath: string) => ipcRenderer.invoke('reveal-in-finder', filePath),

  // ============ Preferences ============

  /** Get all preferences */
  getPreferences: () => ipcRenderer.invoke('get-preferences'),

  /** Set a preference value */
  setPreference: (key: string, value: any) => ipcRenderer.invoke('set-preference', key, value),

  /** Get AI credentials */
  getCredentials: () => ipcRenderer.invoke('get-credentials'),

  /** Set AI credentials */
  setCredentials: (credentials: any) => ipcRenderer.invoke('set-credentials', credentials),

  // ============ Updates ============

  /** Check for updates */
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),

  // ============ File System ============

  fs: {
    /** Read file contents as UTF-8 string */
    readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),

    /** Write string content to file */
    writeFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:writeFile', filePath, content),

    /** Read directory entries */
    readdir: (dirPath: string) => ipcRenderer.invoke('fs:readdir', dirPath),

    /** Create directory (recursive) */
    mkdir: (dirPath: string) => ipcRenderer.invoke('fs:mkdir', dirPath),

    /** Delete file */
    unlink: (filePath: string) => ipcRenderer.invoke('fs:unlink', filePath),

    /** Get file stats */
    stat: (filePath: string) => ipcRenderer.invoke('fs:stat', filePath),

    /** Check if file/directory exists */
    exists: (filePath: string) => ipcRenderer.invoke('fs:exists', filePath),
  },

  // ============ Path Utilities ============

  path: {
    /** Join path segments */
    join: (...args: string[]) => args.join('/').replace(/\/+/g, '/'),

    /** Get directory name from path */
    dirname: (p: string) => {
      const parts = p.replace(/\\/g, '/').split('/');
      parts.pop();
      return parts.join('/') || '/';
    },

    /** Get file name from path */
    basename: (p: string, ext?: string) => {
      const name = p.replace(/\\/g, '/').split('/').pop() || '';
      if (ext && name.endsWith(ext)) {
        return name.slice(0, -ext.length);
      }
      return name;
    },

    /** Get file extension */
    extname: (p: string) => {
      const name = p.replace(/\\/g, '/').split('/').pop() || '';
      const dotIndex = name.lastIndexOf('.');
      return dotIndex > 0 ? name.slice(dotIndex) : '';
    },
  },

  // ============ Event Listeners ============

  /** Listen for project open events */
  onOpenProject: (callback: (path: string) => void) => {
    const handler = (_event: any, path: string) => callback(path);
    ipcRenderer.on('open-project', handler);
    return () => ipcRenderer.removeListener('open-project', handler);
  },

  /** Listen for graph open events */
  onOpenGraph: (callback: (slug: string) => void) => {
    const handler = (_event: any, slug: string) => callback(slug);
    ipcRenderer.on('open-graph', handler);
    return () => ipcRenderer.removeListener('open-graph', handler);
  },

  /** Listen for menu action events */
  onMenuAction: (callback: (action: string) => void) => {
    const handler = (_event: any, action: string) => callback(action);
    ipcRenderer.on('menu-action', handler);
    return () => ipcRenderer.removeListener('menu-action', handler);
  },

  /** Listen for update status events */
  onUpdateStatus: (callback: (status: any) => void) => {
    const handler = (_event: any, status: any) => callback(status);
    ipcRenderer.on('update-status', handler);
    return () => ipcRenderer.removeListener('update-status', handler);
  },
});

// ============ Legacy Cascade API ============
// Keep existing API for backwards compatibility

contextBridge.exposeInMainWorld('cascade', {
  // ============ Platform Detection ============

  /** Operating system platform */
  platform: process.platform,

  /** Whether running in Electron */
  isElectron: true,

  // ============ App Info ============

  /** Get app version */
  getVersion: () => ipcRenderer.invoke('app:getVersion'),

  /** Get app name */
  getName: () => ipcRenderer.invoke('app:getName'),

  /** Get app paths (home, userData, temp, etc.) */
  getPath: (name: string) => ipcRenderer.invoke('app:getPath', name),

  // ============ Native Dialogs ============

  /** Show native save dialog */
  showSaveDialog: (options: {
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
    title?: string;
  }) => ipcRenderer.invoke('dialog:showSave', options),

  /** Show native open dialog */
  showOpenDialog: (options: {
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
    properties?: Array<'openFile' | 'openDirectory' | 'multiSelections' | 'createDirectory'>;
    title?: string;
  }) => ipcRenderer.invoke('dialog:showOpen', options),

  // ============ Window Controls ============

  /** Minimize window */
  minimize: () => ipcRenderer.send('window:minimize'),

  /** Maximize/restore window */
  maximize: () => ipcRenderer.send('window:maximize'),

  /** Close window */
  close: () => ipcRenderer.send('window:close'),

  // ============ Shell Operations ============

  /** Reveal file in system file manager */
  showItemInFolder: (filePath: string) => ipcRenderer.send('shell:showItemInFolder', filePath),

  /** Open URL in default browser */
  openExternal: (url: string) => ipcRenderer.send('shell:openExternal', url),

  // ============ Project Operations ============

  /** Notify main process that a project was opened (for recent documents) */
  notifyProjectOpened: (projectPath: string) => ipcRenderer.send('project:opened', projectPath),

  // ============ File System ============

  /** Check if a file exists */
  fileExists: (filePath: string) => ipcRenderer.invoke('fs:fileExists', filePath),

  /** Write content to a file */
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:writeFile', filePath, content),

  // ============ Event Listeners ============

  /** Listen for menu commands */
  onMenuCommand: (channel: string, callback: (...args: any[]) => void) => {
    const validChannels = [
      'menu:preferences',
      'menu:newProject',
      'menu:openProject',
      'menu:openFolder',
      'menu:save',
      'menu:saveAs',
      'menu:exportHTML',
      'menu:createNode',
      'menu:runAll',
      'menu:stopAll',
      'menu:homeView',
      'menu:centerOnNodes',
      'menu:frameSelection',
      'menu:resetLayout',
      'menu:maximizeTab',
      'menu:focusGraph',
      'menu:focusViewer',
      'menu:focusInspector',
      'menu:focusLog',
      'menu:selectAll',
      'menu:deleteSelected',
      'menu:showShortcuts',
      'menu:about',
      'menu:revealInFinder',
      'menu:newGraph',
      'menu:checkUpdates',
    ];

    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_event, ...args) => callback(...args));
    }
  },

  /** Remove menu command listener */
  removeMenuListener: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },

  /** Listen for file open events (from file associations) */
  onFileOpen: (callback: (filePath: string) => void) => {
    ipcRenderer.on('file:open', (_event, filePath) => callback(filePath));
  },

  /** Listen for deep link events */
  onDeepLink: (callback: (action: string, data: any) => void) => {
    ipcRenderer.on('deeplink:open', (_event, data) => callback('open', data));
    ipcRenderer.on('deeplink:new', (_event, data) => callback('new', data));
  },
});

// Type definitions for Window.cascade and Window.cascadeElectron are in src/vite-env.d.ts
// to avoid duplicate declarations between the Electron preload and Vite builds.

export {};
