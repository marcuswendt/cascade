/**
 * Native Menu Configuration
 *
 * Creates the native application menu with Cascade-specific items.
 * Integrates with the renderer via IPC for menu command handling.
 */
import { app, Menu, shell } from 'electron';
/**
 * Create and set the application menu
 */
export function createMenu(mainWindow) {
    const isMac = process.platform === 'darwin';
    const template = [
        // ============ App Menu (macOS only) ============
        ...(isMac
            ? [
                {
                    label: app.name,
                    submenu: [
                        { role: 'about' },
                        { type: 'separator' },
                        {
                            label: 'Preferences...',
                            accelerator: 'CmdOrCtrl+,',
                            click: () => mainWindow.webContents.send('menu:preferences'),
                        },
                        { type: 'separator' },
                        { role: 'services' },
                        { type: 'separator' },
                        { role: 'hide' },
                        { role: 'hideOthers' },
                        { role: 'unhide' },
                        { type: 'separator' },
                        { role: 'quit' },
                    ],
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
                            role: 'recentDocuments',
                            submenu: [
                                {
                                    label: 'Clear Recent',
                                    role: 'clearRecentDocuments',
                                },
                            ],
                        },
                    ]
                    : []),
                { type: 'separator' },
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
                { type: 'separator' },
                {
                    label: 'Export as HTML...',
                    accelerator: 'CmdOrCtrl+Shift+E',
                    click: () => mainWindow.webContents.send('menu:exportHTML'),
                },
                { type: 'separator' },
                isMac ? { role: 'close' } : { role: 'quit' },
            ],
        },
        // ============ Edit Menu ============
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'delete' },
                { type: 'separator' },
                { role: 'selectAll' },
                ...(isMac
                    ? [
                        { type: 'separator' },
                        {
                            label: 'Speech',
                            submenu: [
                                { role: 'startSpeaking' },
                                { role: 'stopSpeaking' },
                            ],
                        },
                    ]
                    : []),
            ],
        },
        // ============ View Menu ============
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' },
            ],
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
                { type: 'separator' },
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
                { type: 'separator' },
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
            ],
        },
        // ============ Window Menu ============
        {
            label: 'Window',
            submenu: [
                { role: 'minimize' },
                { role: 'zoom' },
                ...(isMac
                    ? [
                        { type: 'separator' },
                        { role: 'front' },
                        { type: 'separator' },
                        { role: 'window' },
                    ]
                    : [{ role: 'close' }]),
            ],
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
                { type: 'separator' },
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
                        { type: 'separator' },
                        {
                            label: 'About Cascade',
                            click: () => mainWindow.webContents.send('menu:about'),
                        },
                    ]),
            ],
        },
    ];
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}
/**
 * Update the menu (useful for enabling/disabling items based on state)
 */
export function updateMenu(mainWindow, state) {
    // Could implement dynamic menu updates based on app state
    // For now, just rebuild the menu
    createMenu(mainWindow);
}
