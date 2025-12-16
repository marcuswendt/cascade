/**
 * Error types and handling for the Cascade GenAI system
 */

/**
 * Types of AI-related errors
 */
export enum AIErrorType {
	/** No API key configured for provider */
	NO_API_KEY = 'no_api_key',
	/** API key is invalid or expired */
	INVALID_API_KEY = 'invalid_api_key',
	/** Rate limit exceeded */
	RATE_LIMITED = 'rate_limited',
	/** Content blocked by safety filter */
	CONTENT_POLICY = 'content_policy',
	/** Network connection error */
	NETWORK_ERROR = 'network_error',
	/** Request timed out */
	TIMEOUT = 'timeout',
	/** Model not available or not found */
	MODEL_UNAVAILABLE = 'model_unavailable',
	/** Invalid input parameters */
	INVALID_INPUT = 'invalid_input',
	/** Insufficient credits/quota */
	INSUFFICIENT_CREDITS = 'insufficient_credits',
	/** Generation was cancelled */
	CANCELLED = 'cancelled',
	/** Unknown error */
	UNKNOWN = 'unknown'
}

/**
 * Custom error class for AI operations with rich context
 */
export class AIError extends Error {
	/** Error type for categorization */
	readonly type: AIErrorType;
	/** Whether this error can be retried */
	readonly retryable: boolean;
	/** Milliseconds to wait before retry (for rate limits) */
	readonly retryAfterMs?: number;
	/** Provider that generated this error */
	readonly provider?: string;
	/** Model that was being used */
	readonly model?: string;
	/** Original error if this wraps another error */
	readonly cause?: Error;

