/**
 * SelectNode - Pick an item from an array by index
 *
 * Takes an array input and outputs the item at the specified index.
 * Supports wrapping so indices beyond array length wrap around.
 */

import { Node } from '../../Node.js';
import type { Graph } from '../../Graph.js';
import type { InputPort, OutputPort } from '@/types/node.types';

export const nodeMetadata = {
	type: 'Select',
	name: 'Select',
	icon: 'ListFilter',
	description: 'Pick an item from an array by index',
	category: 'utility'
};

export class SelectNode extends Node {
	private arrayInput!: InputPort<unknown[]>;
	private itemOutput!: OutputPort<unknown>;
	private countOutput!: OutputPort<number>;

	constructor(id: string, graph: Graph) {
		super(id, 'Select', graph);
	}

	protected setup(): void {
		// Inputs (default to empty array, type is 'array')
		this.arrayInput = this.in<unknown[]>('array', [], { type: 'array' });

		// Outputs (second param is PortType: 'param' | 'trigger')
		this.itemOutput = this.out('item', 'param');
		this.countOutput = this.out('count', 'param');

		// Parameters
		this.addParm('index', {
			value: 0,
			type: 'int',
			params: { min: 0, max: 0, step: 1 },
			displayName: 'Index'
		});

		this.addParm('wrap', {
			value: true,
			type: 'boolean',
			displayName: 'Wrap Index'
		});

		// Watch for changes
		this.watchProp('index', () => this.update());
		this.watchProp('wrap', () => this.update());

		this.onUpdate = () => this.update();
		this.onReady = () => this.update();
	}

	private update(): void {
		const array = this.arrayInput.value;

		// Handle non-array or empty input
		if (!Array.isArray(array) || array.length === 0) {
			this.itemOutput.setValue(null);
			this.countOutput.setValue(0);
			this.updatePropParams('index', { max: 0 });
			return;
		}

		// Update index max based on array length
		this.updatePropParams('index', { max: array.length - 1 });

		// Get the index, applying wrapping if enabled
		let index = this.props.index?.value ?? 0;
		const wrap = this.props.wrap?.value ?? true;

		if (wrap && array.length > 0) {
			index = ((index % array.length) + array.length) % array.length;
		} else {
			index = Math.max(0, Math.min(index, array.length - 1));
		}

		const item = array[index];

		this.itemOutput.setValue(item);
		this.countOutput.setValue(array.length);

		// If the item is a canvas or image, show as preview
		if (
			item instanceof HTMLCanvasElement ||
			item instanceof HTMLImageElement
		) {
			this.preview = item;
		} else {
			this.preview = null;
		}
	}
}
