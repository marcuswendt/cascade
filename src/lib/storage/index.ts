/**
 * Storage Module
 *
 * Exports the storage adapter system for project file management.
 */

export type { StorageAdapter, Project, Graph, GraphContent, Asset, StorageResult } from './types';
export { LocalStorageAdapter } from './local-adapter';

import type { StorageAdapter } from './types';
import { LocalStorageAdapter } from './local-adapter';

/**
 * Current storage adapter instance
 */
let currentAdapter: StorageAdapter | null = null;

/**
 * Get or create a storage adapter for the given project path
 *
 * @param projectPath - Path to the project folder
 * @returns StorageAdapter instance
 */
export function getStorageAdapter(projectPath: string): StorageAdapter {
  // If we already have an adapter for this path, return it
  if (currentAdapter && currentAdapter.projectRoot === projectPath) {
    return currentAdapter;
  }

  // Create new local adapter
  currentAdapter = new LocalStorageAdapter(projectPath);
  return currentAdapter;
}

/**
 * Get the current storage adapter (if any)
 */
export function getCurrentAdapter(): StorageAdapter | null {
  return currentAdapter;
}

/**
 * Clear the current adapter (when closing a project)
 */
export function clearAdapter(): void {
  currentAdapter = null;
}

/**
 * Check if running in local mode (Electron)
 */
export function isLocalMode(): boolean {
  return typeof window !== 'undefined' && !!window.cascadeElectron;
}
