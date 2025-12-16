/**
 * Replicate Provider
 *
 * Implements AI generation via Replicate's API for Flux and SDXL models.
 * Handles the async prediction flow with polling for results.
 */

import { Provider } from './Provider';
import type {
	ProviderType,
	GenerationRequest,
	GenerationResult,
	GenerationOptions,
	EditRequest,
	ModelSchema,
	ImageData
} from '../types';
import { AIError, AIErrorType } from '../errors';
import { getApiKey } from '../../../editor/stores/settingsStore';
import { fluxModels, sdModels, editModels } from '../models/modelDefinitions';

/** Replicate API base URL */
const API_BASE = 'https://api.replicate.com/v1';

/** Model version mappings for Replicate */
const MODEL_VERSIONS: Record<string, string> = {
	// Flux models
	'flux-schnell': 'black-forest-labs/flux-schnell',
	'flux-dev': 'black-forest-labs/flux-dev',
	'flux-pro': 'black-forest-labs/flux-1.1-pro',
	'flux-pro-ultra': 'black-forest-labs/flux-1.1-pro-ultra',

	// SDXL models
	sdxl: 'stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b',
	'sdxl-lightning':
		'bytedance/sdxl-lightning-4step:5f24084160c9089501c1b3545d9be3c27883ae2239b6f412990e82d4a6210f8f',

	// Edit models
	'flux-fill': 'black-forest-labs/flux-fill-pro',
	'flux-canny': 'black-forest-labs/flux-canny-pro',
	'flux-depth': 'black-forest-labs/flux-depth-pro',
	'flux-redux': 'black-forest-labs/flux-redux-dev'
};

/** Replicate prediction status */
type PredictionStatus = 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';

/** Replicate prediction response */
interface ReplicatePrediction {
	id: string;
	status: PredictionStatus;
	output?: string | string[];
	error?: string;
	metrics?: {
		predict_time?: number;
	};
}

/**
 * Replicate AI Provider
 *
 * Supports Flux and SDXL model families for image generation and editing.
 */
export class ReplicateProvider extends Provider {
	readonly name = 'Replicate';
	readonly id: ProviderType = 'replicate';

	isConfigured(): boolean {
		return !!this.getApiKey();
	}

	protected getApiKey(): string | null {
		return getApiKey('replicate') ?? null;
	}

	getModels(): ModelSchema[] {
		return [...fluxModels, ...sdModels, ...editModels];
	}

	supportsEditMode(mode: EditRequest['mode']): boolean {
		return mode === 'inpaint' || mode === 'instruct';
	}

