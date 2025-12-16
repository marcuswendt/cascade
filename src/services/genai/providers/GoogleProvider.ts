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
	ModelSchema
} from '../types';
import { AIError, AIErrorType } from '../errors';
import { getApiKey } from '../../../editor/stores/settingsStore';
import { googleImageModels, geminiModels } from '../models/modelDefinitions';

/** Gemini model IDs */
const GEMINI_MODELS: Record<string, string> = {
	'gemini-1.5-flash': 'gemini-1.5-flash',
	'gemini-1.5-pro': 'gemini-1.5-pro',
	'gemini-2.0-flash': 'gemini-2.0-flash-exp'
};

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

	getModels(): ModelSchema[] {
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
		const modelId = GEMINI_MODELS[request.model] || request.model;

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
	 * Describe an image using Gemini vision
	 */
	async describeImage(request: VisionRequest): Promise<string> {
		this.ensureConfigured();

		const ai = this.getClient();
		const modelId = GEMINI_MODELS[request.model] || 'gemini-1.5-flash';

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
