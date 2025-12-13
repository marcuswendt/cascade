/**
 * FileWatcher - Monitors external project files for changes
 *
 * Provides auto-reload functionality for project source files.
 * Uses polling in browser environments, could use native watchers in Node.js.
 */

import type { FileStatus, ExternalModule } from '../types/node.types.js';

export interface FileChangeEvent {
  modulePath: string;
  filePath: string;
  changeType: 'modified' | 'deleted' | 'created';
  newContent?: string;
}

export interface WatchedFile {
  modulePath: string;
  filePath: string;
  lastContent: string;
  lastModified: number;
  status: FileStatus;
}

export type FileChangeCallback = (event: FileChangeEvent) => void;

export interface FileWatcherConfig {
  pollInterval?: number;  // Polling interval in ms (default: 1000)
  debounceDelay?: number; // Debounce delay for rapid changes (default: 300)
}

export class FileWatcher {
  private watchedFiles: Map<string, WatchedFile> = new Map();
  private callbacks: Set<FileChangeCallback> = new Set();
  private pollInterval: number;
  private debounceDelay: number;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pendingChanges: Map<string, NodeJS.Timeout> = new Map();
  private isRunning: boolean = false;

  // File system functions (injected for platform independence)
  private readFile?: (path: string) => Promise<string | null>;
  private fileExists?: (path: string) => Promise<boolean>;
  private getModifiedTime?: (path: string) => Promise<number>;

  constructor(config: FileWatcherConfig = {}) {
    this.pollInterval = config.pollInterval || 1000;
    this.debounceDelay = config.debounceDelay || 300;
  }

  /**
   * Set file system functions for reading files
   * This allows different implementations for browser vs Node.js
   */
  setFileSystemFunctions(
    readFile: (path: string) => Promise<string | null>,
    fileExists: (path: string) => Promise<boolean>,
    getModifiedTime?: (path: string) => Promise<number>
  ): void {
    this.readFile = readFile;
    this.fileExists = fileExists;
    this.getModifiedTime = getModifiedTime;
  }

  /**
   * Add a file to watch
   */
  async watch(modulePath: string, filePath: string, initialContent: string): Promise<void> {
    const watchedFile: WatchedFile = {
      modulePath,
      filePath,
      lastContent: initialContent,
      lastModified: Date.now(),
      status: 'synced'
    };

    this.watchedFiles.set(modulePath, watchedFile);

    // Start polling if not already running and we have at least one file
    if (!this.isRunning && this.watchedFiles.size > 0) {
      this.start();
    }
  }

  /**
   * Stop watching a file
   */
  unwatch(modulePath: string): void {
    this.watchedFiles.delete(modulePath);

    // Clear any pending debounced changes
    const pending = this.pendingChanges.get(modulePath);
    if (pending) {
      clearTimeout(pending);
      this.pendingChanges.delete(modulePath);
    }

    // Stop polling if no files left to watch
    if (this.watchedFiles.size === 0) {
      this.stop();
    }
  }

