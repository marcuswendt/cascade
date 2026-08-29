/**
 * RandomNode - Generates random seeds or picks random choices from a list
 *
 * Two modes:
 * - seed: Generates a random integer for deterministic procedural generation
 * - choice: Picks a random option from a newline-separated list
 *
 * Supports locking to freeze the current value.
 */

import { Node } from '../../Node.js';
import type { Graph } from '../../Graph.js';
import type { OutputPort } from '@/types/node.types';

export const nodeMetadata = {
	type: 'Random',
	name: 'Random',
	icon: 'Dice5',
	description: 'Generate random seeds or pick from options',
	category: 'utility'
};

type RandomMode = 'seed' | 'choice';

export class RandomNode extends Node {
	private seedOutput!: OutputPort<number>;
	private choiceOutput!: OutputPort<string>;
	private indexOutput!: OutputPort<number>;

	constructor(id: string, graph: Graph) {
		super(id, 'Random', graph);
	}

	protected setup(): void {
		// Outputs (second param is PortType: 'param' | 'trigger')
		this.seedOutput = this.out('seed', 'param');
		this.choiceOutput = this.out('choice', 'param');
		this.indexOutput = this.out('index', 'param');

		// Parameters
		this.addParm('mode', {
			value: 'seed' as RandomMode,
			type: 'select',
			params: {
				options: [
					{ value: 'seed', label: 'Random Seed' },
					{ value: 'choice', label: 'Random Choice' }
				]
			},
			displayName: 'Mode'
		});

		this.addParm('options', {
			value: 'option 1\noption 2\noption 3',
			type: 'textarea',
			displayName: 'Options',
			condition: () => this.props.mode?.value === 'choice'
		});

		this.addParm('locked', {
			value: false,
			type: 'boolean',
			displayName: 'Lock'
		});

		// Store the current random values
		this.addParm('_currentSeed', {
			value: this.generateSeed(),
			type: 'int',
			hidden: true
		});

		this.addParm('_currentIndex', {
			value: 0,
			type: 'int',
			hidden: true
		});

		// Actions
		this.addAction('reroll', {
			label: 'Reroll',
			icon: 'RefreshCw',
			callback: () => this.reroll()
		});

		// Watch for mode changes
		this.watchProp('mode', () => this.updateOutputs());
		this.watchProp('options', () => this.updateOutputs());

		this.onReady = () => this.updateOutputs();
	}

	/**
	 * Generate a new random seed
	 */
	private generateSeed(): number {
		return Math.floor(Math.random() * 2147483647);
	}

	/**
	 * Generate a new random index for the options
	 */
	private generateIndex(): number {
		const options = this.getOptions();
		if (options.length === 0) return 0;
		return Math.floor(Math.random() * options.length);
	}

	/**
	 * Get the list of options from the textarea
	 */
	private getOptions(): string[] {
		const optionsText = this.props.options?.value ?? '';
		return optionsText
			.split('\n')
			.map((s: string) => s.trim())
			.filter((s: string) => s.length > 0);
	}

	/**
	 * Reroll the random value (if not locked)
	 */
	reroll(): void {
		if (this.props.locked?.value) return;

		const mode = this.props.mode?.value as RandomMode;

		if (mode === 'seed') {
			this.setParm('_currentSeed', this.generateSeed());
		} else {
			this.setParm('_currentIndex', this.generateIndex());
		}

		this.updateOutputs();
	}

	/**
	 * Update output values based on current state
	 */
	private updateOutputs(): void {
		const mode = this.props.mode?.value as RandomMode;

		if (mode === 'seed') {
			const seed = this.props._currentSeed?.value ?? 0;
			this.seedOutput.setValue(seed);
			this.choiceOutput.setValue('');
			this.indexOutput.setValue(0);
		} else {
			const options = this.getOptions();
			const index = Math.min(this.props._currentIndex?.value ?? 0, options.length - 1);
			const choice = options[index] ?? '';

			this.seedOutput.setValue(0);
			this.choiceOutput.setValue(choice);
			this.indexOutput.setValue(index);
		}
	}

	/**
	 * Serialize with current random state
	 */
	serialize(): Record<string, unknown> {
		return {
			_currentSeed: this.props._currentSeed?.value,
			_currentIndex: this.props._currentIndex?.value
		};
	}

	/**
	 * Deserialize and restore random state
	 */
	deserialize(data: Record<string, unknown>): void {
		if (typeof data._currentSeed === 'number') {
			this.setParm('_currentSeed', data._currentSeed);
		}
		if (typeof data._currentIndex === 'number') {
			this.setParm('_currentIndex', data._currentIndex);
		}

		this.updateOutputs();
	}
}
