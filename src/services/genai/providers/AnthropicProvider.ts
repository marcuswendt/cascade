/**
 * Anthropic Provider
 *
 * Implements AI generation via Anthropic's official SDK for Claude models.
 * Supports LLM text completion and vision.
 */

import Anthropic from '@anthropic-ai/sdk';
import { Provider } from './Provider';
import type {
	ProviderType,
	GenerationRequest,
	GenerationResult,
	GenerationOptions,
	LLMRequest,
	VisionRequest,
	ModelSchema
} from '../types';
import { AIError, AIErrorType } from '../errors';
import { getApiKey } from '../../../editor/stores/settingsStore';
import { claudeModels } from '../models/modelDefinitions';

/** Claude model IDs mapping */
const CLAUDE_MODELS: Record<string, string> = {
	'claude-3-5-sonnet': 'claude-3-5-sonnet-latest',
	'claude-3-5-haiku': 'claude-3-5-haiku-latest',
	'claude-3-opus': 'claude-3-opus-latest'
};

/**
 * Anthropic AI Provider
 *
 * Uses the official @anthropic-ai/sdk for Claude models.
 */
export class AnthropicProvider extends Provider {
	readonly name = 'Anthropic';
	readonly id: ProviderType = 'anthropic';

	private getClient(): Anthropic {
		const apiKey = this.getApiKey();
		if (!apiKey) {
			throw new AIError(AIErrorType.NO_API_KEY, 'Anthropic API key not configured', {
				provider: this.id,
				retryable: false
			});
		}
		return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
	}

	isConfigured(): boolean {
		return !!this.getApiKey();
	}

	protected getApiKey(): string | null {
		return getApiKey('anthropic') ?? null;
	}

	getModels(): ModelSchema[] {
		return claudeModels;
	}

	supportsLLM(): boolean {
		return true;
	}

	supportsVision(): boolean {
		return true;
	}

	/**
	 * Claude doesn't generate images - throw error
	 */
	async generateImages(
		_request: GenerationRequest,
		_options?: GenerationOptions
	): Promise<GenerationResult[]> {
		throw new AIError(
			AIErrorType.INVALID_INPUT,
			'Image generation not supported by Anthropic provider',
			{
				provider: this.id,
				retryable: false
			}
		);
	}

	/**
	 * Complete text using Claude
	 */
	async complete(request: LLMRequest): Promise<string> {
		this.ensureConfigured();

		const client = this.getClient();
		const modelId = CLAUDE_MODELS[request.model] || request.model;

		// Build messages array
		const messages: Anthropic.MessageParam[] = [];

		// Add conversation history
		if (request.messages) {
			for (const msg of request.messages) {
				messages.push({
					role: msg.role === 'assistant' ? 'assistant' : 'user',
					content: msg.content
				});
			}
		}

		// Add current prompt
		messages.push({
			role: 'user',
			content: request.prompt
		});

		try {
			const response = await client.messages.create({
				model: modelId,
				max_tokens: request.maxTokens ?? 1024,
				system: request.systemPrompt,
				messages,
				temperature: request.temperature ?? 0.7
			});

			// Extract text from response
			const textBlock = response.content.find((block) => block.type === 'text');
			if (!textBlock || textBlock.type !== 'text') {
				throw new AIError(AIErrorType.UNKNOWN, 'No text generated', {
					provider: this.id,
					model: request.model,
					retryable: true
				});
			}

			return textBlock.text;
		} catch (error) {
			if (error instanceof AIError) {
				throw error;
			}
			if (error instanceof Anthropic.APIError) {
				throw new AIError(
					error.status === 401 ? AIErrorType.NO_API_KEY : AIErrorType.UNKNOWN,
					`Anthropic API error: ${error.message}`,
					{
						provider: this.id,
						model: request.model,
						retryable: error.status !== 401 && error.status !== 400
					}
				);
			}
			throw new AIError(AIErrorType.UNKNOWN, `Completion failed: ${error}`, {
				provider: this.id,
				model: request.model,
				retryable: true
			});
		}
	}

	/**
	 * Describe an image using Claude vision
	 */
	async describeImage(request: VisionRequest): Promise<string> {
		this.ensureConfigured();

		const client = this.getClient();
		const modelId = CLAUDE_MODELS[request.model] || 'claude-3-5-sonnet-latest';

		// Convert image to base64
		let imageData: string;
		let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

		if ('blob' in request.image) {
			const buffer = await request.image.blob.arrayBuffer();
			const bytes = new Uint8Array(buffer);
			let binary = '';
			for (let i = 0; i < bytes.byteLength; i++) {
				binary += String.fromCharCode(bytes[i]);
			}
			imageData = btoa(binary);
			mediaType = (request.image.blob.type as typeof mediaType) || 'image/png';
		} else if ('url' in request.image) {
			// Fetch image and convert
			const imageResponse = await fetch(request.image.url);
			const blob = await imageResponse.blob();
			const buffer = await blob.arrayBuffer();
			const bytes = new Uint8Array(buffer);
			let binary = '';
			for (let i = 0; i < bytes.byteLength; i++) {
				binary += String.fromCharCode(bytes[i]);
			}
			imageData = btoa(binary);
			mediaType = (blob.type as typeof mediaType) || 'image/png';
		} else {
			throw new AIError(AIErrorType.INVALID_INPUT, 'Invalid image format', {
				provider: this.id,
				retryable: false
			});
		}

		const prompt = request.prompt || 'Describe this image in detail.';

		try {
			const response = await client.messages.create({
				model: modelId,
				max_tokens: request.maxTokens ?? 1024,
				messages: [
					{
						role: 'user',
						content: [
							{
								type: 'image',
								source: {
									type: 'base64',
									media_type: mediaType,
									data: imageData
								}
							},
							{
								type: 'text',
								text: prompt
							}
						]
					}
				]
			});

			// Extract text from response
			const textBlock = response.content.find((block) => block.type === 'text');
			if (!textBlock || textBlock.type !== 'text') {
				throw new AIError(AIErrorType.UNKNOWN, 'No description generated', {
					provider: this.id,
					model: request.model,
					retryable: true
				});
			}

			return textBlock.text;
		} catch (error) {
			if (error instanceof AIError) {
				throw error;
			}
			if (error instanceof Anthropic.APIError) {
				throw new AIError(
					error.status === 401 ? AIErrorType.NO_API_KEY : AIErrorType.UNKNOWN,
					`Anthropic API error: ${error.message}`,
					{
						provider: this.id,
						model: request.model,
						retryable: error.status !== 401 && error.status !== 400
					}
				);
			}
			throw new AIError(AIErrorType.UNKNOWN, `Vision request failed: ${error}`, {
				provider: this.id,
				model: request.model,
				retryable: true
			});
		}
	}
}
