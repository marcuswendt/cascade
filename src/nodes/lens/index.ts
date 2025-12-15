/**
 * Lens Library - Image processing and generation nodes
 *
 * This package provides nodes for:
 * - Image generation (Color, Checkers, Noise, Ramp, Text)
 * - Image loading and import (Image)
 * - Image compositing and blending (Composite)
 * - Image transformation (Resize)
 * - Image filters (Blur, NormalMap)
 */

import { registerNodeClasses, registerNodeSource, type NodeClass } from '@/utils/nodeTypeUtils';

// Import node classes
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

// Import source code for nodes (using Vite's ?raw imports)
import ColorNodeSource from './nodes/ColorNode.ts?raw';
import ImageNodeSource from './nodes/ImageNode.ts?raw';
import CompositeNodeSource from './nodes/CompositeNode.ts?raw';
import CheckersNodeSource from './nodes/CheckersNode.ts?raw';
import ResizeNodeSource from './nodes/ResizeNode.ts?raw';
import NormalMapNodeSource from './nodes/NormalMapNode.ts?raw';
import RampNodeSource from './nodes/RampNode.ts?raw';
import NoiseNodeSource from './nodes/NoiseNode.ts?raw';
import BlurNodeSource from './nodes/BlurNode.ts?raw';
import TextNodeSource from './nodes/TextNode.ts?raw';

// Node class registry: type -> class constructor
export const lensNodeClasses: Record<string, NodeClass> = {
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
};

// Register nodes with the central registry
registerNodeClasses('lens', lensNodeClasses);

// Register source code for each node type
registerNodeSource('Color', ColorNodeSource);
registerNodeSource('Image', ImageNodeSource);
registerNodeSource('Composite', CompositeNodeSource);
registerNodeSource('Checkers', CheckersNodeSource);
registerNodeSource('Resize', ResizeNodeSource);
registerNodeSource('NormalMap', NormalMapNodeSource);
registerNodeSource('Ramp', RampNodeSource);
registerNodeSource('Noise', NoiseNodeSource);
registerNodeSource('Blur', BlurNodeSource);
registerNodeSource('Text', TextNodeSource);

// Re-export library metadata
export { lensLibrary } from './library';
export * from '@/utils/canvasUtils';

// Re-export base class and node classes
export { LensNode, type ImageInput } from './LensNode';
export { ColorNode } from './nodes/ColorNode';
export { ImageNode } from './nodes/ImageNode';
export { CompositeNode } from './nodes/CompositeNode';
export { CheckersNode } from './nodes/CheckersNode';
export { ResizeNode } from './nodes/ResizeNode';
export { NormalMapNode } from './nodes/NormalMapNode';
export { RampNode } from './nodes/RampNode';
export { NoiseNode } from './nodes/NoiseNode';
export { BlurNode } from './nodes/BlurNode';
export { TextNode } from './nodes/TextNode';
