/**
 * Recent Projects Tracking
 *
 * Integrates with the OS-level recent documents feature.
 * On macOS, this populates the "Open Recent" submenu in File menu.
 */

import { app } from 'electron';
import path from 'path';
import fs from 'fs';

/**
 * Add a project to the recent documents list
 *
 * @param projectPath - Full path to the project file or directory
 */
export function addToRecentProjects(projectPath: string): void {
  // Validate the path exists
  if (!fs.existsSync(projectPath)) {
    console.warn(`[Recent] Path does not exist: ${projectPath}`);
    return;
  }

  // Normalize the path
  const normalizedPath = path.normalize(projectPath);

  // Add to macOS/Windows recent documents
  app.addRecentDocument(normalizedPath);

  console.log(`[Recent] Added to recent documents: ${normalizedPath}`);
}

/**
 * Clear all recent documents
 */
export function clearRecentProjects(): void {
  app.clearRecentDocuments();
  console.log('[Recent] Cleared recent documents');
}

/**
 * Get the recent documents (platform-specific)
 *
 * Note: This is handled natively by the OS on macOS.
 * On Windows/Linux, we might need to maintain our own list.
 */
export function getRecentProjects(): string[] {
  // On macOS, this is handled by the OS
  // For cross-platform support, we could maintain our own list
  // in the app's userData directory

  const recentFile = path.join(app.getPath('userData'), 'recent-projects.json');

  try {
    if (fs.existsSync(recentFile)) {
      const data = fs.readFileSync(recentFile, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('[Recent] Failed to read recent projects:', err);
  }

  return [];
}

/**
 * Save recent projects to file (for cross-platform support)
 *
 * @param projects - Array of project paths
 */
export function saveRecentProjects(projects: string[]): void {
  const recentFile = path.join(app.getPath('userData'), 'recent-projects.json');

  try {
    // Ensure directory exists
    const dir = path.dirname(recentFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Keep only the last 10 projects
    const trimmed = projects.slice(0, 10);
    fs.writeFileSync(recentFile, JSON.stringify(trimmed, null, 2));
  } catch (err) {
    console.error('[Recent] Failed to save recent projects:', err);
  }
}

/**
 * Add a project to our custom recent list (for cross-platform support)
 *
 * @param projectPath - Full path to the project
 */
export function addToCustomRecentList(projectPath: string): void {
  const projects = getRecentProjects();

  // Remove if already in list (to move to top)
  const filtered = projects.filter(p => p !== projectPath);

  // Add to beginning
  filtered.unshift(projectPath);

  // Save
  saveRecentProjects(filtered);

  // Also add to OS-level recent documents
  addToRecentProjects(projectPath);
}
