/**
 * Core Library - Utility nodes for data routing and manipulation
 *
 * This package provides nodes for:
 * - Data routing (Select)
 * - Data aggregation (Merge)
 */

import { registerNodeClasses, registerNodeSource, type NodeClass } from '@/utils/nodeTypeUtils';

// Import node classes
import { SelectNode } from './nodes/SelectNode';
import { MergeNode } from './nodes/MergeNode';

// Import source code for nodes (using Vite's ?raw imports)
import SelectNodeSource from './nodes/SelectNode.ts?raw';
import MergeNodeSource from './nodes/MergeNode.ts?raw';

// Node class registry: type -> class constructor
export const coreNodeClasses: Record<string, NodeClass> = {
  'Select': SelectNode,
  'Merge': MergeNode,
};

// Register nodes with the central registry
registerNodeClasses('core', coreNodeClasses);

// Register source code for each node type
registerNodeSource('Select', SelectNodeSource);
registerNodeSource('Merge', MergeNodeSource);

// Re-export library metadata
export { coreLibrary } from './library';

// Re-export node classes
export { SelectNode } from './nodes/SelectNode';
export { MergeNode } from './nodes/MergeNode';
