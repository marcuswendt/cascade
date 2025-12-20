/**
 * Google Provider
 *
 * Implements AI generation via Google's Gen AI SDK for Gemini and Imagen models.
 * Supports image generation, LLM text completion, and vision.
 */

import { GoogleGenAI } from '@google/genai';
import { Provider } from './Provider';
import type {
	ProviderType,
	GenerationRequest,
	GenerationResult,
	GenerationOptions,
	LLMRequest,
	VisionRequest,
	ModelSchema,
	LLMStreamRequest,
	LLMStreamChunk,
	LLMContentPart
} from '../types';
import { AIError, AIErrorType } from '../errors';
import { getApiKey } from '../../../editor/stores/settingsStore';
import { googleImageModels, geminiModels } from '../models/modelDefinitions';

/** Cache for dynamically fetched models */
let cachedGeminiModels: ModelSchema[] | null = null;
let modelsFetchPromise: Promise<ModelSchema[]> | null = null;

/**
 * Google AI Provider
 *
 * Uses the official @google/genai SDK for Gemini and Imagen.
 */
export class GoogleProvider extends Provider {
	readonly name = 'Google';
	readonly id: ProviderType = 'google';

	private getClient(): GoogleGenAI {
		const apiKey = this.getApiKey();
		if (!apiKey) {
			throw new AIError(AIErrorType.NO_API_KEY, 'Google API key not configured', {
				provider: this.id,
				retryable: false
			});
		}
		return new GoogleGenAI({ apiKey });
	}

	isConfigured(): boolean {
		return !!this.getApiKey();
	}

	protected getApiKey(): string | null {
		return getApiKey('google') ?? null;
	}

	/**
	 * Fetch available Gemini models from the API
	 * Results are cached to avoid repeated API calls
	 */
	async refreshModels(): Promise<ModelSchema[]> {
		// Return cached if available
		if (cachedGeminiModels) {
			return cachedGeminiModels;
		}

		// Return existing promise if already fetching
		if (modelsFetchPromise) {
			return modelsFetchPromise;
		}

		// Not configured - return static models
		if (!this.isConfigured()) {
			return geminiModels;
		}

		modelsFetchPromise = this.fetchModelsFromAPI();
		return modelsFetchPromise;
	}

	/**
	 * Internal method to fetch models from Google API
	 */
	private async fetchModelsFromAPI(): Promise<ModelSchema[]> {
		try {
			const ai = this.getClient();
			const response = await ai.models.list();

			const dynamicModels: ModelSchema[] = [];

			for await (const model of response) {
				// Skip non-Gemini models and deprecated ones
				if (!model.name?.includes('gemini')) continue;
				if (model.name?.includes('legacy') || model.name?.includes('deprecated')) continue;

				// Extract model ID from full name (e.g., "models/gemini-2.0-flash" -> "gemini-2.0-flash")
				const modelId = model.name?.replace('models/', '') || '';
				if (!modelId) continue;

				// Determine capabilities based on model name/description
				const capabilities: Array<'llm' | 'vision' | 'generate' | 'inpaint' | 'outpaint' | 'instruct'> = [];
				const desc = (model.description || '').toLowerCase();
				const name = modelId.toLowerCase();

				// All Gemini models support LLM
				capabilities.push('llm');

				// Most Gemini models support vision (multimodal)
				if (!name.includes('text-only')) {
					capabilities.push('vision');
				}

				// Determine category based on model name
				let category: 'fast' | 'quality' | 'specialized' = 'quality';
				if (name.includes('flash')) {
					category = 'fast';
				} else if (name.includes('pro')) {
					category = 'quality';
				}

				// Format display name
				const displayName = model.displayName || this.formatModelName(modelId);

				dynamicModels.push({
					id: modelId,
					name: displayName,
					provider: 'google',
					endpoint: modelId,
					capabilities,
					supportsImageInput: capabilities.includes('vision'),
					supportedReferenceTypes: [],
					supportsNegativePrompt: false,
					supportsBatchGeneration: false,
					maxBatchSize: 1,
					parameters: [
						{
							name: 'temperature',
							type: 'number',
							default: 0.7,
							min: 0,
							max: 2,
							step: 0.1,
							description: 'Temperature (higher = more creative)'
						},
						{
							name: 'maxOutputTokens',
							type: 'number',
							default: 4096,
							min: 1,
							max: 8192,
							step: 128,
							description: 'Maximum output tokens',
							advanced: true
						}
					],
					defaultWidth: 1024,
					defaultHeight: 1024,
					maxResolution: 1024 * 1024,
					outputFormat: 'png',
					category
				});
			}

			// Sort: flash first, then pro, then others
			dynamicModels.sort((a, b) => {
				const aFlash = a.id.includes('flash') ? 0 : 1;
				const bFlash = b.id.includes('flash') ? 0 : 1;
				if (aFlash !== bFlash) return aFlash - bFlash;

				// Sort by version (higher first)
				const aVersion = this.extractVersion(a.id);
				const bVersion = this.extractVersion(b.id);
				return bVersion - aVersion;
			});

			cachedGeminiModels = dynamicModels;
			console.log('[GoogleProvider] Fetched', dynamicModels.length, 'models from API');
			return dynamicModels;
		} catch (error) {
			console.warn('[GoogleProvider] Failed to fetch models from API, using static list:', error);
			modelsFetchPromise = null;
			return geminiModels;
		}
	}

