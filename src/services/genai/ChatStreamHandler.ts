/**
 * Chat Stream Handler
 *
 * Frontend utility for handling streaming chat responses.
 * Uses the existing ProviderRegistry to route requests to appropriate providers.
 */

import { ProviderRegistry } from './ProviderRegistry';
import { getDefaultTextModel, getDefaultImageModel as getDefaultImageModelSetting } from '../../editor/stores/settingsStore';
import type {
  LLMStreamRequest,
  LLMStreamChunk,
  LLMMessage,
  LLMTokenUsage
} from './types';

/**
 * Callbacks for streaming events
 */
export interface ChatStreamCallbacks {
  onStart?: () => void;
  onDelta?: (content: string) => void;
  onUsage?: (usage: LLMTokenUsage) => void;
  onComplete?: () => void;
  onError?: (error: Error) => void;
  onCancel?: () => void;
}

/**
 * Frontend handler for streaming chat responses
 */
export class ChatStreamHandler {
  private abortController: AbortController | null = null;
  private isStreaming = false;

  /**
   * Stream a chat response, calling callbacks as chunks arrive
   */
  async stream(
    request: LLMStreamRequest,
    callbacks: ChatStreamCallbacks
  ): Promise<void> {
    if (this.isStreaming) {
      console.warn('ChatStreamHandler: Already streaming, ignoring new request');
      return;
    }

    this.abortController = new AbortController();
    this.isStreaming = true;

    callbacks.onStart?.();

    try {
      // Get the provider for this model
      const provider = ProviderRegistry.getProviderForModel(request.model);
      if (!provider.supportsLLMStreaming()) {
        throw new Error(`Provider ${provider.name} does not support streaming`);
      }

      // Stream the response
      let receivedDone = false;
      let hasContent = false;

      for await (const chunk of provider.streamComplete(request)) {
        // Check for cancellation
        if (this.abortController?.signal.aborted) {
          callbacks.onCancel?.();
          return;
        }

        switch (chunk.type) {
          case 'delta':
            callbacks.onDelta?.(chunk.content || '');
            hasContent = true;
            break;

          case 'usage':
            callbacks.onUsage?.(chunk.usage!);
            break;

          case 'done':
            receivedDone = true;
            callbacks.onComplete?.();
            break;

          case 'error':
            callbacks.onError?.(new Error(chunk.error || 'Unknown error'));
            return; // Exit early on error
        }
      }

      // Ensure onComplete is called even if no 'done' chunk was received
      if (!receivedDone && hasContent) {
        callbacks.onComplete?.();
      }
    } catch (error) {
      if (this.abortController?.signal.aborted) {
        callbacks.onCancel?.();
      } else {
        callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      this.isStreaming = false;
      this.abortController = null;
    }
  }

  /**
   * Cancel ongoing stream
   */
  cancel(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.isStreaming = false;
  }

  /**
   * Check if currently streaming
   */
  get streaming(): boolean {
    return this.isStreaming;
  }
}

/**
 * Get all available LLM models for chat from the registry
 */
export function getChatModels() {
  return ProviderRegistry.getLLMModels();
}

/**
 * Get chat model options for select dropdowns
 */
export function getChatModelOptions() {
  return ProviderRegistry.getLLMModelOptions();
}

/**
 * Get the default chat model
 * Uses user preference from settings, falls back to registry default
 */
export function getDefaultChatModel() {
  // Check user's preferred default first
  const userDefault = getDefaultTextModel();
  if (userDefault) {
    // Verify the model exists
    const model = ProviderRegistry.getModel(userDefault);
    if (model) {
      return userDefault;
    }
  }
  // Fall back to registry's auto-selection
  return ProviderRegistry.getDefaultLLMModel();
}

/**
 * Get the default image generation model
 * Uses user preference from settings, falls back to registry default
 */
export function getDefaultImageGenerationModel() {
  // Check user's preferred default first
  const userDefault = getDefaultImageModelSetting();
  if (userDefault) {
    // Verify the model exists
    const model = ProviderRegistry.getModel(userDefault);
    if (model) {
      return userDefault;
    }
  }
  // Fall back to registry's auto-selection
  return ProviderRegistry.getDefaultImageModel();
}

/**
 * Convert simple message format to LLMMessage format
 */
export function formatMessages(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
): LLMMessage[] {
  return messages.map(msg => ({
    role: msg.role,
    content: msg.content
  }));
}
