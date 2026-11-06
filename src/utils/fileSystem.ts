/**
 * File system utilities for saving and loading graphs
 */

import type { Graph } from '@/nodes/Graph';
import { formatCompactJSON } from '../../packages/contracts/src/documentFormat.js';

/**
 * Serialize graph to JSON string (compact format)
 */
export function serializeGraph(graph: Graph): string {
  const json = graph.toJSON();
  const jsonString = JSON.stringify(json, null, 2);
  return formatCompactJSON(jsonString, 2);
}

/**
 * Save graph as JSON file (browser download fallback)
 */
export function saveGraph(graph: Graph, filename: string = 'graph.cascade') {
  const compactJsonString = serializeGraph(graph);
  const blob = new Blob([compactJsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Save graph using File System Access API (modern browsers)
 * Returns the chosen filename, or null if cancelled
 */
export async function saveGraphWithPicker(graph: Graph, suggestedName: string = 'graph.cascade'): Promise<string | null> {
  // Check if File System Access API is supported
  if (!('showSaveFilePicker' in window)) {
    // Fall back to download approach
    saveGraph(graph, suggestedName);
    return suggestedName;
  }

  try {
    const handle = await (window as any).showSaveFilePicker({
      suggestedName,
      types: [{
        description: 'Cascade Files',
        accept: { 'application/json': ['.cascade'] }
      }]
    });

    const writable = await handle.createWritable();
    const content = serializeGraph(graph);
    await writable.write(content);
    await writable.close();

    return handle.name;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      // User cancelled
      return null;
    }
    throw err;
  }
}

/**
 * Load graph from JSON file
 */
export function loadGraphFromFile(file: File): Promise<any> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target?.result as string);
        resolve(json);
      } catch (error) {
        reject(new Error('Failed to parse JSON file'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

/**
 * Trigger file input dialog
 */
export function triggerFileInput(accept: string = '.cascade'): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0] || null;
      resolve(file);
    };
    input.click();
  });
}

/**
 * Get filename from path or default
 */
export function getFilenameFromPath(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || 'Untitled';
}

/**
 * Remove extension from filename
 */
export function removeExtension(filename: string): string {
  return filename.replace(/\.[^/.]+$/, '');
}



