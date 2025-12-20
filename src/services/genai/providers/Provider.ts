/**
 * Abstract base class for AI providers
 *
 * Each provider (Replicate, Fal, Google, OpenAI) implements this interface
 * to provide a unified API for generation operations.
 */

import type {
	ProviderType,
	GenerationRequest,
	GenerationResult,
	GenerationOptions,
	EditRequest,
	LLMRequest,
	VisionRequest,
	ModelSchema,
	LLMStreamRequest,
	LLMStreamChunk
} from '../types';
import { AIError, AIErrorType } from '../errors';

/**
 * Abstract base class that all AI providers must implement
 */
export abstract class Provider {
	/** Human-readable provider name */
	abstract readonly name: string;

	/** Provider identifier */
	abstract readonly id: ProviderType;

	/**
	 * Check if the provider is configured with valid credentials
	 */
	abstract isConfigured(): boolean;

	/**
	 * Get the API key for this provider from settings
	 */
	protected abstract getApiKey(): string | null;

	/**
	 * Generate images from a text prompt
	 *
	 * This is the primary method that all image generation providers must implement.
	 *
	 * @param request - Generation parameters
	 * @param options - Optional abort signal and progress callback
	 * @returns Array of generation results
	 * @throws AIError on failure
	 */
	abstract generateImages(
		request: GenerationRequest,
		options?: GenerationOptions
	): Promise<GenerationResult[]>;

	/**
	 * Edit an existing image
	 *
	 * Supports inpainting, instruction-based editing, and outpainting.
	 * Override in providers that support image editing.
	 *
	 * @param request - Edit parameters
	 * @param options - Optional abort signal and progress callback
	 * @returns Array of edited images
	 * @throws AIError if not supported or on failure
	 */
	async editImage(
		_request: EditRequest,
		_options?: GenerationOptions
	): Promise<GenerationResult[]> {
		throw new AIError(AIErrorType.INVALID_INPUT, 'Image editing not supported by this provider', {
			provider: this.id,
			retryable: false
		});
	}

	/**
	 * Check if this provider supports a specific edit mode
	 */
	supportsEditMode(_mode: EditRequest['mode']): boolean {
		return false;
	}

	/**
	 * Check if this provider supports LLM text completion
	 */
	supportsLLM(): boolean {
		return false;
	}

	/**
	 * Check if this provider supports vision/image description
	 */
	supportsVision(): boolean {
		return false;
	}

	/**
	 * Complete a text prompt using an LLM
	 *
	 * Override in providers that support LLM capabilities.
	 *
	 * @param request - LLM request parameters
	 * @returns Generated text
	 * @throws AIError if not supported or on failure
	 */
	async complete(_request: LLMRequest): Promise<string> {
		throw new AIError(AIErrorType.INVALID_INPUT, 'LLM completion not supported by this provider', {
			provider: this.id,
			retryable: false
		});
	}

	/**
	 * Stream a text completion using an LLM
	 *
	 * Override in providers that support streaming LLM capabilities.
	 *
	 * @param request - LLM stream request parameters
	 * @yields Streaming chunks with deltas, usage, and completion status
	 * @throws AIError if not supported or on failure
	 */
	async *streamComplete(_request: LLMStreamRequest): AsyncGenerator<LLMStreamChunk> {
		throw new AIError(
			AIErrorType.INVALID_INPUT,
			'LLM streaming not supported by this provider',
			{
				provider: this.id,
				retryable: false
			}
		);
		// TypeScript requires a yield for generator functions
		yield { type: 'error', error: 'Not implemented' };
	}

	/**
	 * Check if this provider supports streaming LLM
	 */
	supportsLLMStreaming(): boolean {
		return false;
	}

	/**
	 * Describe an image using a vision model
	 *
	 * Override in providers that support vision capabilities.
	 *
	 * @param request - Vision request parameters
	 * @returns Text description of the image
	 * @throws AIError if not supported or on failure
	 */
	async describeImage(_request: VisionRequest): Promise<string> {
		throw new AIError(
			AIErrorType.INVALID_INPUT,
			'Vision/image description not supported by this provider',
			{
				provider: this.id,
				retryable: false
			}
		);
	}

