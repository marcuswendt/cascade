/**
 * EditNode - AI image editing
 *
 * Supports multiple edit modes:
 * - inpaint: Fill masked areas with AI-generated content
 * - instruct: Transform image based on text instruction
 * - outpaint: Extend image canvas in specified direction
 */

import { LensNode, ImageBuffer } from '../LensNode';
import { AINodeMixin } from '../../AINode';
import { Node } from '../../Node';
import type { Graph } from '../../Graph';
import type { InputPort, OutputPort } from '@/types/node.types';
import type { GenerationResult, EditRequest } from '@/services/genai/types';
import { ProviderRegistry } from '@/services/genai/ProviderRegistry';
import { AIError, AIErrorType } from '@/services/genai/errors';

export const nodeMetadata = {
	type: 'Edit',
	name: 'Edit',
	icon: 'Lightbulb',
	description: 'Edit images using AI prompts',
	category: 'filter'
};

type EditMode = 'inpaint' | 'instruct' | 'outpaint';
type OutpaintDirection = 'up' | 'down' | 'left' | 'right' | 'all';

// Mix AINodeMixin into LensNode
const AILensNode = AINodeMixin(LensNode);

export class EditNode extends AILensNode {
	// Inputs
	private imageInput!: InputPort<ImageBuffer>;
	private maskInput!: InputPort<ImageBuffer>;

	// Outputs
	private imageOutput!: OutputPort<ImageBuffer>;
	private allOutput!: OutputPort<ImageBuffer[]>;

	constructor(id: string, graph: Graph) {
		super(id, 'Edit', graph);
	}

	protected setup(): void {
		// Setup AI capabilities first
		this.setupAI();

		// Inputs
		this.imageInput = this.in('image', null, { type: 'image' });
		this.maskInput = this.in('mask', null, { type: 'image' });

		// Outputs
		this.imageOutput = this.out('image', 'param');
		this.allOutput = this.out('all', 'param');

		// Parameters
		this.addParm('mode', {
			value: 'instruct' as EditMode,
			type: 'select',
			params: {
				options: [
					{ value: 'instruct', label: 'Instruct' },
					{ value: 'inpaint', label: 'Inpaint' },
					{ value: 'outpaint', label: 'Outpaint' }
				]
			},
			displayName: 'Mode'
		});

		this.addParm('instruction', {
			value: '',
			type: 'textarea',
			params: { rows: 3, placeholder: 'Describe the edit...' },
			displayName: 'Instruction'
		});

		this.addParm('model', {
			value: 'flux-fill',
			type: 'select',
			params: {
				options: this.getEditModelOptions()
			},
			displayName: 'Model'
		});

		this.addParm('outpaintDirection', {
			value: 'all' as OutpaintDirection,
			type: 'select',
			params: {
				options: [
					{ value: 'all', label: 'All Directions' },
					{ value: 'up', label: 'Up' },
					{ value: 'down', label: 'Down' },
					{ value: 'left', label: 'Left' },
					{ value: 'right', label: 'Right' }
				]
			},
			displayName: 'Direction',
			condition: () => this.props.mode?.value === 'outpaint'
		});

		this.addParm('outpaintAmount', {
			value: 256,
			type: 'int',
			params: { min: 64, max: 1024, step: 64 },
			displayName: 'Extend Amount',
			condition: () => this.props.mode?.value === 'outpaint'
		});

		this.addParm('strength', {
			value: 0.75,
			type: 'slider',
			params: { min: 0, max: 1, step: 0.05 },
			displayName: 'Edit Strength',
			condition: () => this.props.mode?.value === 'instruct'
		});

		this.addParm('seed', {
			value: -1,
			type: 'int',
			params: { min: -1, max: 2147483647 },
			displayName: 'Seed (-1 = random)'
		});

		// Watch for input changes
		this.imageInput.onChange = () => this.onInputChange();
		this.maskInput.onChange = () => this.onInputChange();

		this.onReady = () => this.updateOutputs();
	}

	/**
	 * Get available edit model options
	 */
	private getEditModelOptions(): { value: string; label: string; disabled?: boolean }[] {
		return ProviderRegistry.getEditModelOptions();
	}

