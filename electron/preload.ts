/**
 * Electron Preload Script
 *
 * Provides a secure bridge between the renderer process and main process.
 * Only exposes specific, safe APIs to the renderer via contextBridge.
 */

import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// specific Electron features without exposing the full API
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

// TypeScript declaration for the exposed API
declare global {
  interface Window {
    cascade?: {
      // Platform
      platform: NodeJS.Platform;
      isElectron: boolean;

      // App info
      getVersion: () => Promise<string>;
      getName: () => Promise<string>;
      getPath: (name: string) => Promise<string>;

      // Dialogs
      showSaveDialog: (options: {
        defaultPath?: string;
        filters?: Array<{ name: string; extensions: string[] }>;
        title?: string;
      }) => Promise<{ canceled: boolean; filePath?: string }>;

      showOpenDialog: (options: {
        defaultPath?: string;
        filters?: Array<{ name: string; extensions: string[] }>;
        properties?: Array<'openFile' | 'openDirectory' | 'multiSelections' | 'createDirectory'>;
        title?: string;
      }) => Promise<{ canceled: boolean; filePaths: string[] }>;

      // Window
      minimize: () => void;
      maximize: () => void;
      close: () => void;

      // Shell
      showItemInFolder: (filePath: string) => void;
      openExternal: (url: string) => void;

      // Project
      notifyProjectOpened: (projectPath: string) => void;

      // File System
      fileExists: (filePath: string) => Promise<boolean>;
      writeFile: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>;

      // Events
      onMenuCommand: (channel: string, callback: (...args: any[]) => void) => void;
      removeMenuListener: (channel: string) => void;
      onFileOpen: (callback: (filePath: string) => void) => void;
      onDeepLink: (callback: (action: string, data: any) => void) => void;
    };
  }
}

export {};
