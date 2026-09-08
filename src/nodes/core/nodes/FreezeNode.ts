/**
 * FreezeNode - Capture and lock a value in place
 *
 * When frozen, the node outputs its captured value regardless of input changes.
 * Useful for preserving a specific state in a workflow.
 */

import { Node } from '../../Node.js';
import type { Graph } from '../../Graph.js';
import type { InputPort, OutputPort } from '@/types/node.types';
import { createSurface } from '../../image/surface.js';
import { hasPixels } from '@/nodes/image/ImageBuffer';

function previewWanted(): boolean {
	return typeof document !== 'undefined';
}

export const nodeMetadata = {
	type: 'Freeze',
	name: 'Freeze',
	icon: 'Snowflake',
	description: 'Capture and lock a value',
	category: 'utility'
};

export class FreezeNode extends Node {
	private input!: InputPort<unknown>;
	private output!: OutputPort<unknown>;
	private frozenValue: unknown = null;
	private hasCaptured: boolean = false;

	constructor(id: string, graph: Graph) {
		super(id, 'Freeze', graph);
	}

	protected setup(): void {
		// Input (default to null, type is 'any')
		this.input = this.in<unknown>('input', null, { type: 'any' });

		// Output (second param is PortType: 'param' | 'trigger')
		this.output = this.out<unknown>('output', 'param');

		// Parameters
		this.addParm('frozen', {
			value: false,
			type: 'boolean',
			displayName: 'Frozen'
		});

		// Actions
		this.addAction('capture', {
			label: 'Capture',
			icon: 'Camera',
			callback: () => this.capture()
		});

		this.addAction('clear', {
			label: 'Clear',
			icon: 'Trash2',
			callback: () => this.clear()
		});

		// Watch frozen state
		this.watchProp('frozen', () => this.update());

		this.onUpdate = () => this.update();
		this.onReady = () => this.update();
	}

	/**
	 * Capture the current input value
	 */
	capture(): void {
		this.frozenValue = this.deepClone(this.input.value);
		this.hasCaptured = true;
		this.setParm('frozen', true);
		this.update();
	}

	/**
	 * Clear the frozen value
	 */
	clear(): void {
		this.frozenValue = null;
		this.hasCaptured = false;
		this.setParm('frozen', false);
		this.update();
	}

	/**
	 * Deep clone a value if possible
	 */
	private deepClone(value: unknown): unknown {
		if (value === null || value === undefined) {
			return value;
		}

		// Use structural detection so headless image and canvas objects work too.
		if (hasPixels(value)) {
			const source = value as { width: number; height: number; naturalWidth?: number; naturalHeight?: number };
			const width = source.naturalWidth || source.width;
			const height = source.naturalHeight || source.height;
			const canvas = createSurface(width, height);
			const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
			ctx?.drawImage(value as CanvasImageSource, 0, 0);
			return canvas;
		}

		// Handle arrays
		if (Array.isArray(value)) {
			return value.map((item) => this.deepClone(item));
		}

		// Handle plain objects
		if (typeof value === 'object') {
			try {
				return JSON.parse(JSON.stringify(value));
			} catch {
				return value;
			}
		}

		// Primitives are already immutable
		return value;
	}

	private update(): void {
		const isFrozen = this.props.frozen?.value ?? false;

		if (isFrozen && this.hasCaptured) {
			// Output the frozen value
			this.output.setValue(this.frozenValue);

			// Headless runs retain the value without allocating a preview.
			if (previewWanted() && hasPixels(this.frozenValue)) {
				this.preview = this.frozenValue as HTMLCanvasElement | HTMLImageElement;
			}
		} else {
			// Pass through the input
			this.output.setValue(this.input.value);

			// Show input preview if visual
			if (previewWanted() && hasPixels(this.input.value)) {
				this.preview = this.input.value as HTMLCanvasElement | HTMLImageElement;
			} else {
				this.preview = null;
			}
		}
	}

	/**
	 * Serialize with frozen state
	 */
	serialize(): Record<string, unknown> {
		// Can't serialize canvas/images directly - would need to convert to data URL
		// For now, just save the frozen state, not the value
		return {
			hasCaptured: this.hasCaptured
		};
	}

	/**
	 * Deserialize and restore frozen state
	 */
	deserialize(data: Record<string, unknown>): void {
		this.hasCaptured = data.hasCaptured === true;
	}
}
