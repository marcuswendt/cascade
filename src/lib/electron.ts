/**
 * Electron Integration Utilities
 *
 * Provides graceful fallbacks for browser mode when not running in Electron.
 * All functions are safe to call in both Electron and browser environments.
 */

/**
 * Whether the app is running in Electron
 */
export const isElectron = typeof window !== 'undefined' && !!window.cascade?.isElectron;

/**
 * Current platform: 'darwin', 'win32', 'linux', or 'web'
 */
export const platform = window.cascade?.platform ?? 'web';

/**
 * Whether running on macOS
 */
export const isMac = platform === 'darwin';

/**
 * Whether running on Windows
 */
export const isWindows = platform === 'win32';

/**
 * Whether running on Linux
 */
export const isLinux = platform === 'linux';

// ============ App Info ============

/**
 * Get the app version
 * Returns 'dev' in browser mode
 */
export async function getAppVersion(): Promise<string> {
  if (isElectron) {
    return window.cascade!.getVersion();
  }
  return 'dev';
}

/**
 * Get the app name
 * Returns 'Cascade' in browser mode
 */
export async function getAppName(): Promise<string> {
  if (isElectron) {
    return window.cascade!.getName();
  }
  return 'Cascade';
}

// ============ Native Dialogs ============

export interface SaveDialogOptions {
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  title?: string;
}

export interface OpenDialogOptions {
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  properties?: Array<'openFile' | 'openDirectory' | 'multiSelections' | 'createDirectory'>;
  title?: string;
}

/**
 * Show native save dialog
 *
 * In browser mode, returns null - caller should use download approach
 */
export async function showSaveDialog(options: SaveDialogOptions): Promise<string | null> {
  if (isElectron) {
    const result = await window.cascade!.showSaveDialog(options);
    return result.canceled ? null : (result.filePath ?? null);
  }
  // Browser fallback: return null, let caller use download approach
  return null;
}

/**
 * Show native open dialog
 *
 * In browser mode, returns null - caller should use input[type=file]
 */
export async function showOpenDialog(options: OpenDialogOptions): Promise<string[] | null> {
  if (isElectron) {
    const result = await window.cascade!.showOpenDialog(options);
    return result.canceled ? null : result.filePaths;
  }
  // Browser fallback: return null, let caller use input[type=file]
  return null;
}

// ============ Shell Operations ============

/**
 * Reveal file in system file manager (Finder/Explorer)
 *
 * No-op in browser mode
 */
export function showInFolder(filePath: string): void {
  if (isElectron) {
    window.cascade!.showItemInFolder(filePath);
  }
}

/**
 * Open URL in default browser
 *
 * In browser mode, opens in new tab
 */
export function openExternal(url: string): void {
  if (isElectron) {
    window.cascade!.openExternal(url);
  } else {
    window.open(url, '_blank');
  }
}

// ============ Project Operations ============

/**
 * Notify that a project was opened (for recent documents)
 *
 * No-op in browser mode
 */
export function notifyProjectOpened(projectPath: string): void {
  if (isElectron) {
    window.cascade!.notifyProjectOpened(projectPath);
  }
}

// ============ Menu Commands ============

type MenuCommandCallback = (...args: any[]) => void;
const menuListeners = new Map<string, MenuCommandCallback>();

/**
 * Listen for menu commands from main process
 *
 * Returns unsubscribe function
 */
export function onMenuCommand(command: string, callback: MenuCommandCallback): () => void {
  if (!isElectron) {
    // No menu commands in browser mode
    return () => {};
  }

  // Store callback for potential cleanup
  menuListeners.set(command, callback);

  // Register with preload
  window.cascade!.onMenuCommand(`menu:${command}`, callback);

  return () => {
    menuListeners.delete(command);
    window.cascade!.removeMenuListener(`menu:${command}`);
  };
}

/**
 * Subscribe to all menu commands with a single handler
 */
export function onAnyMenuCommand(
  handler: (command: string, ...args: any[]) => void
): () => void {
  const commands = [
    'preferences',
    'newProject',
    'openProject',
    'save',
    'saveAs',
    'exportHTML',
    'runAll',
    'stopAll',
    'homeView',
    'frameSelection',
    'selectAll',
    'deleteSelected',
    'showShortcuts',
    'about',
  ];

  const unsubscribers = commands.map(cmd =>
    onMenuCommand(cmd, (...args) => handler(cmd, ...args))
  );

  return () => unsubscribers.forEach(unsub => unsub());
}

// ============ File Open Events ============

/**
 * Listen for file open events (from file associations or recent documents)
 *
 * Returns unsubscribe function
 */
export function onFileOpen(callback: (filePath: string) => void): () => void {
  if (!isElectron) {
    return () => {};
  }

  window.cascade!.onFileOpen(callback);

  // Note: Current preload doesn't support removing this listener
  // In a full implementation, we'd add removeFileOpenListener
  return () => {};
}

// ============ Deep Links ============

export type DeepLinkAction = 'open' | 'new';

export interface DeepLinkOpenData {
  path?: string;
  name?: string;
}

export interface DeepLinkNewData {
  template?: string;
}

/**
 * Listen for deep link events (cascade:// URLs)
 *
 * Returns unsubscribe function
 */
export function onDeepLink(
  callback: (action: DeepLinkAction, data: DeepLinkOpenData | DeepLinkNewData) => void
): () => void {
  if (!isElectron) {
    return () => {};
  }

  window.cascade!.onDeepLink(callback);

  return () => {};
}

// ============ Window Controls ============

/**
 * Minimize the window
 *
 * No-op in browser mode
 */
export function minimizeWindow(): void {
  if (isElectron) {
    window.cascade!.minimize();
  }
}

/**
 * Maximize/restore the window
 *
 * No-op in browser mode
 */
export function maximizeWindow(): void {
  if (isElectron) {
    window.cascade!.maximize();
  }
}

/**
 * Close the window
 *
 * In browser mode, attempts to close the tab
 */
export function closeWindow(): void {
  if (isElectron) {
    window.cascade!.close();
  } else {
    window.close();
  }
}

// ============ Keyboard Shortcut Helpers ============

/**
 * Get the correct modifier key for the platform
 */
export function getModifierKey(): string {
  return isMac ? '⌘' : 'Ctrl';
}

/**
 * Format a keyboard shortcut for display
 */
export function formatShortcut(shortcut: string): string {
  if (isMac) {
    return shortcut
      .replace('CmdOrCtrl', '⌘')
      .replace('Ctrl', '⌃')
      .replace('Alt', '⌥')
      .replace('Shift', '⇧')
      .replace(/\+/g, '');
  }
  return shortcut.replace('CmdOrCtrl', 'Ctrl');
}
