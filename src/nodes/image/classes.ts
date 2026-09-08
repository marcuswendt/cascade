/**
 * The image library's class map, with no source text beside it.
 *
 * `index.ts` is Studio's door and pulls each node's own TypeScript in with
 * Vite's `?raw` so the code viewer can show it. That import is what kept the
 * whole library out of a Node process — `?raw` resolves under Vite and nowhere
 * else — so the map itself lives here, importable by the CLI as well as by
 * Studio, and `index.ts` adds the source registrations on top.
 */
import type { NodeClass } from '@/utils/nodeTypeUtils';

import { ColorNode } from './nodes/ColorNode';
import { ImageNode } from './nodes/ImageNode';
import { CompositeNode } from './nodes/CompositeNode';
import { CheckersNode } from './nodes/CheckersNode';
import { ResizeNode } from './nodes/ResizeNode';
import { NormalMapNode } from './nodes/NormalMapNode';
import { RampNode } from './nodes/RampNode';
import { NoiseNode } from './nodes/NoiseNode';
import { BlurNode } from './nodes/BlurNode';
import { TextNode } from './nodes/TextNode';
import { TransformNode } from './nodes/TransformNode';

/** Node class registry: type -> class constructor. */
export const imageNodeClasses: Record<string, NodeClass> = {
  'Color': ColorNode,
  'Image': ImageNode,
  'Composite': CompositeNode,
  'Checkers': CheckersNode,
  'Resize': ResizeNode,
  'NormalMap': NormalMapNode,
  'Ramp': RampNode,
  'Noise': NoiseNode,
  'Blur': BlurNode,
  'Text': TextNode,
  'Transform': TransformNode,
};
