/**
 * The core library's class map and metadata, with no source text beside it.
 *
 * Same split as `../image/classes.ts`, and for the same reason: `index.ts`
 * imports every node's source with Vite's `?raw` for Studio's code viewer, and
 * a Node host cannot resolve that. The classes are what the CLI needs.
 */
import type { NodeClass } from '@/utils/nodeTypeUtils';

import { SwitchNode, nodeMetadata as switchMetadata } from './nodes/SwitchNode.js';
import { MergeNode, nodeMetadata as mergeMetadata } from './nodes/MergeNode.js';
import { SubnetNode, nodeMetadata as subnetMetadata } from './nodes/SubnetNode.js';
import { InputNode, nodeMetadata as inputMetadata } from './nodes/InputNode.js';
import { OutputNode, nodeMetadata as outputMetadata } from './nodes/OutputNode.js';
import { RandomNode, nodeMetadata as randomMetadata } from './nodes/RandomNode.js';
import { RemapNode, nodeMetadata as remapMetadata } from './nodes/RemapNode.js';
import { SelectNode, nodeMetadata as selectMetadata } from './nodes/SelectNode.js';
import { NullNode, nodeMetadata as nullMetadata } from './nodes/NullNode.js';
import { FreezeNode, nodeMetadata as freezeMetadata } from './nodes/FreezeNode.js';

/** All core node metadata, in one list. */
export const nodeMetadataList = [
  switchMetadata,
  mergeMetadata,
  subnetMetadata,
  inputMetadata,
  outputMetadata,
  randomMetadata,
  remapMetadata,
  selectMetadata,
  nullMetadata,
  freezeMetadata
];

/** Node class registry: type -> class constructor. */
export const coreNodeClasses: Record<string, NodeClass> = {
  'Switch': SwitchNode,
  'Merge': MergeNode,
  'Subnet': SubnetNode,
  'Input': InputNode,
  'Output': OutputNode,
  'Random': RandomNode,
  'Remap': RemapNode,
  'Select': SelectNode,
  'Null': NullNode,
  'Freeze': FreezeNode,
};