	constructor(
		type: AIErrorType,
		message: string,
		options?: {
			retryable?: boolean;
			retryAfterMs?: number;
			provider?: string;
			model?: string;
			cause?: Error;
		}
	) {
		super(message);
		this.name = 'AIError';
		this.type = type;
		this.retryable = options?.retryable ?? false;
		this.retryAfterMs = options?.retryAfterMs;
		this.provider = options?.provider;
		this.model = options?.model;
		this.cause = options?.cause;

		// Maintain proper stack trace in V8
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, AIError);
		}
	}

	/**
	 * Get a user-friendly error message with suggested action
	 */
	getUserMessage(): string {
		switch (this.type) {
			case AIErrorType.NO_API_KEY:
				return `No API key configured for ${this.provider || 'this provider'}. Go to Settings > API Keys to add one.`;

			case AIErrorType.INVALID_API_KEY:
				return `Invalid API key for ${this.provider || 'this provider'}. Please check your API key in Settings.`;

			case AIErrorType.RATE_LIMITED:
				if (this.retryAfterMs) {
					const seconds = Math.ceil(this.retryAfterMs / 1000);
					return `Rate limit exceeded. Please wait ${seconds} seconds before trying again.`;
				}
				return 'Rate limit exceeded. Please wait a moment before trying again.';

			case AIErrorType.CONTENT_POLICY:
				return 'Content blocked by safety filter. Try rephrasing your prompt.';

			case AIErrorType.NETWORK_ERROR:
				return 'Network error. Please check your internet connection and try again.';

			case AIErrorType.TIMEOUT:
				return 'Request timed out. The server may be busy - try again later.';

			case AIErrorType.MODEL_UNAVAILABLE:
				return `Model "${this.model || 'selected'}" is not available. Try a different model.`;

			case AIErrorType.INVALID_INPUT:
				return `Invalid input: ${this.message}`;

			case AIErrorType.INSUFFICIENT_CREDITS:
				return `Insufficient credits for ${this.provider || 'this provider'}. Please add credits to your account.`;

			case AIErrorType.CANCELLED:
				return 'Generation was cancelled.';

			case AIErrorType.UNKNOWN:
			default:
				return this.message || 'An unexpected error occurred. Please try again.';
		}
	}

	/**
	 * Get the action hint for UI display
	 */
	getActionHint(): string | null {
		switch (this.type) {
			case AIErrorType.NO_API_KEY:
			case AIErrorType.INVALID_API_KEY:
				return 'Configure API Key';

			case AIErrorType.RATE_LIMITED:
				return this.retryable ? 'Retry' : null;

			case AIErrorType.CONTENT_POLICY:
				return 'Edit Prompt';

			case AIErrorType.MODEL_UNAVAILABLE:
				return 'Change Model';

			case AIErrorType.INSUFFICIENT_CREDITS:
				return 'Add Credits';

			default:
				return this.retryable ? 'Retry' : null;
		}
	}

	/**
	 * Create AIError from a provider-specific error response
	 */
	static fromResponse(
		response: Response,
		body: unknown,
		provider: string,
		model?: string
	): AIError {
		const status = response.status;

		// Extract error message from body
		let message = 'Unknown error';
		if (typeof body === 'object' && body !== null) {
			const errorBody = body as Record<string, unknown>;
			message =
				(errorBody.error as string) ||
				(errorBody.message as string) ||
				(errorBody.detail as string) ||
				JSON.stringify(body);
		} else if (typeof body === 'string') {
			message = body;
		}

		// Map HTTP status to error type
		switch (status) {
			case 401:
				return new AIError(AIErrorType.INVALID_API_KEY, message, {
					provider,
					model,
					retryable: false
				});

			case 402:
				return new AIError(AIErrorType.INSUFFICIENT_CREDITS, message, {
					provider,
					model,
					retryable: false
				});

			case 403:
				// Could be content policy or invalid key
				if (message.toLowerCase().includes('safety') || message.toLowerCase().includes('content')) {
					return new AIError(AIErrorType.CONTENT_POLICY, message, {
						provider,
						model,
						retryable: false
					});
				}
				return new AIError(AIErrorType.INVALID_API_KEY, message, {
					provider,
					model,
					retryable: false
				});

			case 404:
				return new AIError(AIErrorType.MODEL_UNAVAILABLE, message, {
					provider,
					model,
					retryable: false
				});

			case 422:
				// Validation error - could be content policy or invalid input
				if (message.toLowerCase().includes('safety') || message.toLowerCase().includes('content')) {
					return new AIError(AIErrorType.CONTENT_POLICY, message, {
						provider,
						model,
						retryable: false
					});
				}
				return new AIError(AIErrorType.INVALID_INPUT, message, {
					provider,
					model,
					retryable: false
				});

			case 429: {
				// Rate limited
				const retryAfter = response.headers.get('retry-after');
				const retryAfterMs = retryAfter ? parseInt(retryAfter) * 1000 : 60000;
				return new AIError(AIErrorType.RATE_LIMITED, message, {
					provider,
					model,
					retryable: true,
					retryAfterMs
				});
			}

			case 500:
			case 502:
			case 503:
			case 504:
				return new AIError(AIErrorType.UNKNOWN, message, {
					provider,
					model,
					retryable: true
				});

			default:
				return new AIError(AIErrorType.UNKNOWN, message, {
					provider,
					model,
					retryable: status >= 500
				});
		}
	}

	/**
	 * Create AIError from a network error
	 */
	static fromNetworkError(error: Error, provider?: string, model?: string): AIError {
		if (error.name === 'AbortError') {
			return new AIError(AIErrorType.CANCELLED, 'Generation cancelled', {
				provider,
				model,
				retryable: false
			});
		}

		if (error.name === 'TimeoutError' || error.message.includes('timeout')) {
			return new AIError(AIErrorType.TIMEOUT, error.message, {
				provider,
				model,
				retryable: true,
				cause: error
			});
		}

		return new AIError(AIErrorType.NETWORK_ERROR, error.message, {
			provider,
			model,
			retryable: true,
			cause: error
		});
	}

	/**
	 * Check if an error is an AIError
	 */
	static isAIError(error: unknown): error is AIError {
		return error instanceof AIError;
	}

	/**
	 * Wrap any error as an AIError
	 */
	static wrap(error: unknown, provider?: string, model?: string): AIError {
		if (error instanceof AIError) {
			return error;
		}

		if (error instanceof Error) {
			return new AIError(AIErrorType.UNKNOWN, error.message, {
				provider,
				model,
				retryable: true,
				cause: error
			});
		}

		return new AIError(AIErrorType.UNKNOWN, String(error), {
			provider,
			model,
			retryable: true
		});
	}
}
