/**
 * Native Menu Configuration
 *
 * Creates the native application menu with Cascade-specific items.
 * Integrates with the renderer via IPC for menu command handling.
 */

import { app, Menu, BrowserWindow, shell, MenuItemConstructorOptions } from 'electron';

/**
 * Create and set the application menu
 */
export function createMenu(mainWindow: BrowserWindow): void {
  const isMac = process.platform === 'darwin';

  const template: MenuItemConstructorOptions[] = [
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
          label: 'New Project',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow.webContents.send('menu:newProject'),
        },
        {
          label: 'Open Project...',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow.webContents.send('menu:openProject'),
        },
        // macOS: Native "Open Recent" submenu
        ...(isMac
          ? [
              {
                label: 'Open Recent',
                role: 'recentDocuments' as const,
                submenu: [
                  {
                    label: 'Clear Recent',
                    role: 'clearRecentDocuments' as const,
                  },
                ],
              },
            ]
          : []),
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
        { role: 'delete' as const },
        { type: 'separator' as const },
        { role: 'selectAll' as const },
        ...(isMac
          ? [
              { type: 'separator' as const },
              {
                label: 'Speech',
                submenu: [
                  { role: 'startSpeaking' as const },
                  { role: 'stopSpeaking' as const },
                ],
              },
            ]
          : []),
      ] as MenuItemConstructorOptions[],
    },

    // ============ View Menu ============
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
      ] as MenuItemConstructorOptions[],
    },

    // ============ Graph Menu (Cascade-specific) ============
    {
      label: 'Graph',
      submenu: [
        {
          label: 'Create Node...',
          accelerator: 'Tab',
          click: () => mainWindow.webContents.send('menu:createNode'),
        },
        { type: 'separator' as const },
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
        { type: 'separator' as const },
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
        { type: 'separator' as const },
        {
          label: 'Select All Nodes',
          accelerator: 'CmdOrCtrl+A',
          click: () => mainWindow.webContents.send('menu:selectAll'),
        },
        {
          label: 'Delete Selected',
          accelerator: 'Backspace',
          click: () => mainWindow.webContents.send('menu:deleteSelected'),
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
          click: () => shell.openExternal('https://github.com/cascade/cascade/issues'),
        },
        {
          label: 'View on GitHub',
          click: () => shell.openExternal('https://github.com/cascade/cascade'),
        },
        ...(isMac
          ? []
          : [
              { type: 'separator' as const },
              {
                label: 'About Cascade',
                click: () => mainWindow.webContents.send('menu:about'),
              },
            ]),
      ] as MenuItemConstructorOptions[],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

/**
 * Update the menu (useful for enabling/disabling items based on state)
 */
export function updateMenu(mainWindow: BrowserWindow, state: MenuState): void {
  // Could implement dynamic menu updates based on app state
  // For now, just rebuild the menu
  createMenu(mainWindow);
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
