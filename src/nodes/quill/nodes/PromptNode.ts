/**
 * PromptNode - Text template with dynamic placeholders
 *
 * Creates dynamic text by replacing {placeholder} patterns with values
 * from dynamically created inputs. Great for building prompts.
 *
 * Example:
 *   Template: "a {subject} in {style} style"
 *   Creates inputs: subject, style
 *   Output: "a cat in watercolor style" (based on input values)
 */

import { QuillNode } from '../QuillNode';
import type { Graph } from '../../Graph';
import type { InputPort } from '@/types/node.types';

export const nodeMetadata = {
	type: 'Prompt',
	name: 'Prompt',
	icon: 'FileText',
	description: 'Text template with dynamic placeholders',
	category: 'text'
};

export class PromptNode extends QuillNode {
	// Dynamic inputs created from placeholders
	private dynamicInputs: Map<string, InputPort<string>> = new Map();
	private lastPlaceholders: string[] = [];

	constructor(id: string, graph: Graph) {
		super(id, 'Prompt', graph);
	}

	protected setup(): void {
		this.setupTextOutput();

		// Template parameter
		this.addParm('template', {
			value: 'a {subject} in {style} style',
			type: 'textarea',
			displayName: 'Template'
		});

		// Watch for template changes
		this.watchProp('template', () => this.onTemplateChange());

		this.onReady = () => {
			this.onTemplateChange();
			this.updateOutput();
		};

		this.onUpdate = () => this.updateOutput();
	}

	/**
	 * Handle template changes - update dynamic inputs
	 */
	private onTemplateChange(): void {
		const template = this.props.template?.value ?? '';
		const placeholders = this.extractPlaceholders(template);

		// Check if placeholders changed
		const changed =
			placeholders.length !== this.lastPlaceholders.length ||
			placeholders.some((p, i) => p !== this.lastPlaceholders[i]);

		if (!changed) return;

		this.lastPlaceholders = placeholders;

		// Remove old dynamic inputs that are no longer in template
		for (const [name, input] of this.dynamicInputs) {
			if (!placeholders.includes(name)) {
				// Remove input port
				const idx = this.inputs.indexOf(input);
				if (idx >= 0) {
					this.inputs.splice(idx, 1);
				}
				this.dynamicInputs.delete(name);
			}
		}

		// Add new dynamic inputs
		for (const name of placeholders) {
			if (!this.dynamicInputs.has(name)) {
				const input = this.in(name, '', { type: 'string' });
				input.onChange = () => this.updateOutput();
				this.dynamicInputs.set(name, input);
			}
		}

		this.updateOutput();
	}

	/**
	 * Update the text output based on template and inputs
	 */
	private updateOutput(): void {
		const template = this.props.template?.value ?? '';

		// Collect values from dynamic inputs
		const values: Record<string, string> = {};
		for (const [name, input] of this.dynamicInputs) {
			values[name] = (input.value as string) ?? '';
		}

		// Interpolate and output
		const result = this.interpolate(template, values);
		this.setTextOutput(result);
	}

	/**
	 * Get the list of current placeholders (for UI display)
	 */
	getPlaceholders(): string[] {
		return this.lastPlaceholders;
	}
}
