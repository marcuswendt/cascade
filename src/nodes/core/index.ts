/**
 * Core Library - Base classes and utility nodes
 *
 * This package provides:
 * - Base classes: Node, Graph
 * - Utility nodes: Switch, Merge
 * - Network nodes: Subnet, Input, Output
 */

import { registerNodeClasses, registerNodeSource } from '@/utils/nodeTypeUtils';

// The class map and metadata live beside this file rather than in it, so that a
// Node host can import the classes without the ?raw source text below.
import { coreNodeClasses } from './classes.js';

// Import source code for nodes (using Vite's ?raw imports)
import SwitchNodeSource from './nodes/SwitchNode.ts?raw';
import MergeNodeSource from './nodes/MergeNode.ts?raw';
import SubnetNodeSource from './nodes/SubnetNode.ts?raw';
import InputNodeSource from './nodes/InputNode.ts?raw';
import OutputNodeSource from './nodes/OutputNode.ts?raw';
import RandomNodeSource from './nodes/RandomNode.ts?raw';
import RemapNodeSource from './nodes/RemapNode.ts?raw';
import SelectNodeSource from './nodes/SelectNode.ts?raw';
import NullNodeSource from './nodes/NullNode.ts?raw';
import FreezeNodeSource from './nodes/FreezeNode.ts?raw';

export { nodeMetadataList, coreNodeClasses } from './classes.js';

// Register nodes with the central registry
registerNodeClasses('core', coreNodeClasses);

// Register source code for each node type
registerNodeSource('Switch', SwitchNodeSource);
registerNodeSource('Merge', MergeNodeSource);
registerNodeSource('Subnet', SubnetNodeSource);
registerNodeSource('Input', InputNodeSource);
registerNodeSource('Output', OutputNodeSource);
registerNodeSource('Random', RandomNodeSource);
registerNodeSource('Remap', RemapNodeSource);
registerNodeSource('Select', SelectNodeSource);
registerNodeSource('Null', NullNodeSource);
registerNodeSource('Freeze', FreezeNodeSource);

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
export { RandomNode } from './nodes/RandomNode.js';
export { RemapNode } from './nodes/RemapNode.js';
export { SelectNode } from './nodes/SelectNode.js';
export { NullNode } from './nodes/NullNode.js';
export { FreezeNode } from './nodes/FreezeNode.js';
