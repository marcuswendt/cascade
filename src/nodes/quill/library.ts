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
		}
	]
};
