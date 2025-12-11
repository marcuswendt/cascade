/**
 * Core Library - Utility nodes for data routing and manipulation
 *
 * This package provides nodes for:
 * - Data routing (Select)
 * - Data aggregation (Merge)
 */

import { registerNodeClasses, type NodeClass } from '@/utils/nodeTypeUtils';

// Import node classes
import { SelectNode } from './nodes/SelectNode';
import { MergeNode } from './nodes/MergeNode';

// Node class registry: type -> class constructor
export const coreNodeClasses: Record<string, NodeClass> = {
  'Select': SelectNode,
  'Merge': MergeNode,
};

// Register nodes with the central registry
registerNodeClasses('core', coreNodeClasses);

// Re-export library metadata
export { coreLibrary } from './library';

// Re-export node classes
export { SelectNode } from './nodes/SelectNode';
export { MergeNode } from './nodes/MergeNode';
