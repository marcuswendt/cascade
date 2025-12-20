/**
 * ChatNode - Conversational AI with streaming responses
 *
 * Enables multi-turn conversations visualized as connected nodes.
 * Each Chat node represents one exchange (prompt -> response).
 * Context flows through connections for conversation continuity.
 */

import { QuillNode } from '../QuillNode';
import type { Graph } from '../../Graph';
import type { OutputPort } from '@/types/node.types';
import type { ImageBuffer } from '@/nodes/lens/ImageBuffer';
import {
  ChatStreamHandler,
  getChatModelOptions,
  getDefaultChatModel,
  ProviderRegistry
} from '@/services/genai';
import { requestSettingsDialog } from '@/editor/stores/uiEventStore';
import type { AIServiceType } from '@/editor/stores/settingsStore';
import type {
  LLMStreamRequest,
  LLMMessage,
  LLMContentPart
} from '@/services/genai/types';
import type {
  ConversationContext,
  Message,
  ChatStatus,
  TokenUsage,
  ChatNodeState
} from '@/types/chat.types';

export const nodeMetadata = {
  type: 'Chat',
  name: 'Chat',
  icon: 'MessageSquare',
  description: 'Conversational AI with streaming responses',
  category: 'ai'
};

/**
 * ChatNode - Multi-turn conversational AI node
 */
export class ChatNode extends QuillNode {
  // Outputs
  private contextOutput!: OutputPort<ConversationContext>;

  // Internal state
  prompt = '';
  systemPrompt = '';
  attachments: ImageBuffer[] = [];
  modelId: string;
  temperature = 0.7;
  maxTokens = 4096;
  response: string | null = null;
  contextOutputValue: ConversationContext | null = null;
  status: ChatStatus = 'idle';
  chatError: string | null = null;
  usage: TokenUsage | null = null;
  streamBuffer = '';
  displayMode: 'standard' | 'compact' | 'expanded' = 'standard';
  frozen = false;

  private streamHandler = new ChatStreamHandler();

  constructor(id: string, graph: Graph) {
    super(id, 'Chat', graph);
    this.modelId = getDefaultChatModel() ?? '';
  }

  protected setup(): void {
    // === Outputs ===
    this.setupTextOutput();
    this.contextOutput = this.out('context', 'param');

    // === Inputs ===
    // Context from upstream Chat node (any type, we handle null)
    this.in('context', null, { description: 'Conversation history from upstream node' });

    // System prompt override
    this.in('system', '', { description: 'System prompt override' });

    // Image attachments
    this.in('images', null, { description: 'Images to include in the message' });

    // === Parameters ===
    this.addParm('model', {
      value: this.modelId,
      type: 'select',
      params: {
        options: getChatModelOptions()
      },
      displayName: 'Model',
      onChange: () => this.handleModelChange()
    });

    // Prompt input - main user-facing field
    this.addParm('prompt', {
      value: '',
      type: 'textarea',
      displayName: 'Prompt',
      onChange: () => this.handlePromptChange()
    });

    // Send button - compact, no label
    this.addParm('send', {
      value: 'Send',
      type: 'button',
      displayName: '',
      params: { small: true },
      onChange: () => this.send()
    });

    // --- Settings ---
    this.addParm('temperature', {
      value: 0.7,
      type: 'slider',
      params: { min: 0, max: 2, step: 0.1 },
      displayName: 'Temperature',
      folder: 'Settings'
    });

    this.addParm('maxTokens', {
      value: 4096,
      type: 'number',
      params: { min: 256, max: 32000, step: 256 },
      displayName: 'Max Tokens',
      folder: 'Settings'
    });

    this.addParm('displayMode', {
      value: 'standard',
      type: 'select',
      params: {
        options: [
          { value: 'standard', label: 'Standard' },
          { value: 'compact', label: 'Compact' },
          { value: 'expanded', label: 'Expanded' }
        ]
      },
      displayName: 'Display',
      folder: 'Settings'
    });
  }

  // =========================================================================
  // Public API
  // =========================================================================

  /**
   * Update the prompt text
   */
  setPrompt(text: string): void {
    this.prompt = text;
    if (this.props.prompt) {
      this.props.prompt.value = text;
    }
    this.status = text.trim() ? 'ready' : 'idle';
    this.markDirty();
  }

  /**
   * Update the system prompt
   */
  setSystemPrompt(text: string): void {
    this.systemPrompt = text;
    this.markDirty();
  }

