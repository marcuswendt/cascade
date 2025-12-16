/**
 * Core type definitions for the Cascade GenAI system
 */

import type { ImageBuffer } from '../../nodes/lens/ImageBuffer';

// =============================================================================
// Provider Types
// =============================================================================

export type ProviderType = 'replicate' | 'fal' | 'google' | 'openai' | 'anthropic';

// =============================================================================
// Generation Results
// =============================================================================

/**
 * Image data that can be passed to/from providers
 * Supports both ImageBuffer and Blob representations
 */
export type ImageData = ImageBuffer | { blob: Blob } | { url: string };

/**
 * A single generation result from an API call
 */
export interface GenerationResult {
	/** Unique identifier for this result */
	id: string;
	/** Random seed used for generation */
	seed: number;
	/** Generated image data */
	imageBuffer: ImageData | null;
	/** Thumbnail URL for grid display (blob: URL or data URL) */
	thumbnailUrl: string | null;
	/** Prompt used for generation */
	prompt: string;
	/** Negative prompt if used */
	negativePrompt?: string;
	/** Model ID used for generation */
	model: string;
	/** Provider that generated this result */
	provider: ProviderType;
	/** When this result was generated */
	timestamp: Date;
	/** Additional metadata */
	metadata?: Record<string, unknown>;
	/** File reference for cached image (relative to cache dir) */
	imageFile?: string;
	/** File reference for cached thumbnail */
	thumbnailFile?: string;
}

/**
 * A batch of results from one generation request
 */
export interface GenerationBatch {
	/** Unique identifier for this batch */
	id: string;
	/** Results in this batch */
	results: GenerationResult[];
	/** Currently selected result index (null if none selected) */
	selectedIndex: number | null;
	/** Current status of the batch */
	status: 'pending' | 'generating' | 'complete' | 'error';
	/** When this batch was created */
	timestamp: Date;
	/** Generation progress 0-100 */
	progress?: number;
	/** Error message if status is 'error' */
	error?: string;
	/** Additional metadata */
	metadata?: Record<string, unknown>;
}

/**
 * Full generation history for a node
 */
export interface GenerationHistory {
	/** All batches, newest first */
	batches: GenerationBatch[];
	/** Currently selected batch index (null if none) */
	selectedBatchIndex: number | null;
}

// =============================================================================
// Generation Requests
// =============================================================================

/**
 * Options for generation operations
 */
export interface GenerationOptions {
	/** AbortSignal for cancellation */
	signal?: AbortSignal;
	/** Progress callback (0-100) */
	onProgress?: (progress: number) => void;
}

/**
 * Request for image generation
 */
export interface GenerationRequest {
	/** Text prompt for generation */
	prompt: string;
	/** Negative prompt (things to avoid) */
	negativePrompt?: string;
	/** Model ID to use */
	model: string;
	/** Number of images to generate */
	batchSize?: number;
	/** Random seed (undefined for random) */
	seed?: number;
	/** Output width in pixels */
	width?: number;
	/** Output height in pixels */
	height?: number;
	/** Reference images for style/composition guidance */
	references?: ReferenceImage[];
	/** Reference image strength (0-1) */
	referenceStrength?: number;
	/** Model-specific parameters */
	parameters?: Record<string, unknown>;
}

/**
 * Request for image editing
 */
export interface EditRequest {
	/** Source image to edit */
	image: ImageData;
	/** Edit instruction */
	instruction: string;
	/** Mask for inpainting (white = edit, black = preserve) */
	mask?: ImageData;
	/** Edit mode */
	mode: 'inpaint' | 'instruct' | 'outpaint';
	/** Model ID to use */
	model: string;
	/** Number of results to generate */
	batchSize?: number;
	/** Random seed */
	seed?: number;
	/** Edit strength (0-1) */
	strength?: number;
	/** Outpaint direction */
	outpaintDirection?: 'all' | 'left' | 'right' | 'up' | 'down';
	/** Outpaint amount in pixels */
	outpaintAmount?: number;
	/** Model-specific parameters */
	parameters?: Record<string, unknown>;
}

/**
 * Request for LLM text completion
 */
export interface LLMRequest {
	/** Model ID to use */
	model: string;
	/** System prompt */
	systemPrompt?: string;
	/** User prompt */
	prompt: string;
	/** Conversation history */
	messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
	/** Maximum tokens in response */
	maxTokens?: number;
	/** Temperature (0-1) */
	temperature?: number;
}

/**
 * Request for vision model image description
 */
export interface VisionRequest {
	/** Model ID to use */
	model: string;
	/** Image to describe */
	image: ImageData;
	/** Prompt/instructions for description */
	prompt?: string;
	/** Maximum tokens in response */
	maxTokens?: number;
}

// =============================================================================
// Reference Images
// =============================================================================

/**
 * Types of reference images for generation
 */
export type ReferenceImageType =
	| 'style' // Style/aesthetic reference
	| 'composition' // Layout/structure reference
	| 'character' // Character/subject reference
	| 'mask' // Inpainting mask
	| 'depth' // Depth map
	| 'canny' // Edge detection
	| 'general'; // Untyped reference

/**
 * A reference image for guiding generation
 */
