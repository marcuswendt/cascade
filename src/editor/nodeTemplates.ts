// Node structure: Library > Category > Nodes
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

export const nodeLibraries: Library[] = [
  {
    id: 'core',
    label: 'Core',
    icon: '⚙️',
    categories: [
      {
        id: 'math',
        label: 'Math',
        nodes: [
          { name: 'Add', icon: '➕', description: 'Add two numbers', type: 'Add' },
          { name: 'Multiply', icon: '✖️', description: 'Multiply two numbers', type: 'Multiply' },
          { name: 'Sine', icon: '📐', description: 'Sine function', type: 'Sine' },
          { name: 'Clamp', icon: '📏', description: 'Clamp value', type: 'Clamp' }
        ]
      },
      {
        id: 'time',
        label: 'Time',
        nodes: [
          { name: 'Timer', icon: '⏱️', description: 'Animation timer', type: 'Timer' }
        ]
      },
      {
        id: 'input',
        label: 'Input',
        nodes: [
          { name: 'Mouse', icon: '🖱️', description: 'Mouse input', type: 'Mouse' },
          { name: 'Keyboard', icon: '⌨️', description: 'Keyboard input', type: 'Keyboard' }
        ]
      },
      {
        id: 'output',
        label: 'Output',
        nodes: [
          { name: 'Viewer', icon: '👁️', description: 'Display output', type: 'Viewer' },
          { name: 'Export', icon: '💾', description: 'Export image', type: 'Export' }
        ]
      }
    ]
  },
  {
    id: 'lens',
    label: 'Lens',
    icon: '🎨',
    categories: [
      {
        id: 'filters',
        label: 'Filters',
        nodes: [
          { name: 'Blur', icon: '🌫️', description: 'Gaussian blur', type: 'Blur' },
          { name: 'Brightness', icon: '☀️', description: 'Adjust brightness', type: 'Brightness' },
          { name: 'Contrast', icon: '🎚️', description: 'Adjust contrast', type: 'Contrast' }
        ]
      },
      {
        id: 'import',
        label: 'Import',
        nodes: [
          { name: 'Image Loader', icon: '📸', description: 'Load images from assets', type: 'ImageLoader' }
        ]
      }
    ]
  },
  {
    id: 'echo',
    label: 'Echo',
    icon: '🔊',
    categories: [
      {
        id: 'audio',
        label: 'Audio',
        nodes: []
      }
    ]
  },
  {
    id: 'custom',
    label: 'Custom',
    icon: '⚡',
    categories: [
      {
        id: 'user',
        label: 'User',
        nodes: [
          { name: 'Custom Node', icon: '⚡', description: 'Create custom node', type: 'Custom' }
        ]
      }
    ]
  }
];

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
  return '⚙️'; // Default icon if not found
}