  /**
   * Send the message and stream the response
   */
  async send(): Promise<void> {
    // Guards
    if (this.frozen) {
      console.log('ChatNode: Node is frozen, skipping generation');
      return;
    }

    // Get prompt from props (textarea value) - this is the source of truth
    const promptText = (this.props.prompt?.value as string)?.trim() || '';
    if (!promptText) {
      console.log('ChatNode: Empty prompt, nothing to send');
      return;
    }

    // Sync to instance variable
    this.prompt = promptText;
    if (this.status === 'streaming') {
      console.log('ChatNode: Already streaming, ignoring send');
      return;
    }

    console.log(`[ChatNode] Sending: "${promptText.length > 50 ? promptText.substring(0, 50) + '...' : promptText}"`);

    // Check if the model's provider is configured
    const modelId = this.props.model?.value ?? this.modelId;
    const model = ProviderRegistry.getModel(modelId);
    if (model) {
      const provider = ProviderRegistry.getProvider(model.provider);
      if (!provider.isConfigured()) {
        // Provider not configured - show error and open settings
        this.status = 'error';
        this.chatError = `No API key configured for ${provider.name}. Please add your API key in Settings.`;
        this.markDirty();
        // Request settings dialog to open with this provider
        requestSettingsDialog(model.provider as AIServiceType);
        return;
      }
    }

    // Gather inputs from connections
    const contextInput = this.getInput<ConversationContext | null>('context');
    const systemOverride = this.getInput<string | null>('system');
    const imageAttachments = this.getInput<ImageBuffer[] | null>('images');

    // Build messages array
    const messages: LLMMessage[] = [];

    // System prompt (override > local > from context)
    const systemPromptValue = systemOverride || this.systemPrompt;
    if (systemPromptValue) {
      messages.push({
        role: 'system',
        content: systemPromptValue
      });
    }

    // Add previous context (excluding system messages)
    if (contextInput?.messages) {
      for (const msg of contextInput.messages) {
        if (msg.role !== 'system') {
          messages.push({
            role: msg.role,
            content: this.convertMessageContent(msg.content)
          });
        }
      }
    }

    // Build current user message
    const allAttachments = [
      ...this.attachments,
      ...(imageAttachments || [])
    ];

    const userContent = this.buildUserContent(this.prompt, allAttachments);
    messages.push({
      role: 'user',
      content: userContent
    });

    // Reset output state
    this.status = 'streaming';
    this.streamBuffer = '';
    this.response = null;
    this.chatError = null;
    this.usage = null;
    this.markDirty();

    const startTime = Date.now();

    // Build the request
    const request: LLMStreamRequest = {
      model: modelId,
      messages,
      temperature: this.props.temperature?.value ?? 0.7,
      maxTokens: this.props.maxTokens?.value ?? 4096,
      systemPrompt: systemPromptValue || undefined
    };

    // Stream the response
    console.log('[ChatNode] Starting stream with model:', modelId, 'messages:', messages.length);

    await this.streamHandler.stream(request, {
      onStart: () => {
        console.log('[ChatNode] Stream started');
      },

      onDelta: (content) => {
        this.streamBuffer += content;
        this.markDirty();
      },

      onUsage: (usage) => {
        console.log('[ChatNode] Usage received:', usage);
        this.usage = usage;
      },

      onComplete: () => {
        console.log('[ChatNode] Stream complete, buffer length:', this.streamBuffer.length);
        this.finalizeResponse(messages, startTime, contextInput, modelId);
      },

      onError: (error) => {
        console.error('[ChatNode] Stream error:', error);
        this.status = 'error';
        this.chatError = error.message;
        this.markDirty();
      },

      onCancel: () => {
        console.log('[ChatNode] Stream cancelled');
        this.status = 'cancelled';
        // Keep partial response if any
        if (this.streamBuffer) {
          this.response = this.streamBuffer;
        }
        this.markDirty();
      }
    });

    console.log('[ChatNode] Stream handler returned');
  }

