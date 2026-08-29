/**
 * OpenAI Provider
 *
 * Implements AI generation via OpenAI's official SDK for DALL-E image generation,
 * GPT-4 Vision for image description, and GPT models for text completion.
 */

import OpenAI from 'openai';
import { Provider } from './Provider';
import type {
	ProviderType,
	GenerationRequest,
	GenerationResult,
	GenerationOptions,
	EditRequest,
	LLMRequest,
	VisionRequest,
	ModelSchema,
	ImageData,
	LLMStreamRequest,
	LLMStreamChunk,
	LLMContentPart
} from '../types';
import { AIError, AIErrorType } from '../errors';
import { getApiKey } from '../../../editor/stores/settingsStore';
import { openAIImageModels, openAIModels } from '../models/modelDefinitions';

/** DALL-E model IDs */
const DALL_E_MODELS = ['dall-e-2', 'dall-e-3'];

/**
 * OpenAI AI Provider
 *
 * Uses the official OpenAI SDK for DALL-E image generation, GPT-4 Vision,
 * and GPT models for text completion.
 */
export class OpenAIProvider extends Provider {
	readonly name = 'OpenAI';
	readonly id: ProviderType = 'openai';

	private getClient(): OpenAI {
		const apiKey = this.getApiKey();
		if (!apiKey) {
			throw new AIError(AIErrorType.NO_API_KEY, 'OpenAI API key not configured', {
				provider: this.id,
				retryable: false
			});
		}
		return new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
	}

	isConfigured(): boolean {
		return !!this.getApiKey();
	}

	protected getApiKey(): string | null {
		return getApiKey('openai') ?? null;
	}

	getModels(): ModelSchema[] {
		return [...openAIImageModels, ...openAIModels];
	}

	supportsLLM(): boolean {
		return true;
	}

	supportsVision(): boolean {
		return true;
	}

	supportsEditMode(_mode: EditRequest['mode']): boolean {
		return false;
	}

	/**
	 * Generate images using DALL-E
	 */
	async generateImages(
		request: GenerationRequest,
		options?: GenerationOptions
	): Promise<GenerationResult[]> {
		this.ensureConfigured();

		if (!DALL_E_MODELS.includes(request.model)) {
			throw new AIError(AIErrorType.MODEL_UNAVAILABLE, `Unknown model: ${request.model}`, {
				model: request.model,
				provider: this.id,
				retryable: false
			});
		}

		const client = this.getClient();
		const results: GenerationResult[] = [];
		const batchSize = request.batchSize ?? 1;

		// DALL-E 3 only supports batch size of 1
		const effectiveBatchSize = request.model === 'dall-e-3' ? 1 : Math.min(batchSize, 4);

		for (let i = 0; i < effectiveBatchSize; i++) {
			if (options?.signal?.aborted) {
				throw new AIError(AIErrorType.CANCELLED, 'Generation cancelled', {
					provider: this.id,
					retryable: false
				});
			}

			const seed = request.seed !== undefined ? request.seed + i : undefined;

			try {
				const response = await client.images.generate({
					model: request.model as 'dall-e-2' | 'dall-e-3',
					prompt: request.prompt,
					n: 1,
					size: this.getSizeString(request.width, request.height, request.model),
					response_format: 'url',
					quality: request.model === 'dall-e-3' ? 'standard' : undefined,
					style: request.model === 'dall-e-3' ? 'vivid' : undefined
				});

				const imageData = response.data?.[0];
				if (!imageData?.url) {
					throw new AIError(AIErrorType.UNKNOWN, 'No image URL in response', {
						provider: this.id,
						retryable: true
					});
				}

				// Download the image
				const imageBlob = await this.downloadImage(imageData.url);

				results.push({
					id: this.generateResultId(),
					seed: seed ?? 0,
					imageBuffer: { blob: imageBlob },
					thumbnailUrl: imageData.url,
					prompt: imageData.revised_prompt || request.prompt,
					model: request.model,
					provider: this.id,
					timestamp: new Date(),
					metadata: {
						revisedPrompt: imageData.revised_prompt
					}
				});

				options?.onProgress?.(((i + 1) / effectiveBatchSize) * 100);
			} catch (error) {
				if (error instanceof AIError) {
					throw error;
				}
				if (error instanceof OpenAI.APIError) {
					throw new AIError(
						error.status === 401 ? AIErrorType.NO_API_KEY : AIErrorType.UNKNOWN,
						`OpenAI API error: ${error.message}`,
						{
							provider: this.id,
							model: request.model,
							retryable: error.status !== 401 && error.status !== 400
						}
					);
				}
				throw new AIError(AIErrorType.UNKNOWN, `Generation failed: ${error}`, {
					provider: this.id,
					model: request.model,
					retryable: true
				});
			}
		}

		return results;
	}

