"use strict";
/**
 * Electron Preload Script
 *
 * Provides a secure bridge between the renderer process and main process.
 * Only exposes specific, safe APIs to the renderer via contextBridge.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// Expose protected methods that allow the renderer process to use
// specific Electron features without exposing the full API
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
            'menu:save',
            'menu:saveAs',
            'menu:exportHTML',
            'menu:createNode',
            'menu:runAll',
            'menu:stopAll',
            'menu:homeView',
            'menu:frameSelection',
            'menu:selectAll',
            'menu:deleteSelected',
            'menu:showShortcuts',
            'menu:about',
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
