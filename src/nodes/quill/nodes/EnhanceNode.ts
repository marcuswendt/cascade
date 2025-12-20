/**
 * EnhanceNode - AI prompt enhancement
 *
 * Uses LLM to expand and improve prompts for image generation.
 * Takes a simple prompt and adds detail, style cues, and composition hints.
 */

import { QuillNode } from '../QuillNode';
import { AINodeMixin } from '../../AINode';
import type { Graph } from '../../Graph';
import type { InputPort } from '@/types/node.types';
import type { GenerationResult } from '@/services/genai/types';
import { ProviderRegistry } from '@/services/genai/ProviderRegistry';
import { AIError, AIErrorType } from '@/services/genai/errors';

export const nodeMetadata = {
	type: 'Enhance',
	name: 'Enhance',
	icon: 'Wand2',
	description: 'Enhance and expand prompts using AI',
	category: 'ai'
};

// Mix AINodeMixin into QuillNode
const AIQuillNode = AINodeMixin(QuillNode);

export class EnhanceNode extends AIQuillNode {
	private promptInput!: InputPort<string>;
	private lastEnhanced: string = '';

	constructor(id: string, graph: Graph) {
		super(id, 'Enhance', graph);
	}

	protected setup(): void {
		// Setup AI capabilities
		this.setupAI();

		// Setup text output
		this.setupTextOutput();

		// Prompt input (optional - can also use prop)
		this.promptInput = this.in('prompt', '', { type: 'string' });

		// Parameters
		this.addParm('promptText', {
			value: '',
			type: 'textarea',
			params: { rows: 3, placeholder: 'Enter prompt to enhance...' },
			displayName: 'Prompt'
		});

		this.addParm('model', {
			value: 'gemini-2.0-flash',
			type: 'select',
			params: {
				options: this.getLLMModelOptions()
			},
			displayName: 'Model'
		});

		this.addParm('style', {
			value: 'balanced',
			type: 'select',
			params: {
				options: [
					{ value: 'minimal', label: 'Minimal' },
					{ value: 'balanced', label: 'Balanced' },
					{ value: 'detailed', label: 'Detailed' },
					{ value: 'creative', label: 'Creative' }
				]
			},
			displayName: 'Enhancement Style'
		});

		this.addParm('preserveCore', {
			value: true,
			type: 'toggle',
			displayName: 'Preserve Core Intent'
		});

		// Watch for input changes
		this.promptInput.onChange = () => this.onInputChange();

		this.onReady = () => this.updateOutput();
	}

	/**
	 * Get available LLM model options
	 */
	private getLLMModelOptions(): { value: string; label: string; disabled?: boolean }[] {
		return ProviderRegistry.getLLMModelOptions();
	}

	/**
	 * Handle input changes
	 */
	private onInputChange(): void {
		if (this.props.autoExecute?.value && this.getSourcePrompt() && !this.isGenerating) {
			this.generate();
		}
	}

	/**
	 * Get the source prompt (from input or prop)
	 */
	private getSourcePrompt(): string {
		const inputPrompt = this.promptInput.value ?? '';
		const propPrompt = this.props.promptText?.value ?? '';
		return inputPrompt || propPrompt;
	}

	/**
	 * Get the system prompt for enhancement
	 */
	private getSystemPrompt(): string {
		const style = this.props.style?.value ?? 'balanced';
		const preserveCore = this.props.preserveCore?.value ?? true;

		let instructions = `You are an expert prompt engineer for AI image generation. Your task is to enhance and expand the user's prompt to produce better image generation results.`;

		if (preserveCore) {
			instructions += `\n\nIMPORTANT: Preserve the core subject and intent of the original prompt. Don't change what the image is fundamentally about.`;
		}

		switch (style) {
			case 'minimal':
				instructions += `\n\nStyle: Minimal enhancement. Add only essential details to clarify the prompt. Keep it concise - aim for 1-2 sentences total. Focus on clarity over elaboration.`;
				break;
			case 'balanced':
				instructions += `\n\nStyle: Balanced enhancement. Add helpful details about lighting, composition, style, and mood. Aim for 2-3 sentences. Strike a balance between detail and brevity.`;
				break;
			case 'detailed':
				instructions += `\n\nStyle: Detailed enhancement. Significantly expand the prompt with rich details about setting, atmosphere, lighting, textures, colors, and artistic style. Aim for a comprehensive prompt of 3-5 sentences.`;
				break;
			case 'creative':
				instructions += `\n\nStyle: Creative enhancement. Take creative liberties to make the image more interesting and visually striking. Add unexpected but fitting details. Feel free to suggest artistic styles, unique lighting, or interesting compositions.`;
				break;
		}

		instructions += `\n\nRespond with ONLY the enhanced prompt - no explanations, no quotes, no prefixes like "Enhanced:" or "Result:". Just the improved prompt text.`;

		return instructions;
	}

	/**
	 * Perform the AI enhancement
	 */
	protected async performGeneration(_signal: AbortSignal): Promise<GenerationResult[]> {
		const modelId = this.props.model?.value ?? 'gemini-2.0-flash';
		const sourcePrompt = this.getSourcePrompt();

		if (!sourcePrompt.trim()) {
			throw new AIError(AIErrorType.INVALID_INPUT, 'Please enter a prompt to enhance', {
				retryable: false
			});
		}

		// Get provider
		let provider;
		try {
			provider = ProviderRegistry.getLLMProvider(modelId);
		} catch {
			throw new AIError(AIErrorType.MODEL_UNAVAILABLE, `LLM model "${modelId}" not available`, {
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

		// Generate enhanced prompt
		const enhanced = await provider.complete({
			model: modelId,
			prompt: sourcePrompt,
			systemPrompt: this.getSystemPrompt(),
			temperature: this.props.style?.value === 'creative' ? 0.9 : 0.7,
			maxTokens: 500
		});

		// Clean up the result
		this.lastEnhanced = this.cleanText(enhanced);

		// Return as a "result" for history tracking
		return [
			{
				id: crypto.randomUUID(),
				seed: 0,
				imageBuffer: null,
				thumbnailUrl: null,
				prompt: sourcePrompt,
				model: modelId,
				provider: provider.id,
				timestamp: new Date(),
				metadata: {
					enhanced: this.lastEnhanced,
					style: this.props.style?.value
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
		// Get enhanced text from latest batch if available
		const batch = this.getLatestBatch();
		if (batch && batch.results.length > 0) {
			const enhanced = batch.results[0].metadata?.enhanced as string;
			if (enhanced) {
				this.lastEnhanced = enhanced;
			}
		}

		this.setTextOutput(this.lastEnhanced);
	}

	/**
	 * Serialize node state including AI history
	 */
	serialize(): Record<string, unknown> {
		return {
			ai: this.serializeAI(),
			lastEnhanced: this.lastEnhanced
		};
	}

	/**
	 * Deserialize node state including AI history
	 */
	deserialize(data: Record<string, unknown>): void {
		if (data.ai) {
			this.deserializeAI(data.ai as Record<string, unknown>);
		}
		if (typeof data.lastEnhanced === 'string') {
			this.lastEnhanced = data.lastEnhanced;
		}
		this.updateOutput();
	}
}
