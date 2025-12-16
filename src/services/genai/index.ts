/**
 * Cascade GenAI Services
 *
 * Provides AI generation capabilities for text-to-image, image editing,
 * and text generation through multiple providers.
 */

// Core types
export type {
	ProviderType,
	GenerationResult,
	GenerationBatch,
	GenerationHistory,
	GenerationOptions,
	GenerationRequest,
	EditRequest,
	LLMRequest,
	VisionRequest,
	ReferenceImageType,
	ReferenceImage,
	ModelParameter,
	ModelCapability,
	ModelSchema,
	NodeDisplayMode,
	ResultStatus,
	ActiveGeneration,
	HistoryEntry,
	// Chat/LLM streaming types
	LLMStreamRequest,
	LLMStreamChunk,
	LLMMessage,
	LLMContentPart,
	LLMTokenUsage
} from './types';

// Errors
export { AIError, AIErrorType } from './errors';

// Provider system
export { Provider } from './providers/Provider';
export { ReplicateProvider } from './providers/ReplicateProvider';
export { GoogleProvider } from './providers/GoogleProvider';
export { initializeProviders } from './providers';
export { ProviderRegistry } from './ProviderRegistry';

// Generation management
export { GenerationManager } from './GenerationManager';
export { GenerationCache } from './GenerationCache';
export type { FileSystemAdapter } from './GenerationCache';

// Chat streaming
export {
	ChatStreamHandler,
	getChatModels,
	getChatModelOptions,
	getDefaultChatModel,
	getDefaultImageGenerationModel,
	formatMessages
} from './ChatStreamHandler';
export type { ChatStreamCallbacks } from './ChatStreamHandler';

// Model definitions
export {
	imageModels,
	editModels,
	fluxModels,
	sdModels,
	googleImageModels,
	geminiModels,
	allModels,
	getModelsForProvider,
	getDefaultModel
} from './models/modelDefinitions';
