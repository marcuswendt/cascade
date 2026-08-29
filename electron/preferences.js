"use strict";
/**
 * Preferences Manager
 *
 * Manages global app preferences stored in ~/.cascade/
 * - preferences.json: App settings (theme, editor config, window bounds)
 * - recent.json: Recently opened project folders
 * - credentials.yaml: AI API keys (never stored in projects)
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PreferencesManager = void 0;
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
// YAML parsing - simple implementation for credentials
function parseYaml(content) {
    const result = {};
    const lines = content.split('\n');
    let currentSection = '';
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#'))
            continue;
        // Check for section header (no leading whitespace, ends with :)
        if (!line.startsWith(' ') && !line.startsWith('\t') && trimmed.endsWith(':') && !trimmed.includes(': ')) {
            currentSection = trimmed.slice(0, -1);
            result[currentSection] = {};
        }
        else if (currentSection && trimmed.includes(':')) {
            // Key-value pair within a section
            const colonIndex = trimmed.indexOf(':');
            const key = trimmed.slice(0, colonIndex).trim();
            let value = trimmed.slice(colonIndex + 1).trim();
            // Remove quotes if present
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            result[currentSection][key] = value;
        }
        else if (!currentSection && trimmed.includes(':')) {
            // Top-level key-value
            const colonIndex = trimmed.indexOf(':');
            const key = trimmed.slice(0, colonIndex).trim();
            let value = trimmed.slice(colonIndex + 1).trim();
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            result[key] = value;
        }
    }
    return result;
}
function stringifyYaml(obj) {
    const lines = ['# AI API keys - stored globally, never in project folders'];
    for (const [section, value] of Object.entries(obj)) {
        if (typeof value === 'object' && value !== null) {
            lines.push(`${section}:`);
            for (const [key, val] of Object.entries(value)) {
                lines.push(`  ${key}: ${val}`);
            }
        }
        else {
            lines.push(`${section}: ${value}`);
        }
    }
    return lines.join('\n') + '\n';
}
class PreferencesManager {
    dataDir;
    prefsPath;
    recentPath;
    credentialsPath;
    prefs = {};
    recent = { folders: [], files: [] };
    constructor() {
        this.dataDir = path_1.default.join(electron_1.app.getPath('home'), '.cascade');
        this.prefsPath = path_1.default.join(this.dataDir, 'preferences.json');
        this.recentPath = path_1.default.join(this.dataDir, 'recent.json');
        this.credentialsPath = path_1.default.join(this.dataDir, 'credentials.yaml');
        this.ensureDataDir();
        this.load();
    }
    ensureDataDir() {
        if (!fs_1.default.existsSync(this.dataDir)) {
            fs_1.default.mkdirSync(this.dataDir, { recursive: true });
        }
    }
    load() {
        // Load preferences
        try {
            if (fs_1.default.existsSync(this.prefsPath)) {
                this.prefs = JSON.parse(fs_1.default.readFileSync(this.prefsPath, 'utf-8'));
            }
        }
        catch (e) {
            console.error('[Preferences] Failed to load preferences:', e);
        }
        // Load recent folders and files
        try {
            if (fs_1.default.existsSync(this.recentPath)) {
                const data = JSON.parse(fs_1.default.readFileSync(this.recentPath, 'utf-8'));
                this.recent = {
                    folders: data.folders || [],
                    files: data.files || [],
                };
            }
        }
        catch (e) {
            console.error('[Preferences] Failed to load recent:', e);
        }
    }
    // ============ Preferences ============
    get(key, defaultValue) {
        return this.prefs[key] ?? defaultValue;
    }
    set(key, value) {
        this.prefs[key] = value;
        this.savePrefs();
    }
    getAll() {
        return { ...this.prefs };
    }
    savePrefs() {
        try {
            fs_1.default.writeFileSync(this.prefsPath, JSON.stringify(this.prefs, null, 2));
        }
        catch (e) {
            console.error('[Preferences] Failed to save preferences:', e);
        }
    }
    // ============ Recent Folders ============
    getRecentFolders() {
        return this.recent.folders
            .sort((a, b) => new Date(b.lastOpened).getTime() - new Date(a.lastOpened).getTime())
            .map(f => f.path)
            .filter(p => fs_1.default.existsSync(p));
    }
    getRecentFoldersWithMeta() {
        return this.recent.folders
            .filter(f => fs_1.default.existsSync(f.path))
            .sort((a, b) => new Date(b.lastOpened).getTime() - new Date(a.lastOpened).getTime());
    }
    getLastFolder() {
        const folders = this.getRecentFolders();
        return folders[0] || null;
    }
    addRecentFolder(folderPath) {
        // Remove if already exists
        this.recent.folders = this.recent.folders.filter(f => f.path !== folderPath);
        // Add to front
        this.recent.folders.unshift({
            path: folderPath,
            lastOpened: new Date().toISOString(),
        });
        // Keep max 20
        this.recent.folders = this.recent.folders.slice(0, 20);
        this.saveRecent();
    }
    clearRecentFolders() {
        this.recent.folders = [];
        this.saveRecent();
    }
    // ============ Recent Files ============
    getRecentFiles() {
        return this.recent.files
            .sort((a, b) => new Date(b.lastOpened).getTime() - new Date(a.lastOpened).getTime())
            .map(f => f.path)
            .filter(p => fs_1.default.existsSync(p));
    }
    getRecentFilesWithMeta() {
        return this.recent.files
            .filter(f => fs_1.default.existsSync(f.path))
            .sort((a, b) => new Date(b.lastOpened).getTime() - new Date(a.lastOpened).getTime());
    }
    addRecentFile(filePath, projectPath) {
        // Remove if already exists
        this.recent.files = this.recent.files.filter(f => f.path !== filePath);
        // Add to front
        this.recent.files.unshift({
            path: filePath,
            projectPath,
            lastOpened: new Date().toISOString(),
        });
        // Keep max 20
        this.recent.files = this.recent.files.slice(0, 20);
        this.saveRecent();
    }
    clearRecentFiles() {
        this.recent.files = [];
        this.saveRecent();
    }
    clearAllRecent() {
        this.recent.folders = [];
        this.recent.files = [];
        this.saveRecent();
    }
    saveRecent() {
        try {
            fs_1.default.writeFileSync(this.recentPath, JSON.stringify(this.recent, null, 2));
        }
        catch (e) {
            console.error('[Preferences] Failed to save recent:', e);
        }
    }
    // ============ Credentials ============
    getCredentials() {
        try {
            if (fs_1.default.existsSync(this.credentialsPath)) {
                const content = fs_1.default.readFileSync(this.credentialsPath, 'utf-8');
                return parseYaml(content);
            }
        }
        catch (e) {
            console.error('[Preferences] Failed to load credentials:', e);
        }
        return {};
    }
    setCredentials(credentials) {
        try {
            fs_1.default.writeFileSync(this.credentialsPath, stringifyYaml(credentials));
        }
        catch (e) {
            console.error('[Preferences] Failed to save credentials:', e);
        }
    }
    // ============ Window Bounds ============
    getWindowBounds() {
        return this.get('window', { width: 1400, height: 900 });
    }
    setWindowBounds(bounds) {
        this.set('window', bounds);
    }
}
exports.PreferencesManager = PreferencesManager;