	/**
	 * Get models available from this provider
	 *
	 * Override to return the models this provider supports.
	 */
	getModels(): ModelSchema[] {
		return [];
	}

	// =========================================================================
	// Helper methods for subclasses
	// =========================================================================

	/**
	 * Ensure the provider is configured before making API calls
	 * @throws AIError if not configured
	 */
	protected ensureConfigured(): void {
		if (!this.isConfigured()) {
			throw new AIError(
				AIErrorType.NO_API_KEY,
				`No API key configured for ${this.name}. Add one in Settings > API Keys.`,
				{
					provider: this.id,
					retryable: false
				}
			);
		}
	}

	/**
	 * Make an authenticated fetch request
	 */
	protected async fetchWithAuth(
		url: string,
		options: RequestInit = {}
	): Promise<Response> {
		const apiKey = this.getApiKey();
		if (!apiKey) {
			throw new AIError(AIErrorType.NO_API_KEY, `No API key for ${this.name}`, {
				provider: this.id
			});
		}

		const headers = new Headers(options.headers);
		this.addAuthHeaders(headers, apiKey);

		return fetch(url, {
			...options,
			headers
		});
	}

	/**
	 * Add authentication headers to a request
	 * Override in subclasses for different auth schemes
	 */
	protected addAuthHeaders(headers: Headers, apiKey: string): void {
		headers.set('Authorization', `Bearer ${apiKey}`);
	}

	/**
	 * Handle a fetch response, throwing AIError on failure
	 */
	protected async handleResponse<T>(response: Response, model?: string): Promise<T> {
		if (!response.ok) {
			let body: unknown;
			try {
				body = await response.json();
			} catch {
				body = await response.text();
			}
			throw AIError.fromResponse(response, body, this.id, model);
		}

		return response.json();
	}

	/**
	 * Download an image from a URL and convert to ImageBuffer
	 */
	protected async downloadImage(url: string): Promise<Blob> {
		const response = await fetch(url);
		if (!response.ok) {
			throw new AIError(AIErrorType.NETWORK_ERROR, `Failed to download image: ${response.statusText}`, {
				provider: this.id,
				retryable: true
			});
		}
		return response.blob();
	}

	/**
	 * Generate a unique result ID
	 */
	protected generateResultId(): string {
		return crypto.randomUUID();
	}

	/**
	 * Sleep for specified milliseconds
	 */
	protected sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	/**
	 * Poll for a result with timeout
	 */
	protected async pollWithTimeout<T>(
		pollFn: () => Promise<{ done: boolean; result?: T; error?: string }>,
		options: {
			intervalMs?: number;
			timeoutMs?: number;
			signal?: AbortSignal;
			onProgress?: (progress: number) => void;
		} = {}
	): Promise<T> {
		const { intervalMs = 1000, timeoutMs = 300000, signal, onProgress } = options;

		const startTime = Date.now();
		let lastProgress = 0;

		while (true) {
			// Check abort signal
			if (signal?.aborted) {
				throw new AIError(AIErrorType.CANCELLED, 'Generation cancelled', {
					provider: this.id,
					retryable: false
				});
			}

			// Check timeout
			const elapsed = Date.now() - startTime;
			if (elapsed > timeoutMs) {
				throw new AIError(AIErrorType.TIMEOUT, 'Generation timed out', {
					provider: this.id,
					retryable: true
				});
			}

			// Poll for result
			const { done, result, error } = await pollFn();

			if (error) {
				throw new AIError(AIErrorType.UNKNOWN, error, {
					provider: this.id,
					retryable: true
				});
			}

			if (done && result !== undefined) {
				onProgress?.(100);
				return result;
			}

			// Update progress estimate based on time elapsed
			const estimatedProgress = Math.min(95, (elapsed / timeoutMs) * 100);
			if (estimatedProgress > lastProgress) {
				lastProgress = estimatedProgress;
				onProgress?.(estimatedProgress);
			}

			// Wait before next poll
			await this.sleep(intervalMs);
		}
	}
}
