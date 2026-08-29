/**
 * Native Menu Configuration
 *
 * Creates the native application menu with Cascade-specific items.
 * Integrates with the renderer via IPC for menu command handling.
 * Supports dynamic "Open Recent" submenu with project folders.
 */

import { app, Menu, BrowserWindow, shell, MenuItemConstructorOptions } from 'electron';
import path from 'path';

/**
 * Menu handlers for file operations
 */
export interface MenuHandlers {
  onNewProject?: () => void;
  onOpen?: () => void;
  onOpenFolder?: () => void;
  onOpenRecentFolder?: (folderPath: string) => void;
  onOpenRecentFile?: (filePath: string) => void;
  onClearRecent?: () => void;
}

// Store handlers globally so updateRecentMenu can access them
let storedHandlers: MenuHandlers = {};

// Store recent items globally for menu updates
let storedRecentFolders: string[] = [];
let storedRecentFiles: string[] = [];

/**
 * Create and set the application menu
 *
 * @param mainWindow - The main BrowserWindow
 * @param recentFolders - Array of recent project folder paths
 * @param recentFiles - Array of recent file paths
 * @param handlers - Optional handlers for file operations
 */
export function createMenu(
  mainWindow: BrowserWindow,
  recentFolders: string[] = [],
  recentFiles: string[] = [],
  handlers: MenuHandlers = {}
): void {
  storedHandlers = { ...storedHandlers, ...handlers };
  storedRecentFolders = recentFolders;
  storedRecentFiles = recentFiles;
  const template = buildMenuTemplate(mainWindow, recentFolders, recentFiles, storedHandlers);
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * Update the recent folders and files submenu
 *
 * @param mainWindow - The main BrowserWindow
 * @param recentFolders - Updated array of recent project folder paths
 * @param recentFiles - Updated array of recent file paths
 */
export function updateRecentMenu(
  mainWindow: BrowserWindow,
  recentFolders: string[],
  recentFiles: string[]
): void {
  createMenu(mainWindow, recentFolders, recentFiles, storedHandlers);
}

/**
 * Build the menu template
 */
function buildMenuTemplate(
  mainWindow: BrowserWindow,
  recentFolders: string[],
  recentFiles: string[],
  handlers: MenuHandlers
): MenuItemConstructorOptions[] {
  const isMac = process.platform === 'darwin';

  // Build recent submenu with both projects and files
  const recentSubmenu: MenuItemConstructorOptions[] = [];

  // Add recent projects section
  if (recentFolders.length > 0) {
    recentSubmenu.push({ label: 'Projects', enabled: false });
    recentSubmenu.push(
      ...recentFolders.slice(0, 10).map(folder => ({
        label: path.basename(folder),
        sublabel: folder,
        click: () => handlers.onOpenRecentFolder?.(folder),
      }))
    );
  }

  // Add recent files section
  if (recentFiles.length > 0) {
    if (recentFolders.length > 0) {
      recentSubmenu.push({ type: 'separator' as const });
    }
    recentSubmenu.push({ label: 'Files', enabled: false });
    recentSubmenu.push(
      ...recentFiles.slice(0, 10).map(file => ({
        label: path.basename(file),
        sublabel: file,
        click: () => handlers.onOpenRecentFile?.(file),
      }))
    );
  }

  // Add clear option or empty message
  if (recentFolders.length > 0 || recentFiles.length > 0) {
    recentSubmenu.push({ type: 'separator' as const });
    recentSubmenu.push({
      label: 'Clear Recent',
      click: () => handlers.onClearRecent?.(),
    });
  } else {
    recentSubmenu.push({ label: 'No Recent Items', enabled: false });
  }

  return [
    // ============ App Menu (macOS only) ============
    ...(isMac
      ? [
          {
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
              {
                label: 'Check for Updates...',
                click: () => mainWindow.webContents.send('menu:checkUpdates'),
              },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ] as MenuItemConstructorOptions[],
          },
        ]
      : []),

    // ============ File Menu ============
    {
      label: 'File',
      submenu: [
        {
          label: 'New Project...',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => handlers.onNewProject?.(),
        },
        {
          label: 'New Graph',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow.webContents.send('menu:newGraph'),
        },
        { type: 'separator' as const },
        {
          label: 'Open...',
          accelerator: 'CmdOrCtrl+O',
          click: () => handlers.onOpen?.(),
        },
        {
          label: 'Open Folder...',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => handlers.onOpenFolder?.(),
        },
        {
          label: 'Open Recent',
          submenu: recentSubmenu,
        },
        { type: 'separator' as const },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow.webContents.send('menu:save'),
        },
        {
          label: 'Save As...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => mainWindow.webContents.send('menu:saveAs'),
        },
        { type: 'separator' as const },
        {
          label: isMac ? 'Reveal in Finder' : 'Show in Explorer',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => mainWindow.webContents.send('menu:revealInFinder'),
        },
        { type: 'separator' as const },
        {
          label: 'Export as HTML...',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => mainWindow.webContents.send('menu:exportHTML'),
        },
        { type: 'separator' as const },
        isMac ? { role: 'close' as const } : { role: 'quit' as const },
      ] as MenuItemConstructorOptions[],
    },

    // ============ Edit Menu ============
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        {
          label: 'Delete',
          accelerator: 'Backspace',
          click: () => mainWindow.webContents.send('menu:deleteSelected'),
        },
        { type: 'separator' as const },
        {
          label: 'Select All',
          accelerator: 'CmdOrCtrl+A',
          click: () => mainWindow.webContents.send('menu:selectAll'),
        },
        ...(isMac
          ? [
              { type: 'separator' as const },
              {
                label: 'Speech',
                submenu: [{ role: 'startSpeaking' as const }, { role: 'stopSpeaking' as const }],
              },
            ]
          : []),
      ] as MenuItemConstructorOptions[],
    },

    // ============ View Menu ============
    {
      label: 'View',
      submenu: [
        {
          label: 'Home',
          accelerator: 'H',
          click: () => mainWindow.webContents.send('menu:centerOnNodes'),
        },
        {
          label: 'Frame Selection',
          accelerator: 'F',
          click: () => mainWindow.webContents.send('menu:frameSelection'),
        },
        {
          label: 'Reset Layout',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => mainWindow.webContents.send('menu:resetLayout'),
        },
        { type: 'separator' as const },
        {
          label: 'Maximize Tab',
          accelerator: 'CmdOrCtrl+B',
          click: () => mainWindow.webContents.send('menu:maximizeTab'),
        },
        { type: 'separator' as const },
        {
          label: 'Focus Graph',
          accelerator: 'CmdOrCtrl+1',
          click: () => mainWindow.webContents.send('menu:focusGraph'),
        },
        {
          label: 'Focus Viewer',
          accelerator: 'CmdOrCtrl+2',
          click: () => mainWindow.webContents.send('menu:focusViewer'),
        },
        {
          label: 'Focus Inspector',
          accelerator: 'CmdOrCtrl+3',
          click: () => mainWindow.webContents.send('menu:focusInspector'),
        },
        {
          label: 'Focus Log',
          accelerator: 'CmdOrCtrl+4',
          click: () => mainWindow.webContents.send('menu:focusLog'),
        },
        { type: 'separator' as const },
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        { role: 'toggleDevTools' as const },
        { type: 'separator' as const },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const },
      ] as MenuItemConstructorOptions[],
    },

    // ============ Create Menu (Cascade-specific) ============
    {
      label: 'Create',
      submenu: [
        {
          label: 'Create Node...',
          accelerator: 'Tab',
          click: () => mainWindow.webContents.send('menu:createNode'),
        },
      ] as MenuItemConstructorOptions[],
    },

    // ============ Window Menu ============
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const },
              { type: 'separator' as const },
              { role: 'window' as const },
            ]
          : [{ role: 'close' as const }]),
      ] as MenuItemConstructorOptions[],
    },

    // ============ Help Menu ============
    {
      label: 'Help',
      submenu: [
        {
          label: 'Documentation',
          click: () => shell.openExternal('https://cascade.dev/docs'),
        },
        {
          label: 'Keyboard Shortcuts',
          accelerator: 'CmdOrCtrl+/',
          click: () => mainWindow.webContents.send('menu:showShortcuts'),
        },
        { type: 'separator' as const },
        {
          label: 'Report Issue',
          click: () => shell.openExternal('https://github.com/field-io/cascade/issues'),
        },
        {
          label: 'View on GitHub',
          click: () => shell.openExternal('https://github.com/field-io/cascade'),
        },
        ...(isMac
          ? []
          : [
              { type: 'separator' as const },
              {
                label: 'Check for Updates...',
                click: () => mainWindow.webContents.send('menu:checkUpdates'),
              },
              { type: 'separator' as const },
              {
                label: 'About Cascade',
                click: () => mainWindow.webContents.send('menu:about'),
              },
            ]),
      ] as MenuItemConstructorOptions[],
    },
  ];
}

/**
 * Menu state for dynamic updates
 */
export interface MenuState {
  hasProject?: boolean;
  hasSelection?: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
}
