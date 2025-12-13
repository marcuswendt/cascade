/**
 * Core Library - Base classes and utility nodes
 *
 * This package provides:
 * - Base classes: Node, Graph
 * - Utility nodes: Switch, Merge
 * - Network nodes: Subnet, Input, Output
 */

import { registerNodeClasses, registerNodeSource, type NodeClass } from '@/utils/nodeTypeUtils';

// Import node classes and metadata
import { SwitchNode, nodeMetadata as switchMetadata } from './nodes/SwitchNode.js';
import { MergeNode, nodeMetadata as mergeMetadata } from './nodes/MergeNode.js';
import { SubnetNode, nodeMetadata as subnetMetadata } from './nodes/SubnetNode.js';
import { InputNode, nodeMetadata as inputMetadata } from './nodes/InputNode.js';
import { OutputNode, nodeMetadata as outputMetadata } from './nodes/OutputNode.js';

// Import source code for nodes (using Vite's ?raw imports)
import SwitchNodeSource from './nodes/SwitchNode.ts?raw';
import MergeNodeSource from './nodes/MergeNode.ts?raw';
import SubnetNodeSource from './nodes/SubnetNode.ts?raw';
import InputNodeSource from './nodes/InputNode.ts?raw';
import OutputNodeSource from './nodes/OutputNode.ts?raw';

// Collect all node metadata
export const nodeMetadataList = [
  switchMetadata,
  mergeMetadata,
  subnetMetadata,
  inputMetadata,
  outputMetadata
];

// Node class registry: type -> class constructor
export const coreNodeClasses: Record<string, NodeClass> = {
  'Switch': SwitchNode,
  'Merge': MergeNode,
  'Subnet': SubnetNode,
  'Input': InputNode,
  'Output': OutputNode,
};

// Register nodes with the central registry
registerNodeClasses('core', coreNodeClasses);

// Register source code for each node type
registerNodeSource('Switch', SwitchNodeSource);
registerNodeSource('Merge', MergeNodeSource);
registerNodeSource('Subnet', SubnetNodeSource);
registerNodeSource('Input', InputNodeSource);
registerNodeSource('Output', OutputNodeSource);

// Re-export library metadata
export { coreLibrary } from './library.js';

// Re-export base classes (from parent directory)
export { Node } from '../Node.js';
export { Graph } from '../Graph.js';

// Re-export cascade global API (from engine)
export { cascade, CascadeContext } from '../../engine/cascade.js';

// Re-export expression engine
export { ExpressionEngine, expressionEngine } from '../../engine/expressions/index.js';
export type { ExpressionContext, CompiledExpression } from '../../engine/expressions/index.js';

// Re-export node classes
export { SwitchNode } from './nodes/SwitchNode.js';
export { MergeNode } from './nodes/MergeNode.js';
export { SubnetNode } from './nodes/SubnetNode.js';
export { InputNode } from './nodes/InputNode.js';
export { OutputNode } from './nodes/OutputNode.js';
