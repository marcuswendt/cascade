/**
 * Cascade Chat System Type Definitions
 *
 * Types for conversational LLM workflows that integrate with
 * the existing genai provider system.
 */

import type { ImageBuffer } from '@/nodes/lens/ImageBuffer';
import type { ProviderType, ModelSchema } from '@/services/genai/types';

// ============================================================================
// Message Types
// ============================================================================

/**
 * Core message structure - compatible with OpenAI/Anthropic/Google formats
 */
export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: MessageContent;

  /** Metadata (not sent to API, used for display/tracking) */
  meta?: MessageMeta;
}

export interface MessageMeta {
  /** Unique message ID (UUID) */
  id: string;
  /** Which model generated this (assistant messages) */
  model?: string;
  /** Unix timestamp when created */
  timestamp?: number;
  /** Token count for this message */
  tokens?: number;
  /** Generation time in ms (assistant only) */
  duration?: number;
  /** Which Chat node created this exchange */
  nodeId?: string;
}

/**
 * Content can be simple text or multimodal (text + images)
 */
export type MessageContent = string | ContentPart[];

export interface ContentPart {
  type: 'text' | 'image';

  /** For type: 'text' */
  text?: string;

  /** For type: 'image' */
  image?: ImageContent;
}

export interface ImageContent {
  source: 'base64' | 'url' | 'buffer';
  /** base64 string or URL */
  data: string;
  /** 'image/png', 'image/jpeg', etc. */
  mediaType?: string;
  /** Cascade ImageBuffer reference (internal) */
  buffer?: ImageBuffer;
}

// ============================================================================
// Conversation Context
// ============================================================================

/**
 * Full conversation context passed between nodes via connections
 */
export interface ConversationContext {
  messages: Message[];
  meta?: ConversationMeta;
}

export interface ConversationMeta {
  /** Conversation ID (persists across chain) */
  id: string;
  /** Auto-generated or user-set title */
  title?: string;
  /** Unix timestamp */
  created: number;
  /** Last update timestamp */
  modified: number;
  /** Cumulative token count */
  totalTokens: number;
}

// ============================================================================
// Chat Node State
// ============================================================================

export interface ChatNodeState {
  // === Input State ===
  /** Current prompt text */
  prompt: string;
  /** System prompt (local override) */
  systemPrompt: string;
  /** Attached images for vision */
  attachments: ImageBuffer[];

  // === Settings ===
  /** Selected model ID (from ModelSchema) */
  modelId: string;
  /** 0-2, default 0.7 */
  temperature: number;
  /** Max output tokens */
  maxTokens: number;

  // === Output State ===
  /** Completed response */
  response: string | null;
  /** Full context for downstream */
  contextOutput: ConversationContext | null;

  // === Runtime State ===
  status: ChatStatus;
  chatError: string | null;
  usage: TokenUsage | null;
  /** Accumulates during streaming */
  streamBuffer: string;

  // === UI State ===
  displayMode: 'standard' | 'compact' | 'expanded';
  /** If true, won't regenerate */
  frozen: boolean;
}

export type ChatStatus =
  | 'idle' // No prompt, waiting for input
  | 'ready' // Has prompt, ready to send
  | 'streaming' // Response actively streaming
  | 'complete' // Response finished successfully
  | 'error' // Generation failed
  | 'cancelled'; // User stopped generation

export interface TokenUsage {
  /** Input/prompt tokens */
  input: number;
  /** Output/completion tokens */
  output: number;
  /** Sum */
  total: number;
  /** Estimated cost in USD (optional) */
  cost?: number;
}

// ============================================================================
// Streaming Types
// ============================================================================

/**
 * Streaming chat request (extends existing LLMRequest pattern)
 */
export interface ChatStreamRequest {
  /** Model ID to use */
  model: string;
  /** Messages in conversation */
  messages: Message[];
  /** System prompt */
  systemPrompt?: string;
  /** Maximum tokens in response */
  maxTokens?: number;
  /** Temperature (0-2) */
  temperature?: number;
  /** Stop sequences */
  stopSequences?: string[];
}

/**
 * Chunk types for streaming responses
 */
export interface ChatStreamChunk {
  type: 'delta' | 'usage' | 'done' | 'error';
  /** For 'delta' - incremental text */
  content?: string;
  /** For 'usage' - sent at end */
  usage?: TokenUsage;
  /** For 'error' - error message */
  error?: string;
  /** For 'done' */
  finishReason?: FinishReason;
}

export type FinishReason = 'stop' | 'length' | 'content_filter' | 'error';

/**
 * Stream callbacks for handling streaming responses
 */
export interface StreamCallbacks {
  onStart?: () => void;
  onDelta?: (content: string) => void;
  onUsage?: (usage: TokenUsage) => void;
  onComplete?: () => void;
  onError?: (error: Error) => void;
  onCancel?: () => void;
}

// ============================================================================
// Error Types
// ============================================================================

export type ChatErrorType =
  | 'network'
  | 'auth'
  | 'rate_limit'
  | 'context_length'
  | 'content_filter'
  | 'provider'
  | 'unknown';

export interface ChatError {
  type: ChatErrorType;
  message: string;
  provider?: string;
  retryAfter?: number;
  maxTokens?: number;
  code?: string;
}

// ============================================================================
// Serialization Format
// ============================================================================

/**
 * How Chat node saves to .cascade project file
 */
export interface ChatNodeSerialized {
  type: 'quill/Chat';
  id: string;
  position: { x: number; y: number };
  size?: { width: number; height: number };

  params: {
    prompt: string;
    systemPrompt: string;
    modelId: string;
    temperature: number;
    maxTokens: number;
    displayMode: 'standard' | 'compact' | 'expanded';
    frozen: boolean;
  };

  /** Cached output (for instant reload without regeneration) */
  cache?: {
    response: string;
    contextOutput: ConversationContext;
    usage: TokenUsage;
  };
}

export interface SystemNodeSerialized {
  type: 'quill/System';
  id: string;
  position: { x: number; y: number };
  params: {
    prompt: string;
  };
}

// ============================================================================
// Helper Types
// ============================================================================

/**
 * Get models that support LLM capability from ModelSchema
 */
export function isChatModel(model: ModelSchema): boolean {
  return model.capabilities.includes('llm');
}

/**
 * Get models that support vision for multimodal chat
 */
export function isVisionModel(model: ModelSchema): boolean {
  return model.capabilities.includes('vision');
}