	/**
	 * Handle input changes
	 */
	private onInputChange(): void {
		if (this.props.autoExecute?.value && this.imageInput.value && !this.isGenerating) {
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
			this.convertBlobToImageBuffer(selected.imageBuffer.blob).then((buffer) => {
				if (buffer) {
					// setOutput is now public in LensNode
					this.setOutput?.(this.imageOutput, buffer);
				}
			});
		} else {
			this.imageOutput.setValue(null as any);
		}

		// Update 'all' output
		const batch = this.getLatestBatch();
		if (batch) {
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
	 * Convert ImageBuffer to blob for API
	 */
	private async imageBufferToBlob(buffer: ImageBuffer): Promise<Blob> {
		const canvas = buffer.toCanvas();
		return new Promise((resolve, reject) => {
			canvas.toBlob(
				(blob) => {
					if (blob) resolve(blob);
					else reject(new Error('Failed to convert to blob'));
				},
				'image/png'
			);
		});
	}

	/**
	 * Create outpaint mask based on direction
	 */
	private createOutpaintMask(
		width: number,
		height: number,
		direction: OutpaintDirection,
		amount: number
	): { mask: ImageBuffer; newWidth: number; newHeight: number; offsetX: number; offsetY: number } {
		let newWidth = width;
		let newHeight = height;
		let offsetX = 0;
		let offsetY = 0;

		// Calculate new dimensions and offsets
		switch (direction) {
			case 'up':
				newHeight = height + amount;
				offsetY = amount;
				break;
			case 'down':
				newHeight = height + amount;
				break;
			case 'left':
				newWidth = width + amount;
				offsetX = amount;
				break;
			case 'right':
				newWidth = width + amount;
				break;
			case 'all':
				newWidth = width + amount * 2;
				newHeight = height + amount * 2;
				offsetX = amount;
				offsetY = amount;
				break;
		}

		// Create mask - white where we want to generate, black where original image goes
		const mask = ImageBuffer.rgba(newWidth, newHeight);

		// Fill with white (generate everywhere)
		mask.fill(0, 1);
		mask.fill(1, 1);
		mask.fill(2, 1);
		mask.fill(3, 1);

		// Black out the area where original image will be placed
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const mx = x + offsetX;
				const my = y + offsetY;
				const idx = my * newWidth + mx;
				mask.channels[0][idx] = 0;
				mask.channels[1][idx] = 0;
				mask.channels[2][idx] = 0;
				// Alpha stays 1
			}
		}

		return { mask, newWidth, newHeight, offsetX, offsetY };
	}

	/**
	 * Perform the actual generation
	 */
	protected async performGeneration(signal: AbortSignal): Promise<GenerationResult[]> {
		const mode = this.props.mode?.value as EditMode;
		const modelId = this.props.model?.value ?? 'flux-fill';

		// Get the image
		const imageBuffer = this.imageInput.value;
		if (!imageBuffer) {
			throw new AIError(AIErrorType.INVALID_INPUT, 'No image provided', {
				retryable: false
			});
		}

		// Get provider
		let provider;
		try {
			provider = ProviderRegistry.getProviderForModel(modelId);
		} catch {
			throw new AIError(AIErrorType.MODEL_UNAVAILABLE, `Edit model "${modelId}" not available`, {
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

		// Get instruction
		const instruction = this.props.instruction?.value ?? '';
		if (!instruction.trim() && mode !== 'outpaint') {
			throw new AIError(AIErrorType.INVALID_INPUT, 'Please enter an instruction', {
				retryable: false
			});
		}

		// Determine seed
		const propSeed = this.props.seed?.value ?? -1;
		const seed = propSeed >= 0 ? propSeed : undefined;

		// Build request based on mode
		let request: EditRequest;

		if (mode === 'inpaint') {
			// Inpaint requires a mask
			const maskBuffer = this.maskInput.value;
			if (!maskBuffer) {
				throw new AIError(AIErrorType.INVALID_INPUT, 'Inpaint mode requires a mask input', {
					retryable: false
				});
			}

			request = {
				mode: 'inpaint',
				image: { blob: await this.imageBufferToBlob(imageBuffer) },
				mask: { blob: await this.imageBufferToBlob(maskBuffer) },
				instruction,
				model: modelId,
				seed
			};
		} else if (mode === 'outpaint') {
			const direction = this.props.outpaintDirection?.value as OutpaintDirection;
			const amount = this.props.outpaintAmount?.value ?? 256;

			// Create expanded canvas with original image and outpaint mask
			const { mask, newWidth, newHeight, offsetX, offsetY } = this.createOutpaintMask(
				imageBuffer.width,
				imageBuffer.height,
				direction,
				amount
			);

			// Create expanded image with original placed at offset
			const expandedImage = ImageBuffer.rgba(newWidth, newHeight);

			// Copy original image to offset position
			for (let y = 0; y < imageBuffer.height; y++) {
				for (let x = 0; x < imageBuffer.width; x++) {
					const srcIdx = y * imageBuffer.width + x;
					const dstIdx = (y + offsetY) * newWidth + (x + offsetX);

					for (let c = 0; c < Math.min(imageBuffer.channelCount, 4); c++) {
						expandedImage.channels[c][dstIdx] = imageBuffer.channels[c][srcIdx];
					}
					if (imageBuffer.channelCount < 4) {
						expandedImage.channels[3][dstIdx] = 1;
					}
				}
			}

			request = {
				mode: 'outpaint',
				image: { blob: await this.imageBufferToBlob(expandedImage) },
				mask: { blob: await this.imageBufferToBlob(mask) },
				instruction: instruction || 'Continue the image seamlessly',
				model: modelId,
				seed,
				outpaintDirection: direction
			};
		} else {
			// Instruct mode
			request = {
				mode: 'instruct',
				image: { blob: await this.imageBufferToBlob(imageBuffer) },
				instruction,
				model: modelId,
				seed,
				strength: this.props.strength?.value ?? 0.75
			};
		}

		// Perform edit
		const results = await provider.editImage(request, {
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
	 * Get batch metadata for history
	 */
	protected getBatchMetadata(): Record<string, unknown> {
		return {
			mode: this.props.mode?.value,
			model: this.props.model?.value,
			instruction: this.props.instruction?.value
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
