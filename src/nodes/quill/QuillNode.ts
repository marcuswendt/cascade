/**
 * QuillNode - Base class for text-producing nodes
 *
 * Provides common utilities for text manipulation and output.
 * All Quill nodes output text/strings.
 */

import { Node } from '../Node';
import type { Graph } from '../Graph';
import type { OutputPort } from '@/types/node.types';

export abstract class QuillNode extends Node {
	// Primary text output
	protected textOutput!: OutputPort<string>;

	constructor(id: string, type: string, graph: Graph) {
		super(id, type, graph);
	}

	/**
	 * Setup the standard text output
	 * Call this in subclass setup()
	 */
	protected setupTextOutput(): void {
		this.textOutput = this.out('text', 'param');
	}

	/**
	 * Set the text output
	 */
	protected setTextOutput(text: string): void {
		this.textOutput.setValue(text);
	}

	/**
	 * Interpolate placeholders in a template string
	 * Supports {name} syntax for variable substitution
	 */
	protected interpolate(
		template: string,
		values: Record<string, string | number | undefined>
	): string {
		return template.replace(/\{(\w+)\}/g, (match, key) => {
			const value = values[key];
			return value !== undefined ? String(value) : match;
		});
	}

	/**
	 * Extract placeholder names from a template
	 */
	protected extractPlaceholders(template: string): string[] {
		const matches = template.match(/\{(\w+)\}/g);
		if (!matches) return [];
		return [...new Set(matches.map((m) => m.slice(1, -1)))];
	}

	/**
	 * Clean and normalize text
	 */
	protected cleanText(text: string): string {
		return text
			.trim()
			.replace(/\s+/g, ' ')
			.replace(/\n\s*\n/g, '\n\n');
	}
}

export { QuillNode as default };
