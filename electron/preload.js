"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// ============ CascadeElectron API ============
// Used by LocalStorageAdapter and other new features
electron_1.contextBridge.exposeInMainWorld('cascadeElectron', {
    // ============ Project Management ============
    /** Open folder picker dialog */
    openFolderDialog: () => electron_1.ipcRenderer.invoke('open-folder-dialog'),
    /** Open graph file picker dialog */
    openGraphDialog: () => electron_1.ipcRenderer.invoke('open-graph-dialog'),
    /** Create a new project with folder structure */
    createNewProject: () => electron_1.ipcRenderer.invoke('create-new-project'),
    /** Get current project path */
    getCurrentProject: () => electron_1.ipcRenderer.invoke('get-current-project'),
    /** Get current graph file path */
    getCurrentGraph: () => electron_1.ipcRenderer.invoke('get-current-graph'),
    /** Set current graph file path (updates window title) */
    setCurrentGraph: (graphPath) => electron_1.ipcRenderer.invoke('set-current-graph', graphPath),
    /** Set document dirty state (updates window title with asterisk) */
    setDocumentDirty: (dirty) => electron_1.ipcRenderer.invoke('set-document-dirty', dirty),
    /** Get list of recent project folders */
    getRecentFolders: () => electron_1.ipcRenderer.invoke('get-recent-folders'),
    /** Get list of recent graph files */
    getRecentFiles: () => electron_1.ipcRenderer.invoke('get-recent-files'),
    /** Reveal file/folder in system file manager */
    revealInFinder: (filePath) => electron_1.ipcRenderer.invoke('reveal-in-finder', filePath),
    // ============ Preferences ============
    /** Get all preferences */
    getPreferences: () => electron_1.ipcRenderer.invoke('get-preferences'),
    /** Set a preference value */
    setPreference: (key, value) => electron_1.ipcRenderer.invoke('set-preference', key, value),
    /** Get AI credentials */
    getCredentials: () => electron_1.ipcRenderer.invoke('get-credentials'),
    /** Set AI credentials */
    setCredentials: (credentials) => electron_1.ipcRenderer.invoke('set-credentials', credentials),
    // ============ Updates ============
    /** Check for updates */
    checkForUpdates: () => electron_1.ipcRenderer.invoke('check-for-updates'),
    // ============ File System ============
    fs: {
        /** Read file contents as UTF-8 string */
        readFile: (filePath) => electron_1.ipcRenderer.invoke('fs:readFile', filePath),
        /** Write string content to file */
        writeFile: (filePath, content) => electron_1.ipcRenderer.invoke('fs:writeFile', filePath, content),
        /** Read directory entries */
        readdir: (dirPath) => electron_1.ipcRenderer.invoke('fs:readdir', dirPath),
        /** Create directory (recursive) */
        mkdir: (dirPath) => electron_1.ipcRenderer.invoke('fs:mkdir', dirPath),
        /** Delete file */
        unlink: (filePath) => electron_1.ipcRenderer.invoke('fs:unlink', filePath),
        /** Get file stats */
        stat: (filePath) => electron_1.ipcRenderer.invoke('fs:stat', filePath),
        /** Check if file/directory exists */
        exists: (filePath) => electron_1.ipcRenderer.invoke('fs:exists', filePath),
    },
    // ============ Path Utilities ============
    path: {
        /** Join path segments */
        join: (...args) => args.join('/').replace(/\/+/g, '/'),
        /** Get directory name from path */
        dirname: (p) => {
            const parts = p.replace(/\\/g, '/').split('/');
            parts.pop();
            return parts.join('/') || '/';
        },
        /** Get file name from path */
        basename: (p, ext) => {
            const name = p.replace(/\\/g, '/').split('/').pop() || '';
            if (ext && name.endsWith(ext)) {
                return name.slice(0, -ext.length);
            }
            return name;
        },
        /** Get file extension */
        extname: (p) => {
            const name = p.replace(/\\/g, '/').split('/').pop() || '';
            const dotIndex = name.lastIndexOf('.');
            return dotIndex > 0 ? name.slice(dotIndex) : '';
        },
    },
    // ============ Event Listeners ============
    /** Listen for project open events */
    onOpenProject: (callback) => {
        const handler = (_event, path) => callback(path);
        electron_1.ipcRenderer.on('open-project', handler);
        return () => electron_1.ipcRenderer.removeListener('open-project', handler);
    },
    /** Listen for graph open events */
    onOpenGraph: (callback) => {
        const handler = (_event, slug) => callback(slug);
        electron_1.ipcRenderer.on('open-graph', handler);
        return () => electron_1.ipcRenderer.removeListener('open-graph', handler);
    },
    /** Listen for menu action events */
    onMenuAction: (callback) => {
        const handler = (_event, action) => callback(action);
        electron_1.ipcRenderer.on('menu-action', handler);
        return () => electron_1.ipcRenderer.removeListener('menu-action', handler);
    },
    /** Listen for update status events */
    onUpdateStatus: (callback) => {
        const handler = (_event, status) => callback(status);
        electron_1.ipcRenderer.on('update-status', handler);
        return () => electron_1.ipcRenderer.removeListener('update-status', handler);
    },
});
// ============ Legacy Cascade API ============
// Keep existing API for backwards compatibility
electron_1.contextBridge.exposeInMainWorld('cascade', {
    // ============ Platform Detection ============
    /** Operating system platform */
    platform: process.platform,
    /** Whether running in Electron */
    isElectron: true,
    // ============ App Info ============
    /** Get app version */
    getVersion: () => electron_1.ipcRenderer.invoke('app:getVersion'),
    /** Get app name */
    getName: () => electron_1.ipcRenderer.invoke('app:getName'),
    /** Get app paths (home, userData, temp, etc.) */
    getPath: (name) => electron_1.ipcRenderer.invoke('app:getPath', name),
    // ============ Native Dialogs ============
    /** Show native save dialog */
    showSaveDialog: (options) => electron_1.ipcRenderer.invoke('dialog:showSave', options),
    /** Show native open dialog */
    showOpenDialog: (options) => electron_1.ipcRenderer.invoke('dialog:showOpen', options),
    // ============ Window Controls ============
    /** Minimize window */
    minimize: () => electron_1.ipcRenderer.send('window:minimize'),
    /** Maximize/restore window */
    maximize: () => electron_1.ipcRenderer.send('window:maximize'),
    /** Close window */
    close: () => electron_1.ipcRenderer.send('window:close'),
    // ============ Shell Operations ============
    /** Reveal file in system file manager */
    showItemInFolder: (filePath) => electron_1.ipcRenderer.send('shell:showItemInFolder', filePath),
    /** Open URL in default browser */
    openExternal: (url) => electron_1.ipcRenderer.send('shell:openExternal', url),
    // ============ Project Operations ============
    /** Notify main process that a project was opened (for recent documents) */
    notifyProjectOpened: (projectPath) => electron_1.ipcRenderer.send('project:opened', projectPath),
    // ============ File System ============
    /** Check if a file exists */
    fileExists: (filePath) => electron_1.ipcRenderer.invoke('fs:fileExists', filePath),
    /** Write content to a file */
    writeFile: (filePath, content) => electron_1.ipcRenderer.invoke('fs:writeFile', filePath, content),
    // ============ Event Listeners ============
    /** Listen for menu commands */
    onMenuCommand: (channel, callback) => {
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
            electron_1.ipcRenderer.on(channel, (_event, ...args) => callback(...args));
        }
    },
    /** Remove menu command listener */
    removeMenuListener: (channel) => {
        electron_1.ipcRenderer.removeAllListeners(channel);
    },
    /** Listen for file open events (from file associations) */
    onFileOpen: (callback) => {
        electron_1.ipcRenderer.on('file:open', (_event, filePath) => callback(filePath));
    },
    /** Listen for deep link events */
    onDeepLink: (callback) => {
        electron_1.ipcRenderer.on('deeplink:open', (_event, data) => callback('open', data));
        electron_1.ipcRenderer.on('deeplink:new', (_event, data) => callback('new', data));
    },
});
