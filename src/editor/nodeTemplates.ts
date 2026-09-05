// Node structure: Library > Category > Nodes
// Import only library metadata, not the full node implementations
import { imageLibrary } from '@/nodes/image/library';
import { coreLibrary } from '@/nodes/core/library';
import { geoLibrary } from '@/nodes/geo/library';
import { quillLibrary } from '@/nodes/quill/library';
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
  geoLibrary,
  imageLibrary,
  quillLibrary
];

export function projectNodeLibrary(modules: string[], icons: Record<string, string> = {}): Library {
  return {
    id: 'project',
    label: 'Project',
    icon: 'Package',
    categories: [{
      id: 'nodes',
      label: 'Nodes',
      nodes: modules.map(module => ({
        name: module.split(/[-_]/).filter(Boolean)
          .map(part => part[0]?.toUpperCase() + part.slice(1)).join(' '),
        icon: icons[module] ?? 'Settings',
        description: `Project node · ${module}`,
        type: `project.${module}`,
      })),
    }],
  };
}

// Custom node template - shown as standalone button in menu, not in library hierarchy
export const customNodeTemplate: NodeTemplate = {
  name: 'Custom',
  icon: 'Zap',
  description: 'Create custom node with your own code',
  type: 'Custom'
};

// Code templates for different base classes
export const codeTemplates: Record<string, (name: string) => string> = {
  node: (name: string) => `// ${name} - Custom Node
//
// Define inputs
const input = node.in('input', null);

// Define properties (shown in inspector)
node.addParm('value', {
  value: 1.0,
  type: 'slider',
  params: { min: 0, max: 10, step: 0.1 },
  displayName: 'Value',
  onChange: () => process()
});

// Define outputs
const output = node.out('output');

// Process function
function process() {
  output.setValue(node.props.value.value);
}

// React to input changes
input.onChange = (value) => {
  // Process input and set output
  output.setValue(value);
};

// Watch property changes (use with onChange for reliability)
node.watchProp('value', () => process());

// Called once when node is ready
node.onReady = () => process();
`,

  image: (name: string) => `// ${name} - Image Processing Node
// Extends ImageNodeBase for canvas/image utilities
//
// Available helpers from ImageNodeBase:
//   this.createCanvas(width, height) - Create a canvas
//   this.getImageSize(img) - Get {width, height} from image/canvas
//   this.getImageData(img, w?, h?) - Get ImageData from image
//   this.putImageData(imageData) - Create canvas from ImageData
//   this.colorToCss(color) - Convert {r,g,b,a} to CSS string
//   this.normalizeColor(color) - Normalize color values to 0-1
//   this.setOutputAndPreview(output, canvas) - Set output and preview

// Define image input
const imageInput = node.in('image', null);

// Define properties (use both onChange and watchProp for reliability)
node.addParm('intensity', {
  value: 1.0,
  type: 'slider',
  params: { min: 0, max: 2, step: 0.01 },
  displayName: 'Intensity',
  onChange: () => process()
});

node.addParm('width', {
  value: 512,
  type: 'int',
  params: { min: 1, max: 4096, step: 1 },
  displayName: 'Width',
  onChange: () => process()
});

node.addParm('height', {
  value: 512,
  type: 'int',
  params: { min: 1, max: 4096, step: 1 },
  displayName: 'Height',
  onChange: () => process()
});

// Define output
const output = node.out('image');

// Process function
function process() {
  const width = node.props.width.value;
  const height = node.props.height.value;
  const intensity = node.props.intensity.value;

  // Create output canvas
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // If we have an input image, process it
  const inputImage = imageInput.value;
  if (inputImage) {
    ctx.drawImage(inputImage, 0, 0, width, height);
    // Add your image processing here
  } else {
    // Generate pattern if no input
    // Example: simple gradient
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, \`rgba(255, 0, 0, \${intensity})\`);
    gradient.addColorStop(1, \`rgba(0, 0, 255, \${intensity})\`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  output.setValue(canvas);
  node.preview = canvas;
}

// React to changes (watchProp used with onChange for reliability)
imageInput.onChange = process;
node.watchProp('intensity', () => process());
node.watchProp('width', () => process());
node.watchProp('height', () => process());

node.onReady = () => process();
`
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

// Generate full node path (e.g., "cascade.image.color.Levels")
export function getNodePath(nodeType: string, libraryId?: string, categoryId?: string): string {
  // Handle annotation types
  if (nodeType.startsWith('annotation:')) {
    const annotationType = nodeType.split(':')[1];
    return `cascade.annotations.${annotationType}`;
  }
  if (nodeType.startsWith('project.')) return nodeType;
  if (nodeType.startsWith('cascade.')) return nodeType;

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
