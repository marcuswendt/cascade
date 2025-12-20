import type { Library } from '@/types/library.types';

/**
 * Quill library definition
 * A collection of nodes for text processing and prompt manipulation
 */
export const quillLibrary: Library = {
	id: 'quill',
	label: 'Quill',
	icon: 'Feather',
	categories: [
		{
			id: 'text',
			label: 'Text',
			nodes: [
				{
					name: 'Prompt',
					icon: 'FileText',
					description: 'Text template with dynamic placeholders',
					type: 'Prompt'
				}
			]
		},
		{
			id: 'ai',
			label: 'AI Text',
			nodes: [
				{
					name: 'Describe',
					icon: 'Eye',
					description: 'Generate text description from an image using AI',
					type: 'Describe'
				},
				{
					name: 'Enhance',
					icon: 'Wand2',
					description: 'Enhance and expand prompts using AI',
					type: 'Enhance'
				}
			]
		},
		{
			id: 'chat',
			label: 'Chat',
			nodes: [
				{
					name: 'Chat',
					icon: 'MessageSquare',
					description: 'Conversational AI with streaming responses',
					type: 'Chat'
				},
				{
					name: 'System',
					icon: 'Settings',
					description: 'System prompt for Chat nodes',
					type: 'System'
				}
			]
		}
	]
};
