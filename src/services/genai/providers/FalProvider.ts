/**
 * Fal Provider
 *
 * Implements AI generation via Fal.ai's API for Flux and other models.
 * Similar to Replicate but with different API structure.
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

/** Fal API base URL */
const API_BASE = 'https://fal.run';

/** Model endpoint mappings for Fal */
const MODEL_ENDPOINTS: Record<string, string> = {
	// Flux models
	'flux-schnell': 'fal-ai/flux/schnell',
	'flux-dev': 'fal-ai/flux/dev',
	'flux-pro': 'fal-ai/flux/pro',
	'flux-pro-ultra': 'fal-ai/flux/pro-ultra',

	// Edit models
	'flux-fill': 'fal-ai/flux/fill',
	'flux-canny': 'fal-ai/flux/canny',
	'flux-depth': 'fal-ai/flux/depth'
};

/** Fal job status */
type FalStatus = 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';

/** Fal job response */
interface FalJob {
	request_id: string;
	status: FalStatus;
	output?: {
		images?: Array<{ url: string }>;
		image?: { url: string };
	};
	error?: {
		message: string;
	};
}

/**
 * Fal AI Provider
 *
 * Supports Flux models via Fal.ai's API.
 */
export class FalProvider extends Provider {
	readonly name = 'Fal.ai';
	readonly id: ProviderType = 'fal';

	isConfigured(): boolean {
		return !!this.getApiKey();
	}

	protected getApiKey(): string | null {
		return getApiKey('fal') ?? null;
	}

	getModels(): ModelSchema[] {
		// Fal supports similar models to Replicate
		// Return empty for now - models will be registered separately
		// This allows Fal models to be defined in modelDefinitions.ts
		return [];
	}

	supportsEditMode(mode: EditRequest['mode']): boolean {
		return mode === 'inpaint' || mode === 'instruct';
	}

	/**
	 * Generate images using Fal.ai models
	 */
	async generateImages(
		request: GenerationRequest,
		options?: GenerationOptions
	): Promise<GenerationResult[]> {
		this.ensureConfigured();

		const endpoint = MODEL_ENDPOINTS[request.model];
		if (!endpoint) {
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
				const result = await this.runJob(endpoint, input, options);
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
	 * Edit an image using Fal.ai models
	 */
	async editImage(request: EditRequest, options?: GenerationOptions): Promise<GenerationResult[]> {
		this.ensureConfigured();

		let endpoint: string;

		switch (request.mode) {
			case 'inpaint':
				endpoint = MODEL_ENDPOINTS['flux-fill'];
				break;
			case 'instruct':
				// Fal doesn't have a direct instruct model, use flux-fill with instruction
				endpoint = MODEL_ENDPOINTS['flux-fill'];
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

		const result = await this.runJob(endpoint, input, options);
		return [result];
	}

	/**
	 * Build input parameters for generation
	 */
	private buildInput(request: GenerationRequest, seed: number): Record<string, unknown> {
		const input: Record<string, unknown> = {
			prompt: request.prompt,
			seed
		};

		// Add dimensions if specified
		if (request.width) input.width = request.width;
		if (request.height) input.height = request.height;

		// Add negative prompt if provided
		if (request.negativePrompt) {
			input.negative_prompt = request.negativePrompt;
		}

		// Model-specific parameters
		if (request.model.startsWith('flux-')) {
			if (request.model === 'flux-schnell') {
				input.num_inference_steps = 4;
			} else if (request.model === 'flux-dev' || request.model === 'flux-pro') {
				input.num_inference_steps = 28;
				input.guidance_scale = 3.5;
			}
		}

		// Add reference images if provided
		if (request.references && request.references.length > 0) {
			const styleRef = request.references.find((r) => r.type === 'style');
			if (styleRef) {
				input.image_url = styleRef.imageUrl;
				input.strength = request.referenceStrength ?? 0.35;
			}
		}

		// Add model-specific parameters
		if (request.parameters) {
			Object.assign(input, request.parameters);
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

		// Convert image to URL or data URL
		if (request.image) {
			input.image_url = await this.imageDataToUrl(request.image);
		}

		// Add mask for inpainting
		if (request.mode === 'inpaint' && request.mask) {
			input.mask_image_url = await this.imageDataToUrl(request.mask);
		}

		// Add strength for instruct mode
		if (request.mode === 'instruct' && request.strength !== undefined) {
			input.strength = request.strength;
		}

		return input;
	}

	/**
	 * Convert ImageData to URL for API requests
	 */
	private async imageDataToUrl(imageData: ImageData): Promise<string> {
		// Handle URL-based image data
		if ('url' in imageData) {
			return imageData.url;
		}

		// Handle Blob-based image data - convert to data URL
		if ('blob' in imageData) {
			return new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onloadend = () => resolve(reader.result as string);
				reader.onerror = reject;
				reader.readAsDataURL(imageData.blob);
			});
		}

		// Handle ImageBuffer - convert to canvas then to data URL
		const canvas = imageData.toCanvas();
		return canvas.toDataURL('image/png');
	}

	/**
	 * Run a job and poll for results
	 */
	private async runJob(
		endpoint: string,
		input: Record<string, unknown>,
		options?: GenerationOptions
	): Promise<GenerationResult> {
		// Create job
		const createResponse = await this.fetchWithAuth(`${API_BASE}/${endpoint}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(input),
			signal: options?.signal
		});

		const job = await this.handleResponse<FalJob>(createResponse, endpoint);

		// Poll for completion
		const result = await this.pollWithTimeout<FalJob>(
			async () => {
				const pollResponse = await this.fetchWithAuth(
					`${API_BASE}/requests/${job.request_id}`,
					{ signal: options?.signal }
				);
				const status = await pollResponse.json();

				if (status.status === 'FAILED') {
					return {
						done: true,
						error: status.error?.message || 'Job failed'
					};
				}

				if (status.status === 'COMPLETED') {
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
		let outputUrl: string | undefined;
		if (result.output?.images && result.output.images.length > 0) {
			outputUrl = result.output.images[0].url;
		} else if (result.output?.image) {
			outputUrl = result.output.image.url;
		}

		if (!outputUrl) {
			throw new AIError(AIErrorType.UNKNOWN, 'No output returned from job', {
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
			model: endpoint,
			provider: this.id,
			timestamp: new Date(),
			metadata: {
				requestId: result.request_id
			}
		};
	}

	/**
	 * Override auth header for Fal's API key format
	 */
	protected addAuthHeaders(headers: Headers, apiKey: string): void {
		headers.set('Authorization', `Key ${apiKey}`);
	}
}