export interface ReferenceImage {
	/** Unique identifier */
	id?: string;
	/** Image data URL or blob URL */
	imageUrl: string;
	/** Image data (optional) */
	image?: ImageData;
	/** Type of reference */
	type: ReferenceImageType;
	/** Influence strength (0-1) */
	strength?: number;
	/** Optional user label */
	label?: string;
}

// =============================================================================
// Model Definitions
// =============================================================================

/**
 * Model parameter definition
 */
export interface ModelParameter {
	/** Parameter name (API key) */
	name: string;
	/** Parameter type */
	type: 'number' | 'string' | 'boolean' | 'select';
	/** Default value */
	default: unknown;
	/** Minimum value (for numbers) */
	min?: number;
	/** Maximum value (for numbers) */
	max?: number;
	/** Step increment (for numbers) */
	step?: number;
	/** Options for select type */
	options?: { value: string; label: string }[];
	/** Description for UI tooltip */
	description?: string;
	/** Hide in simple mode */
	advanced?: boolean;
}

/**
 * Model capability flags
 */
export type ModelCapability = 'generate' | 'inpaint' | 'instruct' | 'outpaint' | 'llm' | 'vision';

/**
 * Full model schema definition
 */
export interface ModelSchema {
	/** Unique model identifier (e.g., 'flux-schnell') */
	id: string;
	/** Display name (e.g., 'Flux Schnell') */
	name: string;
	/** Provider that hosts this model */
	provider: ProviderType;
	/** API endpoint or model identifier for the provider */
	endpoint: string;

	// Capabilities
	/** What this model can do */
	capabilities: ModelCapability[];
	/** Whether model accepts image input */
	supportsImageInput: boolean;
	/** Supported reference image types */
	supportedReferenceTypes: ReferenceImageType[];
	/** Whether negative prompts are supported */
	supportsNegativePrompt: boolean;
	/** Whether native batch generation is supported */
	supportsBatchGeneration: boolean;
	/** Maximum images per batch */
	maxBatchSize: number;

	// Parameters
	/** Model-specific parameters */
	parameters: ModelParameter[];

	// Output
	/** Default output width */
	defaultWidth: number;
	/** Default output height */
	defaultHeight: number;
	/** Maximum resolution (width * height) */
	maxResolution: number;
	/** Output image format */
	outputFormat: 'png' | 'jpg' | 'webp';

	// UI
	/** Icon name for display */
	icon?: string;
	/** Category for grouping */
	category: 'fast' | 'quality' | 'specialized';
}

// =============================================================================
// Node Display Types
// =============================================================================

/**
 * Display modes for AI nodes on canvas
 */
export type NodeDisplayMode = 'box' | 'thumbnail' | 'grid' | 'minimal';

/**
 * Status indicators for results
 */
export type ResultStatus = 'none' | 'starred' | 'approved' | 'rejected' | 'reference';

// =============================================================================
// Active Generation Tracking
// =============================================================================

/**
 * Tracks an active generation for the GenerationManager
 */
export interface ActiveGeneration {
	/** Node ID that initiated the generation */
	nodeId: string;
	/** Node display name */
	nodeName: string;
	/** Batch ID being generated */
	batchId: string;
	/** Current status */
	status: 'queued' | 'generating';
	/** Progress 0-100 */
	progress: number;
	/** When generation started */
	startTime: Date;
	/** Controller for cancellation */
	abortController: AbortController;
}

/**
 * History entry for global generation history panel
 */
export interface HistoryEntry {
	/** Source node ID */
	nodeId: string;
	/** Source node display name */
	nodeName: string;
	/** Source node type */
	nodeType: string;
	/** The generation batch */
	batch: GenerationBatch;
	/** When this was generated */
	timestamp: Date;
}

// =============================================================================
// Chat/LLM Streaming Types
// =============================================================================

/**
 * Request for streaming LLM completion
 */
export interface LLMStreamRequest {
	/** Model ID to use */
	model: string;
	/** System prompt */
	systemPrompt?: string;
	/** Messages in conversation */
	messages: LLMMessage[];
	/** Maximum tokens in response */
	maxTokens?: number;
	/** Temperature (0-2) */
	temperature?: number;
	/** Stop sequences */
	stopSequences?: string[];
}

/**
 * Message format for LLM conversations
 */
export interface LLMMessage {
	role: 'system' | 'user' | 'assistant';
	content: string | LLMContentPart[];
}

/**
 * Content part for multimodal messages
 */
export interface LLMContentPart {
	type: 'text' | 'image';
	text?: string;
	image?: {
		source: 'base64' | 'url';
		data: string;
		mediaType?: string;
	};
}

/**
 * Chunk types for streaming responses
 */
export interface LLMStreamChunk {
	type: 'delta' | 'usage' | 'done' | 'error';
	/** For 'delta' - incremental text */
	content?: string;
	/** For 'usage' - sent at end */
	usage?: LLMTokenUsage;
	/** For 'error' - error message */
	error?: string;
	/** For 'done' - reason for stopping */
	finishReason?: 'stop' | 'length' | 'content_filter' | 'error';
}

/**
 * Token usage information
 */
export interface LLMTokenUsage {
	/** Input/prompt tokens */
	input: number;
	/** Output/completion tokens */
	output: number;
	/** Sum */
	total: number;
}
