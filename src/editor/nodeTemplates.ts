// Node structure: Library > Category > Nodes
import { lensLibrary } from '@/nodes/lens';

export interface NodeTemplate {
  name: string;
  icon: string;
  description: string;
  type: string;
}

export interface Category {
  id: string;
  label: string;
  nodes: NodeTemplate[];
}

export interface Library {
  id: string;
  label: string;
  icon: string;
  categories: Category[];
}

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
  {
    id: 'core',
    label: 'Core',
    icon: 'Settings',
    categories: [
      {
        id: 'math',
        label: 'Math',
        nodes: [
          { name: 'Add', icon: 'Plus', description: 'Add two numbers', type: 'Add' },
          { name: 'Multiply', icon: 'X', description: 'Multiply two numbers', type: 'Multiply' },
          { name: 'Sine', icon: 'Triangle', description: 'Sine function', type: 'Sine' },
          { name: 'Clamp', icon: 'Ruler', description: 'Clamp value', type: 'Clamp' }
        ]
      },
      {
        id: 'time',
        label: 'Time',
        nodes: [
          { name: 'Timer', icon: 'Timer', description: 'Animation timer', type: 'Timer' }
        ]
      },
      {
        id: 'input',
        label: 'Input',
        nodes: [
          { name: 'Mouse', icon: 'MousePointer2', description: 'Mouse input', type: 'Mouse' },
          { name: 'Keyboard', icon: 'Keyboard', description: 'Keyboard input', type: 'Keyboard' }
        ]
      },
      {
        id: 'output',
        label: 'Output',
        nodes: [
          { name: 'Viewer', icon: 'Eye', description: 'Display output', type: 'Viewer' },
          { name: 'Export', icon: 'Save', description: 'Export image', type: 'Export' }
        ]
      }
    ]
  },
  lensLibrary,
  {
    id: 'echo',
    label: 'Echo',
    icon: 'Volume2',
    categories: [
      {
        id: 'audio',
        label: 'Audio',
        nodes: []
      }
    ]
  },
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

// Generate full node path (e.g., "cascade.core.math.Add")
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
        return `cascade.${library.id}.${category.id}.${node.name}`;
      }
    }
  }

  // If not found in templates, try to construct from provided ids
  if (libraryId && categoryId) {
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

