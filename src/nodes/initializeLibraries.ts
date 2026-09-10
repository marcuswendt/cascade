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
    // The `cascade.core.*` nodes authored as definition-v1 — Camera, Time,
    // Feedback, Previous. Separate from `core/index` because that file pulls
    // each class's source in with Vite's `?raw` and these have no class.
    import('./core/definitions'),
    import('./geo/index'),
    import('./math/index'),
    import('./pop/index'),
    import('./image/index')
  ]);

  initialized = true;
}

/**
 * Check if libraries have been initialized
 */
export function areLibrariesInitialized(): boolean {
  return initialized;
}