  /**
   * Finalize response after streaming completes
   */
  private finalizeResponse(
    _messages: LLMMessage[],
    startTime: number,
    contextInput: ConversationContext | null,
    modelId: string
  ): void {
    const duration = Date.now() - startTime;

    // Set final response
    this.response = this.streamBuffer;
    this.status = 'complete';

    // Build output context with full Message format
    const outputMessages: Message[] = [];

    // Add previous messages from context
    if (contextInput?.messages) {
      outputMessages.push(...contextInput.messages);
    }

    // Add current user message
    outputMessages.push({
      role: 'user',
      content: this.prompt,
      meta: {
        id: crypto.randomUUID(),
        timestamp: startTime,
        nodeId: this.id
      }
    });

    // Add assistant response
    outputMessages.push({
      role: 'assistant',
      content: this.response,
      meta: {
        id: crypto.randomUUID(),
        model: modelId,
        timestamp: Date.now(),
        tokens: this.usage?.output,
        duration,
        nodeId: this.id
      }
    });

    // Build output context
    this.contextOutputValue = {
      messages: outputMessages,
      meta: {
        id: contextInput?.meta?.id || crypto.randomUUID(),
        created: contextInput?.meta?.created || startTime,
        modified: Date.now(),
        totalTokens: (contextInput?.meta?.totalTokens || 0) + (this.usage?.total || 0)
      }
    };

    // Set outputs
    this.setTextOutput(this.response);
    this.contextOutput.setValue(this.contextOutputValue);

    this.markDirty();
  }

  /**
   * Cancel ongoing generation
   */
  cancel(): void {
    if (this.status === 'streaming') {
      this.streamHandler.cancel();
    }
  }

  /**
   * Regenerate response (re-send same prompt)
   */
  async regenerate(): Promise<void> {
    if (this.frozen) return;
    await this.send();
  }

  /**
   * Toggle frozen state
   */
  toggleFreeze(): void {
    this.frozen = !this.frozen;
    this.markDirty();
  }

  /**
   * Set display mode
   */
  setDisplayMode(mode: 'standard' | 'compact' | 'expanded'): void {
    this.displayMode = mode;
    if (this.props.displayMode) {
      this.props.displayMode.value = mode;
    }
    this.markDirty();
  }

  // =========================================================================
  // Attachments
  // =========================================================================

  /**
   * Add images to current message
   */
  attachImages(images: ImageBuffer[]): void {
    this.attachments = [...this.attachments, ...images];
    this.markDirty();
  }

  /**
   * Remove an attachment by index
   */
  removeAttachment(index: number): void {
    this.attachments = this.attachments.filter((_, i) => i !== index);
    this.markDirty();
  }

  /**
   * Clear all attachments
   */
  clearAttachments(): void {
    this.attachments = [];
    this.markDirty();
  }

  // =========================================================================
  // State Access (for UI components)
  // =========================================================================

  /**
   * Get the current state for UI rendering
   */
  getState(): ChatNodeState {
    return {
      prompt: this.prompt,
      systemPrompt: this.systemPrompt,
      attachments: this.attachments,
      modelId: this.modelId,
      temperature: this.temperature,
      maxTokens: this.maxTokens,
      response: this.response,
      contextOutput: this.contextOutputValue,
      status: this.status,
      chatError: this.chatError,
      usage: this.usage,
      streamBuffer: this.streamBuffer,
      displayMode: this.displayMode,
      frozen: this.frozen
    };
  }

  // =========================================================================
  // Conversation Access
  // =========================================================================

  /**
   * Get full conversation up to and including this node
   */
  getConversation(): Message[] {
    const contextInput = this.getInput<ConversationContext | null>('context');
    const messages: Message[] = [];

    // Previous context
    if (contextInput?.messages) {
      messages.push(...contextInput.messages);
    }

    // Current exchange (if we have a prompt)
    if (this.prompt) {
      messages.push({
        role: 'user',
        content: this.prompt,
        meta: {
          id: `${this.id}-user`,
          timestamp: Date.now(),
          nodeId: this.id
        }
      });

      if (this.response || this.streamBuffer) {
        messages.push({
          role: 'assistant',
          content: this.response || this.streamBuffer,
          meta: {
            id: `${this.id}-assistant`,
            model: this.modelId,
            nodeId: this.id,
            tokens: this.usage?.output
          }
        });
      }
    }

    return messages;
  }

  /**
   * Check if current model supports vision
   */
  supportsVision(): boolean {
    const model = ProviderRegistry.getModel(this.modelId);
    return model?.supportsImageInput ?? false;
  }

  // =========================================================================
  // Private Helpers
  // =========================================================================

