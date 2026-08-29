/**
 * Preferences Manager
 *
 * Manages global app preferences stored in ~/.cascade/
 * - preferences.json: App settings (theme, editor config, window bounds)
 * - recent.json: Recently opened project folders
 * - credentials.yaml: AI API keys (never stored in projects)
 */

import { app } from 'electron';
import path from 'path';
import fs from 'fs';

// YAML parsing - simple implementation for credentials
function parseYaml(content: string): Record<string, any> {
  const result: Record<string, any> = {};
  const lines = content.split('\n');
  let currentSection = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Check for section header (no leading whitespace, ends with :)
    if (!line.startsWith(' ') && !line.startsWith('\t') && trimmed.endsWith(':') && !trimmed.includes(': ')) {
      currentSection = trimmed.slice(0, -1);
      result[currentSection] = {};
    } else if (currentSection && trimmed.includes(':')) {
      // Key-value pair within a section
      const colonIndex = trimmed.indexOf(':');
      const key = trimmed.slice(0, colonIndex).trim();
      let value = trimmed.slice(colonIndex + 1).trim();

      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      result[currentSection][key] = value;
    } else if (!currentSection && trimmed.includes(':')) {
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

function stringifyYaml(obj: Record<string, any>): string {
  const lines: string[] = ['# AI API keys - stored globally, never in project folders'];

  for (const [section, value] of Object.entries(obj)) {
    if (typeof value === 'object' && value !== null) {
      lines.push(`${section}:`);
      for (const [key, val] of Object.entries(value)) {
        lines.push(`  ${key}: ${val}`);
      }
    } else {
      lines.push(`${section}: ${value}`);
    }
  }

  return lines.join('\n') + '\n';
}

export interface RecentFolder {
  path: string;
  lastOpened: string;
}

export interface RecentFile {
  path: string;
  projectPath: string;
  lastOpened: string;
}

export interface WindowBounds {
  width: number;
  height: number;
  x?: number;
  y?: number;
}

export class PreferencesManager {
  private dataDir: string;
  private prefsPath: string;
  private recentPath: string;
  private credentialsPath: string;
  private prefs: Record<string, any> = {};
  private recent: { folders: RecentFolder[]; files: RecentFile[] } = { folders: [], files: [] };

  constructor() {
    this.dataDir = path.join(app.getPath('home'), '.cascade');
    this.prefsPath = path.join(this.dataDir, 'preferences.json');
    this.recentPath = path.join(this.dataDir, 'recent.json');
    this.credentialsPath = path.join(this.dataDir, 'credentials.yaml');

    this.ensureDataDir();
    this.load();
  }

  private ensureDataDir(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  private load(): void {
    // Load preferences
    try {
      if (fs.existsSync(this.prefsPath)) {
        this.prefs = JSON.parse(fs.readFileSync(this.prefsPath, 'utf-8'));
      }
    } catch (e) {
      console.error('[Preferences] Failed to load preferences:', e);
    }

    // Load recent folders and files
    try {
      if (fs.existsSync(this.recentPath)) {
        const data = JSON.parse(fs.readFileSync(this.recentPath, 'utf-8'));
        this.recent = {
          folders: data.folders || [],
          files: data.files || [],
        };
      }
    } catch (e) {
      console.error('[Preferences] Failed to load recent:', e);
    }
  }

  // ============ Preferences ============

  get<T>(key: string, defaultValue?: T): T {
    return this.prefs[key] ?? defaultValue;
  }

  set(key: string, value: any): void {
    this.prefs[key] = value;
    this.savePrefs();
  }

  getAll(): Record<string, any> {
    return { ...this.prefs };
  }

  private savePrefs(): void {
    try {
      fs.writeFileSync(this.prefsPath, JSON.stringify(this.prefs, null, 2));
    } catch (e) {
      console.error('[Preferences] Failed to save preferences:', e);
    }
  }

  // ============ Recent Folders ============

  getRecentFolders(): string[] {
    return this.recent.folders
      .sort((a, b) => new Date(b.lastOpened).getTime() - new Date(a.lastOpened).getTime())
      .map(f => f.path)
      .filter(p => fs.existsSync(p));
  }

  getRecentFoldersWithMeta(): RecentFolder[] {
    return this.recent.folders
      .filter(f => fs.existsSync(f.path))
      .sort((a, b) => new Date(b.lastOpened).getTime() - new Date(a.lastOpened).getTime());
  }

  getLastFolder(): string | null {
    const folders = this.getRecentFolders();
    return folders[0] || null;
  }

  addRecentFolder(folderPath: string): void {
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

  clearRecentFolders(): void {
    this.recent.folders = [];
    this.saveRecent();
  }

  // ============ Recent Files ============

  getRecentFiles(): string[] {
    return this.recent.files
      .sort((a, b) => new Date(b.lastOpened).getTime() - new Date(a.lastOpened).getTime())
      .map(f => f.path)
      .filter(p => fs.existsSync(p));
  }

  getRecentFilesWithMeta(): RecentFile[] {
    return this.recent.files
      .filter(f => fs.existsSync(f.path))
      .sort((a, b) => new Date(b.lastOpened).getTime() - new Date(a.lastOpened).getTime());
  }

  addRecentFile(filePath: string, projectPath: string): void {
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

  clearRecentFiles(): void {
    this.recent.files = [];
    this.saveRecent();
  }

  clearAllRecent(): void {
    this.recent.folders = [];
    this.recent.files = [];
    this.saveRecent();
  }

  private saveRecent(): void {
    try {
      fs.writeFileSync(this.recentPath, JSON.stringify(this.recent, null, 2));
    } catch (e) {
      console.error('[Preferences] Failed to save recent:', e);
    }
  }

  // ============ Credentials ============

  getCredentials(): Record<string, any> {
    try {
      if (fs.existsSync(this.credentialsPath)) {
        const content = fs.readFileSync(this.credentialsPath, 'utf-8');
        return parseYaml(content);
      }
    } catch (e) {
      console.error('[Preferences] Failed to load credentials:', e);
    }
    return {};
  }

  setCredentials(credentials: Record<string, any>): void {
    try {
      fs.writeFileSync(this.credentialsPath, stringifyYaml(credentials));
    } catch (e) {
      console.error('[Preferences] Failed to save credentials:', e);
    }
  }

  // ============ Window Bounds ============

  getWindowBounds(): WindowBounds {
    return this.get<WindowBounds>('window', { width: 1400, height: 900 });
  }

  setWindowBounds(bounds: WindowBounds): void {
    this.set('window', bounds);
  }
}
