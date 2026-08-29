/**
 * Quill Library - Text processing and prompt manipulation nodes
 *
 * This package provides nodes for:
 * - Text templates with placeholders (Prompt)
 * - Text templates with dynamic placeholders
 */

import { registerNodeClasses, registerNodeSource, type NodeClass } from '@/utils/nodeTypeUtils';

// Import node classes
import { PromptNode } from './nodes/PromptNode';

// Import source code for nodes (using Vite's ?raw imports)
import PromptNodeSource from './nodes/PromptNode.ts?raw';

// Node class registry: type -> class constructor
export const quillNodeClasses: Record<string, NodeClass> = {
	Prompt: PromptNode
};

// Register nodes with the central registry
registerNodeClasses('quill', quillNodeClasses);

// Register source code for each node type
registerNodeSource('Prompt', PromptNodeSource);

// Re-export library metadata
export { quillLibrary } from './library';

// Re-export base class and node classes
export { QuillNode } from './QuillNode';
export { PromptNode } from './nodes/PromptNode';