  /**
   * Get typed input value
   */
  private getInput<T>(name: string): T {
    const port = this.inputs.find(p => p.name === name);
    return port?.value as T;
  }

  /**
   * Convert Message content to LLMMessage content
   */
  private convertMessageContent(
    content: string | Array<{ type: string; text?: string; image?: any }>
  ): string | LLMContentPart[] {
    if (typeof content === 'string') {
      return content;
    }

    return content.map(part => {
      if (part.type === 'text') {
        return { type: 'text' as const, text: part.text };
      }
      if (part.type === 'image' && part.image) {
        return {
          type: 'image' as const,
          image: {
            source: part.image.source,
            data: part.image.data,
            mediaType: part.image.mediaType
          }
        };
      }
      return { type: 'text' as const, text: '' };
    });
  }

  /**
   * Build multimodal content for user message
   */
  private buildUserContent(text: string, images: ImageBuffer[]): string | LLMContentPart[] {
    if (images.length === 0) {
      return text;
    }

    const parts: LLMContentPart[] = [];

    // Add images first (better for most models)
    for (const img of images) {
      // Convert ImageBuffer to base64 via canvas
      const canvas = img.toCanvas();
      const dataUrl = canvas.toDataURL('image/png');
      // Extract base64 data from data URL (remove "data:image/png;base64," prefix)
      const base64Data = dataUrl.split(',')[1];

      parts.push({
        type: 'image',
        image: {
          source: 'base64',
          data: base64Data,
          mediaType: 'image/png'
        }
      });
    }

    // Add text
    parts.push({
      type: 'text',
      text
    });

    return parts;
  }

  /**
   * Handle prompt parameter change
   */
  private handlePromptChange(): void {
    const promptValue = this.props.prompt?.value as string;
    this.prompt = promptValue || '';
    this.status = this.prompt.trim() ? 'ready' : 'idle';
    this.markDirty();
  }

  /**
   * Handle model parameter change
   */
  private handleModelChange(): void {
    const modelId = this.props.model?.value as string;
    if (modelId) {
      this.modelId = modelId;

      // Check if the new model's provider is configured
      const model = ProviderRegistry.getModel(modelId);
      if (model) {
        const provider = ProviderRegistry.getProvider(model.provider);
        if (!provider.isConfigured()) {
          // Provider not configured - open settings dialog
          requestSettingsDialog(model.provider as AIServiceType);
        }
      }

      this.markDirty();
    }
  }

  // =========================================================================
  // Serialization
  // =========================================================================

  serialize(): Record<string, unknown> {
    return {
      prompt: this.prompt,
      systemPrompt: this.systemPrompt,
      modelId: this.modelId,
      temperature: this.temperature,
      maxTokens: this.maxTokens,
      displayMode: this.displayMode,
      frozen: this.frozen,
      // Cache completed responses for instant reload
      cache: this.response
        ? {
            response: this.response,
            contextOutput: this.contextOutputValue,
            usage: this.usage
          }
        : undefined
    };
  }

  deserialize(data: Record<string, unknown>): void {
    if (typeof data.prompt === 'string') {
      this.prompt = data.prompt;
      if (this.props.prompt) {
        this.props.prompt.value = data.prompt;
      }
    }
    if (typeof data.systemPrompt === 'string') {
      this.systemPrompt = data.systemPrompt;
    }
    if (typeof data.modelId === 'string') {
      this.modelId = data.modelId;
      if (this.props.model) {
        this.props.model.value = data.modelId;
      }
    }
    if (typeof data.temperature === 'number') {
      this.temperature = data.temperature;
    }
    if (typeof data.maxTokens === 'number') {
      this.maxTokens = data.maxTokens;
    }
    if (data.displayMode === 'standard' || data.displayMode === 'compact' || data.displayMode === 'expanded') {
      this.displayMode = data.displayMode;
    }
    if (typeof data.frozen === 'boolean') {
      this.frozen = data.frozen;
    }

    // Restore cached response
    const cache = data.cache as {
      response?: string;
      contextOutput?: ConversationContext;
      usage?: TokenUsage;
    } | undefined;

    if (cache?.response) {
      this.response = cache.response;
      this.contextOutputValue = cache.contextOutput || null;
      this.usage = cache.usage || null;
      this.status = 'complete';

      // Set outputs
      this.setTextOutput(this.response);
      if (this.contextOutputValue) {
        this.contextOutput.setValue(this.contextOutputValue);
      }
    }
  }
}
