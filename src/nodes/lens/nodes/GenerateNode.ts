/**
 * GenerateNode - Text-to-image AI generation
 *
 * Uses various AI providers (Replicate, Google, etc.) to generate images from text prompts.
 * Supports batch generation, reference images, and seed control.
 */

import { LensNode, ImageBuffer } from '../LensNode';
import { AINodeMixin } from '../../AINode';
import { Node } from '../../Node';
import type { Graph } from '../../Graph';
import type { InputPort, OutputPort } from '@/types/node.types';
import type { GenerationResult, GenerationRequest, ReferenceImage } from '@/services/genai/types';
import { ProviderRegistry } from '@/services/genai/ProviderRegistry';
import { AIError, AIErrorType } from '@/services/genai/errors';

export const nodeMetadata = {
	type: 'Generate',
	name: 'Generate',
	icon: 'Lightbulb',
	description: 'Generate images from text prompts using AI',
	category: 'create'
};

// Mix AINodeMixin into LensNode
const AILensNode = AINodeMixin(LensNode);

export class GenerateNode extends AILensNode {
	// Inputs
	private promptInput!: InputPort<string>;
	private styleInput!: InputPort<ImageBuffer>;
	private compositionInput!: InputPort<ImageBuffer>;
	private seedInput!: InputPort<number>;

	// Outputs
	private imageOutput!: OutputPort<ImageBuffer>;
	private allOutput!: OutputPort<ImageBuffer[]>;
	private seedOutput!: OutputPort<number>;

	constructor(id: string, graph: Graph) {
		super(id, 'Generate', graph);
	}

	protected setup(): void {
		// Setup AI capabilities first
		this.setupAI();

		// Inputs (all optional)
		this.promptInput = this.in('prompt', '', { type: 'string' });
		this.styleInput = this.in('style', null, { type: 'image' });
		this.compositionInput = this.in('composition', null, { type: 'image' });
		this.seedInput = this.in('seed', undefined, { type: 'number' });

		// Outputs
		this.imageOutput = this.out('image', 'param');
		this.allOutput = this.out('all', 'param');
		this.seedOutput = this.out('seed', 'param');

		// Parameters
		this.addParm('prompt', {
			value: '',
			type: 'textarea',
			params: { rows: 3, placeholder: 'Enter your prompt...' },
			displayName: 'Prompt'
		});

		this.addParm('negativePrompt', {
			value: '',
			type: 'textarea',
			params: { rows: 2, placeholder: 'What to avoid...' },
			displayName: 'Negative Prompt'
		});

		this.addParm('model', {
			value: 'flux-schnell',
			type: 'select',
			params: {
				options: this.getModelOptions()
			},
			displayName: 'Model'
		});

		this.addParm('batchSize', {
			value: 1,
			type: 'int',
			params: { min: 1, max: 8, step: 1 },
			displayName: 'Batch Size'
		});

		this.addParm('seed', {
			value: -1,
			type: 'int',
			params: { min: -1, max: 2147483647 },
			displayName: 'Seed (-1 = random)'
		});

		this.addParm('seedOffset', {
			value: 0,
			type: 'int',
			params: { min: 0, max: 1000 },
			displayName: 'Seed Offset'
		});

		this.addResolutionParm(1024, 1024);

		this.addParm('referenceStrength', {
			value: 0.35,
			type: 'slider',
			params: { min: 0, max: 1, step: 0.05 },
			displayName: 'Reference Strength',
			condition: () => !!this.styleInput?.value || !!this.compositionInput?.value
		});

		// Add vary action
		this.addAction('vary', {
			label: 'Vary',
			icon: 'Shuffle',
			callback: () => this.createVariation(),
			condition: () => this.history.batches.length > 0
		});

		// Watch for input changes
		this.promptInput.onChange = () => this.onInputChange();
		this.styleInput.onChange = () => this.onInputChange();
		this.seedInput.onChange = () => this.onInputChange();

		this.onReady = () => this.updateOutputs();
	}

	/**
	 * Get available model options from registry
	 */
	private getModelOptions(): { value: string; label: string; disabled?: boolean }[] {
		return ProviderRegistry.getImageModelOptions();
	}

	/**
	 * Handle input changes - auto-generate if enabled
	 */
	private onInputChange(): void {
		if (this.props.autoExecute?.value && !this.isGenerating) {
			this.generate();
		}
	}

	/**
	 * Render method - updates outputs from current selection
	 */
	protected render(): void {
		this.updateOutputs();
	}

	/**
	 * Update outputs based on current selection
	 */
	private updateOutputs(): void {
		const selected = this.getSelectedResult();

		if (selected?.imageBuffer && 'blob' in selected.imageBuffer) {
			// Convert blob to ImageBuffer
			this.convertBlobToImageBuffer(selected.imageBuffer.blob).then((buffer) => {
				if (buffer) {
					// setOutput is now public in LensNode
					this.setOutput?.(this.imageOutput, buffer);
					this.seedOutput.setValue(selected.seed);
				}
			});
		} else {
			this.imageOutput.setValue(null as any);
			this.seedOutput.setValue(0);
		}

		// Update 'all' output with all results from current batch
		const batch = this.getLatestBatch();
		if (batch) {
			// Convert all results to ImageBuffers
			Promise.all(
				batch.results.map(async (r) => {
					if (r.imageBuffer && 'blob' in r.imageBuffer) {
						return this.convertBlobToImageBuffer(r.imageBuffer.blob);
					}
					return null;
				})
			).then((buffers) => {
				this.allOutput.setValue(buffers.filter((b): b is ImageBuffer => b !== null));
			});
		}
	}

