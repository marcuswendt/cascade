/**
 * Quill Library - Text processing and prompt manipulation nodes
 *
 * This package provides nodes for:
 * - Text templates with placeholders (Prompt)
 * - AI image description (Describe)
 * - AI prompt enhancement (Enhance)
 * - Conversational AI with streaming (Chat)
 * - System prompts for Chat (System)
 */

import { registerNodeClasses, registerNodeSource, type NodeClass } from '@/utils/nodeTypeUtils';

// Import node classes
import { PromptNode } from './nodes/PromptNode';
import { DescribeNode } from './nodes/DescribeNode';
import { EnhanceNode } from './nodes/EnhanceNode';
import { ChatNode } from './nodes/ChatNode';
import { SystemNode } from './nodes/SystemNode';

// Import source code for nodes (using Vite's ?raw imports)
import PromptNodeSource from './nodes/PromptNode.ts?raw';
import DescribeNodeSource from './nodes/DescribeNode.ts?raw';
import EnhanceNodeSource from './nodes/EnhanceNode.ts?raw';
import ChatNodeSource from './nodes/ChatNode.ts?raw';
import SystemNodeSource from './nodes/SystemNode.ts?raw';

// Node class registry: type -> class constructor
export const quillNodeClasses: Record<string, NodeClass> = {
	Prompt: PromptNode,
	Describe: DescribeNode,
	Enhance: EnhanceNode,
	Chat: ChatNode,
	System: SystemNode
};

// Register nodes with the central registry
registerNodeClasses('quill', quillNodeClasses);

// Register source code for each node type
registerNodeSource('Prompt', PromptNodeSource);
registerNodeSource('Describe', DescribeNodeSource);
registerNodeSource('Enhance', EnhanceNodeSource);
registerNodeSource('Chat', ChatNodeSource);
registerNodeSource('System', SystemNodeSource);

// Re-export library metadata
export { quillLibrary } from './library';

// Re-export base class and node classes
export { QuillNode } from './QuillNode';
export { PromptNode } from './nodes/PromptNode';
export { DescribeNode } from './nodes/DescribeNode';
export { EnhanceNode } from './nodes/EnhanceNode';
export { ChatNode } from './nodes/ChatNode';
export { SystemNode } from './nodes/SystemNode';
