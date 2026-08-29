/// <reference types="vite/client" />

// Vite ?raw import support
declare module '*.ts?raw' {
  const content: string;
  export default content;
}

declare module '*.js?raw' {
  const content: string;
  export default content;
}

// Electron preload API (legacy cascade namespace)
interface CascadeElectronAPI {
  isElectron: boolean;
  platform: 'darwin' | 'win32' | 'linux';
  getVersion(): Promise<string>;
  getName(): Promise<string>;
  getPath(name: string): Promise<string>;
  showSaveDialog(options: {
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
    title?: string;
  }): Promise<{ canceled: boolean; filePath?: string }>;
  showOpenDialog(options: {
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
    properties?: Array<'openFile' | 'openDirectory' | 'multiSelections' | 'createDirectory'>;
    title?: string;
  }): Promise<{ canceled: boolean; filePaths: string[] }>;
  showItemInFolder(path: string): void;
  openExternal(url: string): void;
  notifyProjectOpened(path: string): void;
  fileExists(filePath: string): Promise<boolean>;
  writeFile(filePath: string, content: string): Promise<{ success: boolean; error?: string }>;
  onMenuCommand(channel: string, callback: (...args: any[]) => void): void;
  removeMenuListener(channel: string): void;
  onFileOpen(callback: (filePath: string) => void): void;
  onDeepLink(callback: (action: 'open' | 'new', data: { path?: string; name?: string; template?: string }) => void): void;
  minimize(): void;
  maximize(): void;
  close(): void;
}

// Modern cascadeElectron API
interface CascadeElectronLocalAPI {
  // Project management
  openFolderDialog: () => Promise<string | null>;
  openGraphDialog: () => Promise<{ projectPath: string; graphSlug: string } | null>;
  createNewProject: () => Promise<string | null>;
  getCurrentProject: () => Promise<string | null>;
  getCurrentGraph: () => Promise<string | null>;
  setCurrentGraph: (graphPath: string) => Promise<void>;
  getRecentFolders: () => Promise<string[]>;
  getRecentFiles: () => Promise<string[]>;
  revealInFinder: (path: string) => Promise<void>;
  setDocumentDirty: (dirty: boolean) => Promise<void>;

  // Preferences
  getPreferences: () => Promise<Record<string, any>>;
  setPreference: (key: string, value: any) => Promise<void>;
  getCredentials: () => Promise<Record<string, any>>;
  setCredentials: (credentials: Record<string, any>) => Promise<void>;

  // Updates
  checkForUpdates: () => Promise<void>;

  // File system
  fs: {
    readFile: (path: string) => Promise<string>;
    writeFile: (path: string, content: string) => Promise<{ success: boolean; error?: string }>;
    readdir: (path: string) => Promise<Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>>;
    mkdir: (path: string) => Promise<{ success: boolean; error?: string }>;
    unlink: (path: string) => Promise<{ success: boolean; error?: string }>;
    stat: (path: string) => Promise<{ size: number; mtime: string; mtimeMs: number; isDirectory: boolean; isFile: boolean }>;
    exists: (path: string) => Promise<boolean>;
  };

  // Path utilities
  path: {
    join: (...args: string[]) => string;
    dirname: (p: string) => string;
    basename: (p: string, ext?: string) => string;
    extname: (p: string) => string;
  };

  // Event listeners
  onOpenProject: (callback: (path: string) => void) => () => void;
  onOpenGraph: (callback: (slug: string) => void) => () => void;
  onMenuAction: (callback: (action: string) => void) => () => void;
  onUpdateStatus: (callback: (status: any) => void) => () => void;
}

declare global {
  interface Window {
    cascade?: CascadeElectronAPI;
    cascadeElectron?: CascadeElectronLocalAPI;
  }
}

export {};
