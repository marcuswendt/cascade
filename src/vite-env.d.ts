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

// Electron preload API
interface CascadeElectronAPI {
  isElectron: boolean;
  platform: 'darwin' | 'win32' | 'linux';
  getVersion(): Promise<string>;
  getName(): Promise<string>;
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
  onMenuCommand(channel: string, callback: (...args: any[]) => void): void;
  removeMenuListener(channel: string): void;
  onFileOpen(callback: (filePath: string) => void): void;
  onDeepLink(callback: (action: 'open' | 'new', data: { path?: string; name?: string; template?: string }) => void): void;
  minimize(): void;
  maximize(): void;
  close(): void;
}

declare global {
  interface Window {
    cascade?: CascadeElectronAPI;
  }
}

export {};
