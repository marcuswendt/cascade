/**
 * DescribeNode - AI image-to-text description
 *
 * Uses vision models (Gemini, GPT-4V) to describe images in text.
 * Great for generating prompts from reference images.
 */

import { QuillNode } from '../QuillNode';
import { AINodeMixin } from '../../AINode';
import type { Graph } from '../../Graph';
import type { InputPort } from '@/types/node.types';
import type { GenerationResult } from '@/services/genai/types';
import { ProviderRegistry } from '@/services/genai/ProviderRegistry';
import { AIError, AIErrorType } from '@/services/genai/errors';
import { ImageBuffer } from '@/nodes/lens/LensNode';

export const nodeMetadata = {
	type: 'Describe',
	name: 'Describe',
	icon: 'Eye',
	description: 'Generate text description from an image using AI',
	category: 'ai'
};

// Mix AINodeMixin into QuillNode
const AIQuillNode = AINodeMixin(QuillNode);

export class DescribeNode extends AIQuillNode {
	private imageInput!: InputPort<ImageBuffer>;
	private lastDescription: string = '';

	constructor(id: string, graph: Graph) {
		super(id, 'Describe', graph);
	}

	protected setup(): void {
		// Setup AI capabilities
		this.setupAI();

		// Setup text output
		this.setupTextOutput();

		// Image input
		this.imageInput = this.in('image', null, { type: 'image' });

		// Parameters
		this.addParm('model', {
			value: 'gemini-2.0-flash',
			type: 'select',
			params: {
				options: this.getVisionModelOptions()
			},
			displayName: 'Model'
		});

		this.addParm('style', {
			value: 'prompt',
			type: 'select',
			params: {
				options: [
					{ value: 'prompt', label: 'Prompt Style' },
					{ value: 'detailed', label: 'Detailed Description' },
					{ value: 'brief', label: 'Brief Summary' },
					{ value: 'custom', label: 'Custom Prompt' }
				]
			},
			displayName: 'Style'
		});

		this.addParm('customPrompt', {
			value: 'Describe this image.',
			type: 'textarea',
			params: { rows: 2 },
			displayName: 'Custom Prompt',
			condition: () => this.props.style?.value === 'custom'
		});

		// Watch for input changes
		this.imageInput.onChange = () => this.onInputChange();

		this.onReady = () => this.updateOutput();
	}

	/**
	 * Get available vision model options
	 */
	private getVisionModelOptions(): { value: string; label: string; disabled?: boolean }[] {
		return ProviderRegistry.getVisionModelOptions();
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
	 * Get the prompt based on style setting
	 */
	private getPrompt(): string {
		const style = this.props.style?.value ?? 'prompt';

		switch (style) {
			case 'prompt':
				return 'Describe this image in a way that could be used as a text-to-image generation prompt. Focus on visual elements, style, composition, colors, and mood. Be concise but detailed.';
			case 'detailed':
				return 'Provide a detailed description of this image. Include all visual elements, objects, people, setting, colors, lighting, mood, and any text visible. Be thorough and comprehensive.';
			case 'brief':
				return 'Provide a brief, one-sentence description of what is shown in this image.';
			case 'custom':
				return this.props.customPrompt?.value ?? 'Describe this image.';
			default:
				return 'Describe this image.';
		}
	}

	/**
	 * Perform the AI description
	 */
	protected async performGeneration(_signal: AbortSignal): Promise<GenerationResult[]> {
		const modelId = this.props.model?.value ?? 'gemini-2.0-flash';

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
			provider = ProviderRegistry.getVisionProvider(modelId);
		} catch {
			throw new AIError(AIErrorType.MODEL_UNAVAILABLE, `Vision model "${modelId}" not available`, {
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

		// Convert ImageBuffer to blob
		const canvas = imageBuffer.toCanvas();
		const blob = await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob((b) => {
				if (b) resolve(b);
				else reject(new Error('Failed to convert to blob'));
			}, 'image/png');
		});

		// Generate description
		const description = await provider.describeImage({
			model: modelId,
			image: { blob },
			prompt: this.getPrompt()
		});

		// Store the description
		this.lastDescription = description;

		// Return as a "result" for history tracking
		return [
			{
				id: crypto.randomUUID(),
				seed: 0,
				imageBuffer: null,
				thumbnailUrl: null,
				prompt: this.getPrompt(),
				model: modelId,
				provider: provider.id,
				timestamp: new Date(),
				metadata: {
					description
				}
			}
		];
	}

	/**
	 * Called when generation completes
	 */
	protected onGenerationComplete(): void {
		this.updateOutput();
	}

	/**
	 * Update the text output
	 */
	private updateOutput(): void {
		// Get description from latest batch if available
		const batch = this.getLatestBatch();
		if (batch && batch.results.length > 0) {
			const desc = batch.results[0].metadata?.description as string;
			if (desc) {
				this.lastDescription = desc;
			}
		}

		this.setTextOutput(this.lastDescription);
	}

	/**
	 * Serialize node state including AI history
	 */
	serialize(): Record<string, unknown> {
		return {
			ai: this.serializeAI(),
			lastDescription: this.lastDescription
		};
	}

	/**
	 * Deserialize node state including AI history
	 */
	deserialize(data: Record<string, unknown>): void {
		if (data.ai) {
			this.deserializeAI(data.ai as Record<string, unknown>);
		}
		if (typeof data.lastDescription === 'string') {
			this.lastDescription = data.lastDescription;
		}
		this.updateOutput();
	}
}
