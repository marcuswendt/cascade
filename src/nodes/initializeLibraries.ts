/**
 * Lazy initialization of node libraries
 *
 * This module provides a function to dynamically import node libraries,
 * allowing Vite to code-split them into separate chunks for better
 * initial load performance.
 */

let initialized = false;

/**
 * Initialize all standard node libraries.
 * This must be called before creating any nodes.
 * Safe to call multiple times - only initializes once.
 */
export async function initializeNodeLibraries(): Promise<void> {
  if (initialized) return;

  // Dynamically import all libraries - this triggers their registration
  await Promise.all([
    import('./core/index'),
    import('./geo/index'),
    import('./image/index'),
    import('./quill/index')
  ]);

  initialized = true;
}

/**
 * Check if libraries have been initialized
 */
export function areLibrariesInitialized(): boolean {
  return initialized;
}