	/**
	 * Format model ID into display name
	 */
	private formatModelName(modelId: string): string {
		return modelId
			.split('-')
			.map(part => part.charAt(0).toUpperCase() + part.slice(1))
			.join(' ');
	}

	/**
	 * Extract version number from model ID
	 */
	private extractVersion(modelId: string): number {
		const match = modelId.match(/(\d+(?:\.\d+)?)/);
		return match ? parseFloat(match[1]) : 0;
	}

	/**
	 * Get cached models or static fallback (synchronous)
	 */
	getModels(): ModelSchema[] {
		// Return cached dynamic models if available
		if (cachedGeminiModels) {
			return [...googleImageModels, ...cachedGeminiModels];
		}
		// Trigger async fetch for next time (fire and forget)
		if (this.isConfigured() && !modelsFetchPromise) {
			this.refreshModels();
		}
		// Return static models for now
		return [...googleImageModels, ...geminiModels];
	}

	supportsLLM(): boolean {
		return true;
	}

	supportsVision(): boolean {
		return true;
	}

	/**
	 * Generate images using Gemini 2.0's image generation capability
	 */
	async generateImages(
		request: GenerationRequest,
		options?: GenerationOptions
	): Promise<GenerationResult[]> {
		this.ensureConfigured();

		const ai = this.getClient();
		const batchSize = request.batchSize ?? 1;
		const results: GenerationResult[] = [];

		for (let i = 0; i < batchSize; i++) {
			if (options?.signal?.aborted) {
				throw new AIError(AIErrorType.CANCELLED, 'Generation cancelled', {
					provider: this.id,
					retryable: false
				});
			}

			const seed =
				request.seed !== undefined ? request.seed + i : Math.floor(Math.random() * 2147483647);

			try {
				const response = await ai.models.generateContent({
					model: 'gemini-2.0-flash-exp',
					contents: [
						{
							role: 'user',
							parts: [{ text: `Generate an image: ${request.prompt}` }]
						}
					],
					config: {
						responseModalities: ['image', 'text'],
						temperature: 1.0
					}
				});

				// Extract image from response
				const candidates = response.candidates;
				if (!candidates || candidates.length === 0) {
					throw new AIError(AIErrorType.UNKNOWN, 'No candidates in response', {
						provider: this.id,
						model: request.model,
						retryable: true
					});
				}

				const parts = candidates[0]?.content?.parts;
				const imagePart = parts?.find((p: any) => p.inlineData);

				if (!imagePart?.inlineData?.data) {
					throw new AIError(AIErrorType.UNKNOWN, 'No image generated', {
						provider: this.id,
						model: request.model,
						retryable: true
					});
				}

				// Convert base64 to blob
				const base64Data = imagePart.inlineData.data;
				const mimeType = imagePart.inlineData.mimeType || 'image/png';
				const byteCharacters = atob(base64Data);
				const byteNumbers = new Array(byteCharacters.length);
				for (let j = 0; j < byteCharacters.length; j++) {
					byteNumbers[j] = byteCharacters.charCodeAt(j);
				}
				const byteArray = new Uint8Array(byteNumbers);
				const blob = new Blob([byteArray], { type: mimeType });

				// Create data URL for thumbnail
				const thumbnailUrl = `data:${mimeType};base64,${base64Data}`;

				results.push({
					id: this.generateResultId(),
					seed,
					imageBuffer: { blob },
					thumbnailUrl,
					prompt: request.prompt,
					negativePrompt: request.negativePrompt,
					model: request.model,
					provider: this.id,
					timestamp: new Date(),
					metadata: {}
				});

				options?.onProgress?.(((i + 1) / batchSize) * 100);
			} catch (error) {
				if (error instanceof AIError) {
					throw error;
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
	 * Complete text using Gemini
	 */
	async complete(request: LLMRequest): Promise<string> {
		this.ensureConfigured();

		const ai = this.getClient();
		const modelId = request.model;

		// Build contents array
		const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

		// Add system prompt if provided (as user/model exchange)
		if (request.systemPrompt) {
			contents.push({
				role: 'user',
				parts: [{ text: request.systemPrompt }]
			});
			contents.push({
				role: 'model',
				parts: [{ text: 'Understood. I will follow these instructions.' }]
			});
		}

		// Add conversation history
		if (request.messages) {
			for (const msg of request.messages) {
				contents.push({
					role: msg.role === 'assistant' ? 'model' : 'user',
					parts: [{ text: msg.content }]
				});
			}
		}

		// Add current prompt
		contents.push({
			role: 'user',
			parts: [{ text: request.prompt }]
		});

		try {
			const response = await ai.models.generateContent({
				model: modelId,
				contents,
				config: {
					temperature: request.temperature ?? 0.7,
					maxOutputTokens: request.maxTokens ?? 2048,
					topP: 0.95
				}
			});

			const text = response.text;

			if (!text) {
				throw new AIError(AIErrorType.UNKNOWN, 'No text generated', {
					provider: this.id,
					model: request.model,
					retryable: true
				});
			}

			return text;
		} catch (error) {
			if (error instanceof AIError) {
				throw error;
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
	 * Stream text completion using Gemini
	 */
	async *streamComplete(request: LLMStreamRequest): AsyncGenerator<LLMStreamChunk> {
		this.ensureConfigured();

		const ai = this.getClient();
		const modelId = request.model;

		console.log('[GoogleProvider] Starting stream for model:', modelId);

		// Build contents array
		const contents: Array<{ role: string; parts: Array<{ text?: string; inlineData?: any }> }> = [];

		// Handle system prompt
		const systemMsg = request.messages.find((m) => m.role === 'system');
		const systemPrompt =
			request.systemPrompt ||
			(typeof systemMsg?.content === 'string' ? systemMsg.content : undefined);

		if (systemPrompt) {
			contents.push({
				role: 'user',
				parts: [{ text: systemPrompt }]
			});
			contents.push({
				role: 'model',
				parts: [{ text: 'Understood. I will follow these instructions.' }]
			});
		}

		// Add conversation messages (excluding system)
		for (const msg of request.messages.filter((m) => m.role !== 'system')) {
			contents.push({
				role: msg.role === 'assistant' ? 'model' : 'user',
				parts: this.formatGeminiParts(msg.content)
			});
		}

		console.log('[GoogleProvider] Request contents:', contents.length, 'messages');

		try {
			const response = await ai.models.generateContentStream({
				model: modelId,
				contents,
				config: {
					temperature: request.temperature ?? 0.7,
					maxOutputTokens: request.maxTokens ?? 4096,
					topP: 0.95
				}
			});

			console.log('[GoogleProvider] Got stream response, iterating...');

			let totalChars = 0;
			for await (const chunk of response) {
				const text = chunk.text;
				if (text) {
					yield { type: 'delta', content: text };
					totalChars += text.length;
				}
			}

			console.log('[GoogleProvider] Stream complete, totalChars:', totalChars);

			// Gemini doesn't provide exact token counts in stream, estimate
			yield {
				type: 'usage',
				usage: {
					input: 0, // Would need to call countTokens separately
					output: Math.ceil(totalChars / 4), // Rough estimate
					total: Math.ceil(totalChars / 4)
				}
			};

			yield { type: 'done', finishReason: 'stop' };
		} catch (error) {
			console.error('[GoogleProvider] Stream error:', error);
			yield {
				type: 'error',
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}

	/**
	 * Format content parts for Gemini API
	 */
	private formatGeminiParts(
		content: string | LLMContentPart[]
	): Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> {
		if (typeof content === 'string') {
			return [{ text: content }];
		}

		return content.map((part) => {
			if (part.type === 'text') {
				return { text: part.text || '' };
			}
			if (part.type === 'image' && part.image) {
				return {
					inlineData: {
						mimeType: part.image.mediaType || 'image/png',
						data: part.image.data
					}
				};
			}
			return { text: '' };
		});
	}

	/**
	 * Describe an image using Gemini vision
	 */
	async describeImage(request: VisionRequest): Promise<string> {
		this.ensureConfigured();

		const ai = this.getClient();
		const modelId = request.model || 'gemini-2.0-flash';

		// Convert image to base64
		let imageData: string;
		let mimeType: string;

		if ('blob' in request.image) {
			const buffer = await request.image.blob.arrayBuffer();
			const bytes = new Uint8Array(buffer);
			let binary = '';
			for (let i = 0; i < bytes.byteLength; i++) {
				binary += String.fromCharCode(bytes[i]);
			}
			imageData = btoa(binary);
			mimeType = request.image.blob.type || 'image/png';
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
			mimeType = blob.type || 'image/png';
		} else {
			throw new AIError(AIErrorType.INVALID_INPUT, 'Invalid image format', {
				provider: this.id,
				retryable: false
			});
		}

		const prompt = request.prompt || 'Describe this image in detail.';

		try {
			const response = await ai.models.generateContent({
				model: modelId,
				contents: [
					{
						role: 'user',
						parts: [
							{
								inlineData: {
									mimeType,
									data: imageData
								}
							},
							{ text: prompt }
						]
					}
				],
				config: {
					temperature: 0.4,
					maxOutputTokens: 1024
				}
			});

			const text = response.text;

			if (!text) {
				throw new AIError(AIErrorType.UNKNOWN, 'No description generated', {
					provider: this.id,
					model: request.model,
					retryable: true
				});
			}

			return text;
		} catch (error) {
			if (error instanceof AIError) {
				throw error;
			}
			throw new AIError(AIErrorType.UNKNOWN, `Vision request failed: ${error}`, {
				provider: this.id,
				model: request.model,
				retryable: true
			});
		}
	}
}