	/**
	 * Generate images using Flux or SDXL models
	 */
	async generateImages(
		request: GenerationRequest,
		options?: GenerationOptions
	): Promise<GenerationResult[]> {
		this.ensureConfigured();

		const modelVersion = MODEL_VERSIONS[request.model];
		if (!modelVersion) {
			throw new AIError(AIErrorType.MODEL_UNAVAILABLE, `Unknown model: ${request.model}`, {
				model: request.model,
				provider: this.id,
				retryable: false
			});
		}

		const results: GenerationResult[] = [];
		const batchSize = request.batchSize ?? 1;

		// Generate each image in the batch
		for (let i = 0; i < batchSize; i++) {
			if (options?.signal?.aborted) {
				throw new AIError(AIErrorType.CANCELLED, 'Generation cancelled', {
					provider: this.id,
					retryable: false
				});
			}

			const seed = request.seed !== undefined ? request.seed + i : Math.floor(Math.random() * 2147483647);

			const input = this.buildInput(request, seed);

			try {
				const result = await this.runPrediction(modelVersion, input, options);
				results.push(result);

				// Report progress
				const progress = ((i + 1) / batchSize) * 100;
				options?.onProgress?.(progress);
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
	 * Edit an image using Flux Fill or instruction models
	 */
	async editImage(request: EditRequest, options?: GenerationOptions): Promise<GenerationResult[]> {
		this.ensureConfigured();

		let modelVersion: string;

		switch (request.mode) {
			case 'inpaint':
				modelVersion = MODEL_VERSIONS['flux-fill'];
				break;
			case 'instruct':
				modelVersion = MODEL_VERSIONS['flux-redux'];
				break;
			default:
				throw new AIError(AIErrorType.INVALID_INPUT, `Edit mode "${request.mode}" not supported`, {
					provider: this.id,
					retryable: false
				});
		}

		const seed =
			request.seed !== undefined ? request.seed : Math.floor(Math.random() * 2147483647);

		const input = await this.buildEditInput(request, seed);

		const result = await this.runPrediction(modelVersion, input, options);
		return [result];
	}

	/**
	 * Build input parameters for generation
	 */
	private buildInput(
		request: GenerationRequest,
		seed: number
	): Record<string, unknown> {
		const input: Record<string, unknown> = {
			prompt: request.prompt,
			seed
		};

		// Add dimensions if specified
		if (request.width) input.width = request.width;
		if (request.height) input.height = request.height;

		// Add negative prompt if supported and provided
		if (request.negativePrompt) {
			input.negative_prompt = request.negativePrompt;
		}

		// Model-specific parameters
		if (request.model.startsWith('flux-')) {
			// Flux-specific params
			if (request.model === 'flux-dev') {
				input.num_inference_steps = 28;
				input.guidance = 3.5;
			} else if (request.model === 'flux-schnell') {
				input.num_inference_steps = 4;
			}
		} else if (request.model.startsWith('sdxl')) {
			// SDXL-specific params
			input.num_inference_steps = request.model === 'sdxl-lightning' ? 4 : 30;
			input.guidance_scale = 7.5;
		}

		// Add reference images if provided
		if (request.references && request.references.length > 0) {
			const styleRef = request.references.find((r) => r.type === 'style');
			if (styleRef) {
				input.image = styleRef.imageUrl;
				input.image_strength = request.referenceStrength ?? 0.35;
			}
		}

		return input;
	}

	/**
	 * Build input parameters for edit operations
	 */
	private async buildEditInput(
		request: EditRequest,
		seed: number
	): Promise<Record<string, unknown>> {
		const input: Record<string, unknown> = {
			prompt: request.instruction,
			seed
		};

		// Convert image to base64 data URL
		if (request.image) {
			input.image = await this.imageBufferToDataUrl(request.image);
		}

		// Add mask for inpainting
		if (request.mode === 'inpaint' && request.mask) {
			input.mask = await this.imageBufferToDataUrl(request.mask);
		}

		return input;
	}

	/**
	 * Convert ImageData to data URL for API requests
	 */
	private async imageBufferToDataUrl(
		imageData: ImageData
	): Promise<string> {
		// Handle URL-based image data
		if ('url' in imageData) {
			return imageData.url;
		}

		// Handle Blob-based image data
		if ('blob' in imageData) {
			return new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onloadend = () => resolve(reader.result as string);
				reader.onerror = reject;
				reader.readAsDataURL(imageData.blob);
			});
		}

		// Handle ImageBuffer - convert to canvas then to data URL
		// (This is the least common case - providers usually receive blobs)
		const canvas = imageData.toCanvas();
		return canvas.toDataURL('image/png');
	}

	/**
	 * Run a prediction and poll for results
	 */
	private async runPrediction(
		model: string,
		input: Record<string, unknown>,
		options?: GenerationOptions
	): Promise<GenerationResult> {
		// Create prediction
		const createResponse = await this.fetchWithAuth(`${API_BASE}/predictions`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				version: model.includes(':') ? model.split(':')[1] : undefined,
				model: model.includes(':') ? undefined : model,
				input
			}),
			signal: options?.signal
		});

		const prediction = await this.handleResponse<ReplicatePrediction>(createResponse, model);

		// Poll for completion
		const result = await this.pollWithTimeout<ReplicatePrediction>(
			async () => {
				const pollResponse = await this.fetchWithAuth(
					`${API_BASE}/predictions/${prediction.id}`,
					{ signal: options?.signal }
				);
				const status = await pollResponse.json();

				if (status.status === 'failed') {
					return { done: true, error: status.error || 'Prediction failed' };
				}

				if (status.status === 'canceled') {
					return { done: true, error: 'Prediction was canceled' };
				}

				if (status.status === 'succeeded') {
					return { done: true, result: status };
				}

				return { done: false };
			},
			{
				intervalMs: 1000,
				timeoutMs: 300000,
				signal: options?.signal,
				onProgress: options?.onProgress
			}
		);

		// Extract output URL
		const outputUrl = Array.isArray(result.output) ? result.output[0] : result.output;

		if (!outputUrl) {
			throw new AIError(AIErrorType.UNKNOWN, 'No output returned from prediction', {
				provider: this.id,
				retryable: true
			});
		}

		// Download the image
		const imageBlob = await this.downloadImage(outputUrl);

		return {
			id: this.generateResultId(),
			seed: (input.seed as number) ?? 0,
			imageBuffer: { blob: imageBlob },
			thumbnailUrl: outputUrl,
			prompt: (input.prompt as string) ?? '',
			negativePrompt: (input.negative_prompt as string) ?? undefined,
			model,
			provider: this.id,
			timestamp: new Date(),
			metadata: {
				predictionId: result.id,
				predictTime: result.metrics?.predict_time
			}
		};
	}

	/**
	 * Override auth header for Replicate's token format
	 */
	protected addAuthHeaders(headers: Headers, apiKey: string): void {
		headers.set('Authorization', `Token ${apiKey}`);
	}
}