	/**
	 * Convert width/height to DALL-E size string
	 */
	private getSizeString(
		width?: number,
		height?: number,
		model?: string
	): '256x256' | '512x512' | '1024x1024' | '1792x1024' | '1024x1792' {
		const w = width ?? 1024;
		const h = height ?? 1024;

		// DALL-E 2 supports: 256x256, 512x512, 1024x1024
		// DALL-E 3 supports: 1024x1024, 1792x1024, 1024x1792
		if (model === 'dall-e-2') {
			if (w <= 256 && h <= 256) return '256x256';
			if (w <= 512 && h <= 512) return '512x512';
			return '1024x1024';
		}

		// DALL-E 3
		if (w === h) return '1024x1024';
		if (w > h) return '1792x1024';
		return '1024x1792';
	}

	/**
	 * Complete text using GPT models
	 */
	async complete(request: LLMRequest): Promise<string> {
		this.ensureConfigured();

		const client = this.getClient();
		const messages: OpenAI.ChatCompletionMessageParam[] = [];

		if (request.systemPrompt) {
			messages.push({ role: 'system', content: request.systemPrompt });
		}

		if (request.messages) {
			for (const msg of request.messages) {
				messages.push({
					role: msg.role,
					content: msg.content
				});
			}
		}

		messages.push({ role: 'user', content: request.prompt });

		try {
			const response = await client.chat.completions.create({
				model: request.model,
				messages,
				max_tokens: request.maxTokens ?? 1000,
				temperature: request.temperature ?? 0.7
			});

			const content = response.choices[0]?.message?.content;
			if (!content) {
				throw new AIError(AIErrorType.UNKNOWN, 'No response from OpenAI', {
					provider: this.id,
					model: request.model,
					retryable: true
				});
			}

			return content;
		} catch (error) {
			if (error instanceof AIError) {
				throw error;
			}
			if (error instanceof OpenAI.APIError) {
				throw new AIError(
					error.status === 401 ? AIErrorType.NO_API_KEY : AIErrorType.UNKNOWN,
					`OpenAI API error: ${error.message}`,
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
	 * Check if this provider supports streaming LLM
	 */
	supportsLLMStreaming(): boolean {
		return true;
	}

	/**
	 * Stream text completion using GPT models
	 */
	async *streamComplete(request: LLMStreamRequest): AsyncGenerator<LLMStreamChunk> {
		this.ensureConfigured();

		const client = this.getClient();

		// Build messages array
		const messages: OpenAI.ChatCompletionMessageParam[] = [];

		// Add messages from request
		for (const msg of request.messages) {
			if (msg.role === 'system') {
				messages.push({
					role: 'system',
					content: typeof msg.content === 'string' ? msg.content : ''
				});
			} else if (msg.role === 'assistant') {
				// Assistant messages can't carry multi-part content (image_url etc.) in
				// OpenAI's types — only user messages can. Real assistant replies are
				// always plain text; coerce rather than widen the push-site type.
				const content = this.formatMessageContent(msg.content);
				messages.push({
					role: 'assistant',
					content: typeof content === 'string' ? content : ''
				});
			} else {
				messages.push({
					role: 'user',
					content: this.formatMessageContent(msg.content)
				});
			}
		}

		// Add separate system prompt if provided and not in messages
		if (request.systemPrompt && !messages.some((m) => m.role === 'system')) {
			messages.unshift({ role: 'system', content: request.systemPrompt });
		}

		try {
			const stream = await client.chat.completions.create({
				model: request.model,
				messages,
				max_tokens: request.maxTokens ?? 4096,
				temperature: request.temperature ?? 0.7,
				stream: true,
				stream_options: { include_usage: true }
			});

			for await (const chunk of stream) {
				const delta = chunk.choices[0]?.delta?.content;
				if (delta) {
					yield { type: 'delta', content: delta };
				}

				// Usage comes in the final chunk
				if (chunk.usage) {
					yield {
						type: 'usage',
						usage: {
							input: chunk.usage.prompt_tokens,
							output: chunk.usage.completion_tokens,
							total: chunk.usage.total_tokens
						}
					};
				}

				// Check finish reason
				const finishReason = chunk.choices[0]?.finish_reason;
				if (finishReason) {
					yield {
						type: 'done',
						finishReason:
							finishReason === 'stop'
								? 'stop'
								: finishReason === 'length'
									? 'length'
									: finishReason === 'content_filter'
										? 'content_filter'
										: 'stop'
					};
				}
			}
		} catch (error) {
			if (error instanceof OpenAI.APIError) {
				yield {
					type: 'error',
					error: `OpenAI API error: ${error.message}`
				};
			} else {
				yield {
					type: 'error',
					error: error instanceof Error ? error.message : String(error)
				};
			}
		}
	}

	/**
	 * Format message content for OpenAI API
	 */
	private formatMessageContent(
		content: string | LLMContentPart[]
	): string | OpenAI.ChatCompletionContentPart[] {
		if (typeof content === 'string') {
			return content;
		}

		return content.map((part) => {
			if (part.type === 'text') {
				return { type: 'text' as const, text: part.text || '' };
			}
			if (part.type === 'image' && part.image) {
				return {
					type: 'image_url' as const,
					image_url: {
						url:
							part.image.source === 'url'
								? part.image.data
								: `data:${part.image.mediaType || 'image/png'};base64,${part.image.data}`
					}
				};
			}
			return { type: 'text' as const, text: '' };
		});
	}

	/**
	 * Describe an image using GPT-4 Vision
	 */
	async describeImage(request: VisionRequest): Promise<string> {
		this.ensureConfigured();

		const client = this.getClient();
		const imageBase64 = await this.imageDataToBase64(request.image);

		try {
			const response = await client.chat.completions.create({
				model: request.model || 'gpt-4o',
				messages: [
					{
						role: 'user',
						content: [
							{
								type: 'text',
								text: request.prompt || 'Describe this image in detail.'
							},
							{
								type: 'image_url',
								image_url: {
									url: `data:image/png;base64,${imageBase64}`
								}
							}
						]
					}
				],
				max_tokens: request.maxTokens ?? 1024
			});

			const content = response.choices[0]?.message?.content;
			if (!content) {
				throw new AIError(AIErrorType.UNKNOWN, 'No description generated', {
					provider: this.id,
					model: request.model,
					retryable: true
				});
			}

			return content;
		} catch (error) {
			if (error instanceof AIError) {
				throw error;
			}
			if (error instanceof OpenAI.APIError) {
				throw new AIError(
					error.status === 401 ? AIErrorType.NO_API_KEY : AIErrorType.UNKNOWN,
					`OpenAI API error: ${error.message}`,
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

	/**
	 * Convert ImageData to base64 string
	 */
	private async imageDataToBase64(imageData: ImageData): Promise<string> {
		if ('url' in imageData) {
			if (imageData.url.startsWith('data:')) {
				const commaIndex = imageData.url.indexOf(',');
				return imageData.url.substring(commaIndex + 1);
			}
			const blob = await this.downloadImage(imageData.url);
			return this.blobToBase64(blob);
		}

		if ('blob' in imageData) {
			return this.blobToBase64(imageData.blob);
		}

		// Handle ImageBuffer
		const canvas = imageData.toCanvas();
		return canvas.toDataURL('image/png').split(',')[1];
	}

	/**
	 * Convert Blob to base64
	 */
	private blobToBase64(blob: Blob): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onloadend = () => {
				const result = reader.result as string;
				const commaIndex = result.indexOf(',');
				resolve(result.substring(commaIndex + 1));
			};
			reader.onerror = reject;
			reader.readAsDataURL(blob);
		});
	}
}