	/**
	 * Convert a Blob to ImageBuffer
	 */
	private async convertBlobToImageBuffer(blob: Blob): Promise<ImageBuffer | null> {
		return new Promise((resolve) => {
			const img = new Image();
			img.onload = () => {
				const canvas = document.createElement('canvas');
				canvas.width = img.width;
				canvas.height = img.height;
				const ctx = canvas.getContext('2d');
				if (ctx) {
					ctx.drawImage(img, 0, 0);
					resolve(ImageBuffer.fromCanvas(canvas));
				} else {
					resolve(null);
				}
				URL.revokeObjectURL(img.src);
			};
			img.onerror = () => {
				URL.revokeObjectURL(img.src);
				resolve(null);
			};
			img.src = URL.createObjectURL(blob);
		});
	}

	/**
	 * Perform the actual generation
	 */
	protected async performGeneration(signal: AbortSignal): Promise<GenerationResult[]> {
		const modelId = this.props.model?.value ?? 'flux-schnell';

		// Get provider for model
		let provider;
		try {
			provider = ProviderRegistry.getProviderForModel(modelId);
		} catch {
			throw new AIError(AIErrorType.MODEL_UNAVAILABLE, `Model "${modelId}" not available`, {
				model: modelId,
				retryable: false
			});
		}

		if (!provider.isConfigured()) {
			throw new AIError(
				AIErrorType.NO_API_KEY,
				`No API key configured for ${provider.name}. Add one in Settings.`,
				{
					provider: provider.id,
					retryable: false
				}
			);
		}

		// Build prompt (combine input and prop)
		const inputPrompt = this.promptInput.value ?? '';
		const propPrompt = this.props.prompt?.value ?? '';
		const prompt = inputPrompt || propPrompt;

		if (!prompt.trim()) {
			throw new AIError(AIErrorType.INVALID_INPUT, 'Please enter a prompt', {
				retryable: false
			});
		}

		// Determine seed
		let seed: number | undefined;
		const inputSeed = this.seedInput.value;
		const propSeed = this.props.seed?.value ?? -1;
		const seedOffset = this.props.seedOffset?.value ?? 0;

		if (inputSeed !== undefined && inputSeed >= 0) {
			seed = inputSeed + seedOffset;
		} else if (propSeed >= 0) {
			seed = propSeed + seedOffset;
		}
		// If seed is undefined, provider will generate random seeds

		// Build reference images
		const references: ReferenceImage[] = [];

		if (this.styleInput.value) {
			const canvas = this.styleInput.value.toCanvas();
			references.push({
				type: 'style',
				imageUrl: canvas.toDataURL('image/png')
			});
		}

		if (this.compositionInput.value) {
			const canvas = this.compositionInput.value.toCanvas();
			references.push({
				type: 'composition',
				imageUrl: canvas.toDataURL('image/png')
			});
		}

		// Build request
		const [width, height] = this.getResolution();
		const request: GenerationRequest = {
			prompt,
			negativePrompt: this.props.negativePrompt?.value || undefined,
			model: modelId,
			batchSize: this.props.batchSize?.value ?? 1,
			seed,
			width,
			height,
			references: references.length > 0 ? references : undefined,
			referenceStrength: this.props.referenceStrength?.value
		};

		// Generate
		const results = await provider.generateImages(request, {
			signal,
			onProgress: (progress) => this.updateProgress(progress)
		});

		return results;
	}

	/**
	 * Called when generation completes
	 */
	protected onGenerationComplete(): void {
		this.updateOutputs();
	}

	/**
	 * Called when a result is selected
	 */
	protected onResultSelected(): void {
		this.updateOutputs();
	}

	/**
	 * Create a variation node connected to this one
	 */
	private createVariation(): void {
		// Get the graph to create a new node (access protected member via type assertion)
		const graph = (this as unknown as { graph: Graph }).graph;

		// Position to the right of this node
		const newPosition = {
			x: this.position.x + 250,
			y: this.position.y
		};

		// Create new Generate node via graph.addNode
		const variation = graph.addNode('cascade.lens.ai.Generate', newPosition) as GenerateNode;
		if (!variation) return;

		// Set up as variation
		variation.setParm('seedOffset', 10);
		variation.setParm('referenceStrength', 0.3);

		// Copy prompt
		variation.setParm('prompt', this.props.prompt?.value ?? '');
		variation.setParm('model', this.props.model?.value ?? 'flux-schnell');

		// Connect seed output to seed input
		const seedOutPort = this.outputs.find((p: { name: string }) => p.name === 'seed');
		const seedInPort = variation.inputs.find((p: { name: string }) => p.name === 'seed');
		if (seedOutPort && seedInPort) {
			graph.connect(seedOutPort.id, seedInPort.id);
		}

		// Connect image output to style input
		const imgOutPort = this.outputs.find((p: { name: string }) => p.name === 'image');
		const styleInPort = variation.inputs.find((p: { name: string }) => p.name === 'style');
		if (imgOutPort && styleInPort) {
			graph.connect(imgOutPort.id, styleInPort.id);
		}
	}

	/**
	 * Get batch metadata for history
	 */
	protected getBatchMetadata(): Record<string, unknown> {
		const [width, height] = this.getResolution();
		return {
			model: this.props.model?.value,
			width,
			height,
			batchSize: this.props.batchSize?.value
		};
	}

	/**
	 * Serialize node state including AI history
	 */
	serialize(): Record<string, unknown> {
		return {
			ai: this.serializeAI()
		};
	}

	/**
	 * Deserialize node state including AI history
	 */
	deserialize(data: Record<string, unknown>): void {
		if (data.ai) {
			this.deserializeAI(data.ai as Record<string, unknown>);
		}
		this.updateOutputs();
	}
}
