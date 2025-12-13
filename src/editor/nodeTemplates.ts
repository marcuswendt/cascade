// Node structure: Library > Category > Nodes
import { lensLibrary } from '@/nodes/lens';
import { coreLibrary } from '@/nodes/core';
import type { Library, NodeTemplate } from '@/types/library.types';

// Re-export types for backward compatibility
export type { NodeTemplate, Category, Library } from '@/types/library.types';

// Annotations library - contains all annotation node types
export const annotationsLibrary: Library = {
  id: 'annotations',
  label: 'Annotations',
  icon: 'StickyNote',
  categories: [
    {
      id: 'annotations',
      label: 'Annotations',
      nodes: [
        { name: 'Text', icon: 'Type', description: 'Add text annotation', type: 'annotation:text' },
        { name: 'Image', icon: 'Image', description: 'Add image annotation', type: 'annotation:image' },
        { name: 'Group', icon: 'Folder', description: 'Group elements together', type: 'annotation:group' },
        { name: 'Line', icon: 'Minus', description: 'Draw a line', type: 'annotation:line' },
        { name: 'Draw', icon: 'PenTool', description: 'Freehand drawing', type: 'annotation:polyline' }
      ]
    }
  ]
};

export const nodeLibraries: Library[] = [
  annotationsLibrary,
  coreLibrary,
  lensLibrary
];

// Custom node template - shown as standalone button in menu, not in library hierarchy
export const customNodeTemplate: NodeTemplate = {
  name: 'Custom',
  icon: 'Zap',
  description: 'Create custom node with your own code',
  type: 'Custom'
};

// Get all available libraries that have nodes
export function getAvailableLibraries(): Library[] {
  return nodeLibraries.filter(library => {
    // Library is available if it has at least one category with nodes
    return library.categories.some(category => category.nodes.length > 0);
  });
}

// Get all nodes from all libraries (for search)
export function getAllNodes(): NodeTemplate[] {
  const all: NodeTemplate[] = [];
  nodeLibraries.forEach(library => {
    library.categories.forEach(category => {
      all.push(...category.nodes);
    });
  });
  return all;
}

// Find a node by library and category
export function getNodesByLibraryAndCategory(libraryId: string, categoryId: string): NodeTemplate[] {
  const library = nodeLibraries.find(lib => lib.id === libraryId);
  if (!library) return [];
  
  const category = library.categories.find(cat => cat.id === categoryId);
  if (!category) return [];
  
  return category.nodes;
}

// Get icon for a node type
export function getNodeIcon(nodeType: string): string {
  for (const library of nodeLibraries) {
    for (const category of library.categories) {
      const node = category.nodes.find(n => n.type === nodeType);
      if (node) {
        return node.icon;
      }
    }
  }
  return 'Settings'; // Default icon if not found
}

// Generate full node path (e.g., "cascade.lens.color.Levels")
export function getNodePath(nodeType: string, libraryId?: string, categoryId?: string): string {
  // Handle annotation types
  if (nodeType.startsWith('annotation:')) {
    const annotationType = nodeType.split(':')[1];
    return `cascade.annotations.${annotationType}`;
  }

  // Search through libraries to find the node
  for (const library of nodeLibraries) {
    for (const category of library.categories) {
      const node = category.nodes.find(n => n.type === nodeType);
      if (node) {
        // Core library uses flat namespace (no category in path)
        if (library.id === 'core') {
          return `cascade.core.${node.name}`;
        }
        return `cascade.${library.id}.${category.id}.${node.name}`;
      }
    }
  }

  // If not found in templates, try to construct from provided ids
  if (libraryId && categoryId) {
    // Core library uses flat namespace
    if (libraryId === 'core') {
      return `cascade.core.${nodeType}`;
    }
    return `cascade.${libraryId}.${categoryId}.${nodeType}`;
  }

  // Fallback for custom nodes
  return `custom.${nodeType}`;
}

// Get node path for display (shorter version without "cascade." prefix)
export function getNodePathShort(nodeType: string): string {
  const fullPath = getNodePath(nodeType);
  return fullPath.startsWith('cascade.') ? fullPath.substring(8) : fullPath;
}