  /**
   * Add a callback for file changes
   */
  onChange(callback: FileChangeCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  /**
   * Start watching files
   */
  start(): void {
    if (this.isRunning || !this.readFile || !this.fileExists) {
      return;
    }

    this.isRunning = true;
    this.pollTimer = setInterval(() => this.pollFiles(), this.pollInterval);
  }

  /**
   * Stop watching files
   */
  stop(): void {
    this.isRunning = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    // Clear all pending changes
    this.pendingChanges.forEach(timeout => clearTimeout(timeout));
    this.pendingChanges.clear();
  }

  /**
   * Poll all watched files for changes
   */
  private async pollFiles(): Promise<void> {
    if (!this.readFile || !this.fileExists) {
      return;
    }

    for (const [modulePath, watched] of this.watchedFiles) {
      try {
        const exists = await this.fileExists(watched.filePath);

        if (!exists) {
          // File was deleted
          if (watched.status !== 'missing') {
            watched.status = 'missing';
            this.emitChange({
              modulePath,
              filePath: watched.filePath,
              changeType: 'deleted'
            });
          }
          continue;
        }

        // File exists, check for modifications
        const content = await this.readFile(watched.filePath);
        if (content === null) {
          continue;
        }

        // Check if file was recreated (was missing, now exists)
        if (watched.status === 'missing') {
          watched.status = 'synced';
          watched.lastContent = content;
          watched.lastModified = Date.now();
          this.emitChange({
            modulePath,
            filePath: watched.filePath,
            changeType: 'created',
            newContent: content
          });
          continue;
        }

        // Check if content changed
        if (content !== watched.lastContent) {
          this.debouncedEmit(modulePath, {
            modulePath,
            filePath: watched.filePath,
            changeType: 'modified',
            newContent: content
          });
          watched.lastContent = content;
          watched.lastModified = Date.now();
          watched.status = 'modified-external';
        }
      } catch (err) {
        console.warn(`Error polling file ${watched.filePath}:`, err);
      }
    }
  }

  /**
   * Debounce file change emissions to avoid rapid-fire updates
   */
  private debouncedEmit(modulePath: string, event: FileChangeEvent): void {
    // Clear existing pending change for this file
    const existing = this.pendingChanges.get(modulePath);
    if (existing) {
      clearTimeout(existing);
    }

    // Schedule new emission
    const timeout = setTimeout(() => {
      this.pendingChanges.delete(modulePath);
      this.emitChange(event);
    }, this.debounceDelay);

    this.pendingChanges.set(modulePath, timeout);
  }

  /**
   * Emit a change event to all callbacks
   */
  private emitChange(event: FileChangeEvent): void {
    this.callbacks.forEach(callback => {
      try {
        callback(event);
      } catch (err) {
        console.error('Error in file change callback:', err);
      }
    });
  }

  /**
   * Get status of a watched file
   */
  getStatus(modulePath: string): FileStatus | null {
    const watched = this.watchedFiles.get(modulePath);
    return watched?.status || null;
  }

  /**
   * Get all watched files
   */
  getWatchedFiles(): WatchedFile[] {
    return Array.from(this.watchedFiles.values());
  }

  /**
   * Mark a file as synced (after user accepts external changes)
   */
  markSynced(modulePath: string, content?: string): void {
    const watched = this.watchedFiles.get(modulePath);
    if (watched) {
      watched.status = 'synced';
      if (content !== undefined) {
        watched.lastContent = content;
      }
      watched.lastModified = Date.now();
    }
  }

  /**
   * Mark a file as having a conflict (local and external changes)
   */
  markConflict(modulePath: string): void {
    const watched = this.watchedFiles.get(modulePath);
    if (watched) {
      watched.status = 'conflict';
    }
  }

  /**
   * Restore a missing file from cached content
   */
  async restoreFile(
    modulePath: string,
    writeFile: (path: string, content: string) => Promise<boolean>
  ): Promise<boolean> {
    const watched = this.watchedFiles.get(modulePath);
    if (!watched || watched.status !== 'missing') {
      return false;
    }

    try {
      const success = await writeFile(watched.filePath, watched.lastContent);
      if (success) {
        watched.status = 'synced';
        watched.lastModified = Date.now();
      }
      return success;
    } catch (err) {
      console.error(`Failed to restore file ${watched.filePath}:`, err);
      return false;
    }
  }

  /**
   * Initialize watcher from external modules map
   */
  async initFromExternalModules(
    externalModules: Map<string, ExternalModule> | Record<string, ExternalModule>
  ): Promise<void> {
    const modules = externalModules instanceof Map
      ? externalModules
      : new Map(Object.entries(externalModules));

    for (const [modulePath, module] of modules) {
      await this.watch(modulePath, module.file, module.cachedCode);
    }
  }

  /**
   * Check if watcher is currently running
   */
  isWatching(): boolean {
    return this.isRunning;
  }

  /**
   * Get count of watched files
   */
  getWatchCount(): number {
    return this.watchedFiles.size;
  }

  /**
   * Force an immediate poll (useful after file operations)
   */
  async forcePoll(): Promise<void> {
    await this.pollFiles();
  }

  /**
   * Cleanup and dispose of the watcher
   */
  dispose(): void {
    this.stop();
    this.watchedFiles.clear();
    this.callbacks.clear();
  }
}

/**
 * Create a FileWatcher with default configuration
 */
export function createFileWatcher(config?: FileWatcherConfig): FileWatcher {
  return new FileWatcher(config);
}

/**
 * Browser-compatible file system functions using File System Access API
 * These would be passed to setFileSystemFunctions when running in browser
 */
export const browserFileSystem = {
  /**
   * Read file using File System Access API handle
   * Note: Requires a stored FileSystemFileHandle
   */
  createReadFunction: (handles: Map<string, FileSystemFileHandle>) => {
    return async (path: string): Promise<string | null> => {
      const handle = handles.get(path);
      if (!handle) return null;
      try {
        const file = await handle.getFile();
        return await file.text();
      } catch {
        return null;
      }
    };
  },

  /**
   * Check if file exists using File System Access API handle
   */
  createExistsFunction: (handles: Map<string, FileSystemFileHandle>) => {
    return async (path: string): Promise<boolean> => {
      const handle = handles.get(path);
      if (!handle) return false;
      try {
        await handle.getFile();
        return true;
      } catch {
        return false;
      }
    };
  }
};
