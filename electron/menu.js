"use strict";
/**
 * Native Menu Configuration
 *
 * Creates the native application menu with Cascade-specific items.
 * Integrates with the renderer via IPC for menu command handling.
 * Supports dynamic "Open Recent" submenu with project folders.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMenu = createMenu;
exports.updateRecentMenu = updateRecentMenu;
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
// Store handlers globally so updateRecentMenu can access them
let storedHandlers = {};
// Store recent items globally for menu updates
let storedRecentFolders = [];
let storedRecentFiles = [];
/**
 * Create and set the application menu
 *
 * @param mainWindow - The main BrowserWindow
 * @param recentFolders - Array of recent project folder paths
 * @param recentFiles - Array of recent file paths
 * @param handlers - Optional handlers for file operations
 */
function createMenu(mainWindow, recentFolders = [], recentFiles = [], handlers = {}) {
    storedHandlers = { ...storedHandlers, ...handlers };
    storedRecentFolders = recentFolders;
    storedRecentFiles = recentFiles;
    const template = buildMenuTemplate(mainWindow, recentFolders, recentFiles, storedHandlers);
    electron_1.Menu.setApplicationMenu(electron_1.Menu.buildFromTemplate(template));
}
/**
 * Update the recent folders and files submenu
 *
 * @param mainWindow - The main BrowserWindow
 * @param recentFolders - Updated array of recent project folder paths
 * @param recentFiles - Updated array of recent file paths
 */
function updateRecentMenu(mainWindow, recentFolders, recentFiles) {
    createMenu(mainWindow, recentFolders, recentFiles, storedHandlers);
}
/**
 * Build the menu template
 */
function buildMenuTemplate(mainWindow, recentFolders, recentFiles, handlers) {
    const isMac = process.platform === 'darwin';
    // Build recent submenu with both projects and files
    const recentSubmenu = [];
    // Add recent projects section
    if (recentFolders.length > 0) {
        recentSubmenu.push({ label: 'Projects', enabled: false });
        recentSubmenu.push(...recentFolders.slice(0, 10).map(folder => ({
            label: path_1.default.basename(folder),
            sublabel: folder,
            click: () => handlers.onOpenRecentFolder?.(folder),
        })));
    }
    // Add recent files section
    if (recentFiles.length > 0) {
        if (recentFolders.length > 0) {
            recentSubmenu.push({ type: 'separator' });
        }
        recentSubmenu.push({ label: 'Files', enabled: false });
        recentSubmenu.push(...recentFiles.slice(0, 10).map(file => ({
            label: path_1.default.basename(file),
            sublabel: file,
            click: () => handlers.onOpenRecentFile?.(file),
        })));
    }
    // Add clear option or empty message
    if (recentFolders.length > 0 || recentFiles.length > 0) {
        recentSubmenu.push({ type: 'separator' });
        recentSubmenu.push({
            label: 'Clear Recent',
            click: () => handlers.onClearRecent?.(),
        });
    }
    else {
        recentSubmenu.push({ label: 'No Recent Items', enabled: false });
    }
    return [
        // ============ App Menu (macOS only) ============
        ...(isMac
            ? [
                {
                    label: electron_1.app.name,
                    submenu: [
                        { role: 'about' },
                        { type: 'separator' },
                        {
                            label: 'Preferences...',
                            accelerator: 'CmdOrCtrl+,',
                            click: () => mainWindow.webContents.send('menu:preferences'),
                        },
                        { type: 'separator' },
                        {
                            label: 'Check for Updates...',
                            click: () => mainWindow.webContents.send('menu:checkUpdates'),
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
                    label: 'New Project...',
                    accelerator: 'CmdOrCtrl+Shift+N',
                    click: () => handlers.onNewProject?.(),
                },
                {
                    label: 'New Graph',
                    accelerator: 'CmdOrCtrl+N',
                    click: () => mainWindow.webContents.send('menu:newGraph'),
                },
                { type: 'separator' },
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
                    label: isMac ? 'Reveal in Finder' : 'Show in Explorer',
                    accelerator: 'CmdOrCtrl+Shift+R',
                    click: () => mainWindow.webContents.send('menu:revealInFinder'),
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
                {
                    label: 'Delete',
                    accelerator: 'Backspace',
                    click: () => mainWindow.webContents.send('menu:deleteSelected'),
                },
                { type: 'separator' },
                {
                    label: 'Select All',
                    accelerator: 'CmdOrCtrl+A',
                    click: () => mainWindow.webContents.send('menu:selectAll'),
                },
                ...(isMac
                    ? [
                        { type: 'separator' },
                        {
                            label: 'Speech',
                            submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }],
                        },
                    ]
                    : []),
            ],
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
                { type: 'separator' },
                {
                    label: 'Maximize Tab',
                    accelerator: 'CmdOrCtrl+B',
                    click: () => mainWindow.webContents.send('menu:maximizeTab'),
                },
                { type: 'separator' },
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
                { type: 'separator' },
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
        // ============ Create Menu (Cascade-specific) ============
        {
            label: 'Create',
            submenu: [
                {
                    label: 'Create Node...',
                    accelerator: 'Tab',
                    click: () => mainWindow.webContents.send('menu:createNode'),
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
                    click: () => electron_1.shell.openExternal('https://cascade.dev/docs'),
                },
                {
                    label: 'Keyboard Shortcuts',
                    accelerator: 'CmdOrCtrl+/',
                    click: () => mainWindow.webContents.send('menu:showShortcuts'),
                },
                { type: 'separator' },
                {
                    label: 'Report Issue',
                    click: () => electron_1.shell.openExternal('https://github.com/field-io/cascade/issues'),
                },
                {
                    label: 'View on GitHub',
                    click: () => electron_1.shell.openExternal('https://github.com/field-io/cascade'),
                },
                ...(isMac
                    ? []
                    : [
                        { type: 'separator' },
                        {
                            label: 'Check for Updates...',
                            click: () => mainWindow.webContents.send('menu:checkUpdates'),
                        },
                        { type: 'separator' },
                        {
                            label: 'About Cascade',
                            click: () => mainWindow.webContents.send('menu:about'),
                        },
                    ]),
            ],
        },
    ];
}
