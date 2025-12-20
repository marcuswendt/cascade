# Cascade Chat System Specification

## Overview

This specification defines a conversational LLM workflow system for Cascade, enabling natural multi-turn conversations visualized as connected nodes on the canvas. Each Chat node represents one exchange (prompt → response), with conversation context flowing through connections.

### Core Concept

```
┌────────────────────────────┐
│ "how big is earth?"        │
│ ───────────────────────────│
│ The Earth is 12,742km...   │
│                 Claude 3.5 │
└──────────────○─────────────┘
               │ context
               ▼
┌──────────────○─────────────┐
│ "and the moon?"            │
│ ───────────────────────────│
│ The Moon is 3,474km...     │
│                 Claude 3.5 │
└──────────────○─────────────┘
```

**Every Chat node shows its exchange. The canvas IS your conversation history.**

---

## Design Principles

1. **Conversational Flow** - Tab to continue, Enter to send. It should feel like texting.
2. **Multi-Model Mixing** - Different models for different nodes. Compare perspectives.
3. **Button-Triggered** - Generation only on explicit action (Enter/Send), never auto-trigger.
4. **Streaming First** - Responses stream in live for natural feel.
5. **Context as Data** - Conversation history flows through connections like any other data.
6. **Keyboard-First** - Every action has a keyboard shortcut.
7. **Canvas as History** - Your exploration is visible, branching conversations are natural.
8. **Non-Destructive** - Edit earlier prompts, regenerate, downstream updates automatically.

---

## Data Structures

### Message Format

```typescript
/**
 * Core message structure - compatible with OpenAI/Anthropic/Google formats
 */
interface Message {
  role: 'system' | 'user' | 'assistant';
  content: MessageContent;
  
  // Metadata (not sent to API, used for display/tracking)
  meta?: MessageMeta;
}

interface MessageMeta {
  id: string;              // Unique message ID (UUID)
  model?: string;          // Which model generated this (assistant messages)
  timestamp?: number;      // Unix timestamp when created
  tokens?: number;         // Token count for this message
  duration?: number;       // Generation time in ms (assistant only)
  nodeId?: string;         // Which Chat node created this exchange
}

/**
 * Content can be simple text or multimodal (text + images)
 */
type MessageContent = string | ContentPart[];

interface ContentPart {
  type: 'text' | 'image';
  
  // For type: 'text'
  text?: string;
  
  // For type: 'image'
  image?: ImageContent;
}

interface ImageContent {
  source: 'base64' | 'url' | 'buffer';
  data: string;            // base64 string or URL
  mediaType?: string;      // 'image/png', 'image/jpeg', etc.
  buffer?: ImageBuffer;    // Cascade ImageBuffer reference (internal)
}
```

### Conversation Context

```typescript
/**
 * Full conversation context passed between nodes via connections
 */
interface ConversationContext {
  messages: Message[];
  
  meta?: ConversationMeta;
}

interface ConversationMeta {
  id: string;              // Conversation ID (persists across chain)
  title?: string;          // Auto-generated or user-set title
  created: number;         // Unix timestamp
  modified: number;        // Last update timestamp
  totalTokens: number;     // Cumulative token count
}
```

### Chat Node State

```typescript
interface ChatNodeState {
  // === Input State ===
  prompt: string;                           // Current prompt text
  systemPrompt: string;                     // System prompt (local override)
  attachments: ImageBuffer[];               // Attached images for vision
  
  // === Settings ===
  model: ProviderModel;                     // Selected model
  temperature: number;                      // 0-2, default 0.7
  maxTokens: number;                        // Max output tokens
  
  // === Output State ===
  response: string | null;                  // Completed response
  contextOutput: ConversationContext | null; // Full context for downstream
  
  // === Runtime State ===
  status: ChatStatus;
  error: string | null;
  usage: TokenUsage | null;
  streamBuffer: string;                     // Accumulates during streaming
  
  // === UI State ===
  displayMode: 'standard' | 'compact' | 'expanded';
  frozen: boolean;                          // If true, won't regenerate
}

type ChatStatus = 
  | 'idle'           // No prompt, waiting for input
  | 'ready'          // Has prompt, ready to send
  | 'streaming'      // Response actively streaming
  | 'complete'       // Response finished successfully
  | 'error'          // Generation failed
  | 'cancelled';     // User stopped generation

interface TokenUsage {
  input: number;     // Input/prompt tokens
  output: number;    // Output/completion tokens
  total: number;     // Sum
  cost?: number;     // Estimated cost in USD (optional)
}
```

### Provider Model

```typescript
interface ProviderModel {
  provider: ChatProvider;
  model: string;           // API model ID, e.g., 'claude-sonnet-4-20250514'
  displayName: string;     // UI display, e.g., 'Claude Sonnet 4'
  capabilities: ModelCapabilities;
}

type ChatProvider = 'anthropic' | 'openai' | 'google';

interface ModelCapabilities {
  vision: boolean;              // Supports image inputs
  streaming: boolean;           // Supports streaming responses
  maxContextTokens: number;     // Context window size
  maxOutputTokens: number;      // Max generation length
}
```

### Serialization Format

```typescript
/**
 * How Chat node saves to .cascade project file
 */
interface ChatNodeSerialized {
  type: 'quill/Chat';
  id: string;
  position: { x: number; y: number };
  size?: { width: number; height: number };
  
  params: {
    prompt: string;
    systemPrompt: string;
    model: string;           // "provider/model-id" format
    temperature: number;
    maxTokens: number;
    displayMode: 'standard' | 'compact' | 'expanded';
    frozen: boolean;
  };
  
  // Cached output (for instant reload without regeneration)
  cache?: {
    response: string;
    contextOutput: ConversationContext;
    usage: TokenUsage;
  };
}
```

---

## Provider Abstraction

### Provider Interface

```typescript
/**
 * Unified interface for all LLM providers
 */
interface IChatProvider {
  readonly name: string;
  readonly id: ChatProvider;
  readonly models: ProviderModel[];
  
  /**
   * Check if API credentials are configured
   */
  isConfigured(): boolean;
  
  /**
   * Get API key from credential store
   */
  getApiKey(): string | null;
  
  /**
   * Send a chat completion request (non-streaming)
   */
  complete(request: ChatRequest): Promise<ChatResponse>;
  
  /**
   * Stream a chat completion response
   */
  stream(request: ChatRequest): AsyncIterable<ChatStreamChunk>;
  
  /**
   * Estimate token count for messages (for context management)
   */
  estimateTokens(messages: Message[]): number;
  
  /**
   * Convert messages to provider-specific format
   */
  formatMessages(messages: Message[]): unknown;
}
```

### Request/Response Types

```typescript
interface ChatRequest {
  model: string;
  messages: Message[];
  temperature?: number;      // Default: 0.7
  maxTokens?: number;        // Default: 4096
  systemPrompt?: string;     // Separate system prompt (some APIs prefer this)
  stopSequences?: string[];  // Stop generation at these strings
}

interface ChatResponse {
  content: string;
  usage: TokenUsage;
  model: string;             // Actual model used (may differ from request)
  finishReason: FinishReason;
}

type FinishReason = 'stop' | 'length' | 'content_filter' | 'error';

interface ChatStreamChunk {
  type: 'delta' | 'usage' | 'done' | 'error';
  content?: string;          // For 'delta' - incremental text
  usage?: TokenUsage;        // For 'usage' - sent at end
  error?: string;            // For 'error' - error message
  finishReason?: FinishReason; // For 'done'
}
```

### Provider Registry

```typescript
/**
 * Central registry for all chat providers
 * Location: src/services/ChatProviderRegistry.ts
 */
class ChatProviderRegistry {
  private providers = new Map<string, IChatProvider>();
  
  register(provider: IChatProvider): void;
  
  getProvider(id: ChatProvider): IChatProvider | undefined;
  
  getProviderForModel(modelString: string): IChatProvider | undefined;
  
  /**
   * Get all models from configured providers only
   */
  getAvailableModels(): ProviderModel[];
  
  /**
   * Get providers that have valid credentials
   */
  getConfiguredProviders(): IChatProvider[];
}

// Singleton export
export const chatProviders = new ChatProviderRegistry();
```

### Provider Implementations

#### Anthropic Provider

```typescript
// src/services/providers/AnthropicProvider.ts

class AnthropicProvider implements IChatProvider {
  readonly name = 'Anthropic';
  readonly id: ChatProvider = 'anthropic';
  
  readonly models: ProviderModel[] = [
    {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      displayName: 'Claude Sonnet 4',
      capabilities: {
        vision: true,
        streaming: true,
        maxContextTokens: 200000,
        maxOutputTokens: 16384
      }
    },
    {
      provider: 'anthropic',
      model: 'claude-opus-4-20250514',
      displayName: 'Claude Opus 4',
      capabilities: {
        vision: true,
        streaming: true,
        maxContextTokens: 200000,
        maxOutputTokens: 16384
      }
    },
    {
      provider: 'anthropic',
      model: 'claude-haiku-3-5-20241022',
      displayName: 'Claude 3.5 Haiku',
      capabilities: {
        vision: true,
        streaming: true,
        maxContextTokens: 200000,
        maxOutputTokens: 8192
      }
    }
  ];
  
  isConfigured(): boolean {
    return !!this.getApiKey();
  }
  
  getApiKey(): string | null {
    return credentialStore.get('anthropic');
  }
  
  async *stream(request: ChatRequest): AsyncIterable<ChatStreamChunk> {
    // Implementation uses Anthropic SDK with streaming
    // See Backend API section for server-side handling
  }
  
  formatMessages(messages: Message[]): AnthropicMessage[] {
    // Convert to Anthropic format:
    // - System messages extracted to separate 'system' parameter
    // - Image content converted to base64 with media_type
    return messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role,
        content: this.formatContent(m.content)
      }));
  }
}
```

#### OpenAI Provider

```typescript
// src/services/providers/OpenAIProvider.ts

class OpenAIProvider implements IChatProvider {
  readonly name = 'OpenAI';
  readonly id: ChatProvider = 'openai';
  
  readonly models: ProviderModel[] = [
    {
      provider: 'openai',
      model: 'gpt-4o',
      displayName: 'GPT-4o',
      capabilities: {
        vision: true,
        streaming: true,
        maxContextTokens: 128000,
        maxOutputTokens: 4096
      }
    },
    {
      provider: 'openai',
      model: 'gpt-4o-mini',
      displayName: 'GPT-4o Mini',
      capabilities: {
        vision: true,
        streaming: true,
        maxContextTokens: 128000,
        maxOutputTokens: 16384
      }
    },
    {
      provider: 'openai',
      model: 'o1',
      displayName: 'o1',
      capabilities: {
        vision: true,
        streaming: true,
        maxContextTokens: 200000,
        maxOutputTokens: 100000
      }
    }
  ];
  
  // ... implementation
}
```

#### Google Provider

```typescript
// src/services/providers/GoogleProvider.ts

class GoogleProvider implements IChatProvider {
  readonly name = 'Google';
  readonly id: ChatProvider = 'google';
  
  readonly models: ProviderModel[] = [
    {
      provider: 'google',
      model: 'gemini-2.5-flash',
      displayName: 'Gemini 2.5 Flash',
      capabilities: {
        vision: true,
        streaming: true,
        maxContextTokens: 1000000,
        maxOutputTokens: 8192
      }
    },
    {
      provider: 'google',
      model: 'gemini-2.5-pro',
      displayName: 'Gemini 2.5 Pro',
      capabilities: {
        vision: true,
        streaming: true,
        maxContextTokens: 1000000,
        maxOutputTokens: 8192
      }
    }
  ];
  
  // ... implementation
}
```

---

## Streaming Architecture

### Backend API Routes

```typescript
// server/routes/chat.ts

import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

const router = express.Router();

/**
 * POST /api/chat/stream
 * Unified streaming endpoint for all providers
 */
router.post('/stream', async (req, res) => {
  const { provider, model, messages, temperature, maxTokens, systemPrompt } = req.body;
  
  // Validate request
  if (!provider || !model || !messages) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  // Set up Server-Sent Events
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  
  const sendChunk = (chunk: ChatStreamChunk) => {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  };
  
  try {
    switch (provider) {
      case 'anthropic':
        await streamAnthropic(req.body, sendChunk);
        break;
      case 'openai':
        await streamOpenAI(req.body, sendChunk);
        break;
      case 'google':
        await streamGoogle(req.body, sendChunk);
        break;
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
    
    sendChunk({ type: 'done' });
  } catch (error) {
    console.error('Chat stream error:', error);
    sendChunk({ type: 'error', error: error.message });
  }
  
  res.end();
});

/**
 * Stream from Anthropic API
 */
async function streamAnthropic(
  request: ChatRequest & { provider: string },
  send: (chunk: ChatStreamChunk) => void
): Promise<void> {
  const apiKey = await getCredential('anthropic');
  if (!apiKey) throw new Error('Anthropic API key not configured');
  
  const client = new Anthropic({ apiKey });
  
  // Extract system message
  const systemMessage = request.messages.find(m => m.role === 'system');
  const system = request.systemPrompt || 
    (typeof systemMessage?.content === 'string' ? systemMessage.content : undefined);
  
  // Convert messages to Anthropic format
  const messages = request.messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role as 'user' | 'assistant',
      content: formatAnthropicContent(m.content)
    }));
  
  const stream = client.messages.stream({
    model: request.model,
    max_tokens: request.maxTokens || 4096,
    temperature: request.temperature ?? 0.7,
    system,
    messages
  });
  
  for await (const event of stream) {
    if (event.type === 'content_block_delta') {
      if (event.delta.type === 'text_delta') {
        send({ type: 'delta', content: event.delta.text });
      }
    }
  }
  
  const finalMessage = await stream.finalMessage();
  send({
    type: 'usage',
    usage: {
      input: finalMessage.usage.input_tokens,
      output: finalMessage.usage.output_tokens,
      total: finalMessage.usage.input_tokens + finalMessage.usage.output_tokens
    }
  });
}

/**
 * Stream from OpenAI API
 */
async function streamOpenAI(
  request: ChatRequest & { provider: string },
  send: (chunk: ChatStreamChunk) => void
): Promise<void> {
  const apiKey = await getCredential('openai');
  if (!apiKey) throw new Error('OpenAI API key not configured');
  
  const client = new OpenAI({ apiKey });
  
  // Convert messages to OpenAI format
  const messages = request.messages.map(m => ({
    role: m.role,
    content: formatOpenAIContent(m.content)
  }));
  
  // Add system prompt if provided separately
  if (request.systemPrompt && !messages.some(m => m.role === 'system')) {
    messages.unshift({ role: 'system', content: request.systemPrompt });
  }
  
  const stream = await client.chat.completions.create({
    model: request.model,
    max_tokens: request.maxTokens || 4096,
    temperature: request.temperature ?? 0.7,
    messages,
    stream: true,
    stream_options: { include_usage: true }
  });
  
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      send({ type: 'delta', content: delta });
    }
    
    // Usage comes in the final chunk
    if (chunk.usage) {
      send({
        type: 'usage',
        usage: {
          input: chunk.usage.prompt_tokens,
          output: chunk.usage.completion_tokens,
          total: chunk.usage.total_tokens
        }
      });
    }
  }
}

/**
 * Stream from Google Gemini API
 */
async function streamGoogle(
  request: ChatRequest & { provider: string },
  send: (chunk: ChatStreamChunk) => void
): Promise<void> {
  const apiKey = await getCredential('google');
  if (!apiKey) throw new Error('Google API key not configured');
  
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ 
    model: request.model,
    generationConfig: {
      maxOutputTokens: request.maxTokens || 4096,
      temperature: request.temperature ?? 0.7
    }
  });
  
  // Convert messages to Gemini format
  const history = request.messages
    .filter(m => m.role !== 'system')
    .slice(0, -1) // All but last message
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: formatGeminiParts(m.content)
    }));
  
  const lastMessage = request.messages[request.messages.length - 1];
  const chat = model.startChat({
    history,
    systemInstruction: request.systemPrompt || 
      request.messages.find(m => m.role === 'system')?.content as string
  });
  
  const result = await chat.sendMessageStream(formatGeminiParts(lastMessage.content));
  
  let totalChars = 0;
  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) {
      send({ type: 'delta', content: text });
      totalChars += text.length;
    }
  }
  
  // Gemini doesn't provide exact token counts in stream, estimate
  send({
    type: 'usage',
    usage: {
      input: 0,  // Would need to call countTokens separately
      output: Math.ceil(totalChars / 4), // Rough estimate
      total: 0
    }
  });
}

export default router;
```

### Frontend Stream Handler

```typescript
// src/engine/ChatStreamHandler.ts

export class ChatStreamHandler {
  private abortController: AbortController | null = null;
  
  /**
   * Stream a chat response, calling callbacks as chunks arrive
   */
  async stream(
    request: ChatRequest,
    callbacks: StreamCallbacks
  ): Promise<void> {
    this.abortController = new AbortController();
    
    callbacks.onStart?.();
    
    try {
      // Extract provider from model string (e.g., "anthropic/claude-sonnet-4-20250514")
      const [provider] = request.model.includes('/') 
        ? request.model.split('/') 
        : [this.inferProvider(request.model)];
      
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model: request.model.includes('/') 
            ? request.model.split('/')[1] 
            : request.model,
          messages: request.messages,
          temperature: request.temperature,
          maxTokens: request.maxTokens,
          systemPrompt: request.systemPrompt
        }),
        signal: this.abortController.signal
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(error.error || `HTTP ${response.status}`);
      }
      
      await this.processSSEStream(response, callbacks);
      
    } catch (error) {
      if (error.name === 'AbortError') {
        callbacks.onCancel?.();
      } else {
        callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }
  
  /**
   * Process Server-Sent Events stream
   */
  private async processSSEStream(
    response: Response,
    callbacks: StreamCallbacks
  ): Promise<void> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      
      // Parse complete SSE messages
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || ''; // Keep incomplete message in buffer
      
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        
        try {
          const chunk = JSON.parse(line.slice(6)) as ChatStreamChunk;
          
          switch (chunk.type) {
            case 'delta':
              callbacks.onDelta?.(chunk.content!);
              break;
            case 'usage':
              callbacks.onUsage?.(chunk.usage!);
              break;
            case 'done':
              callbacks.onComplete?.();
              break;
            case 'error':
              callbacks.onError?.(new Error(chunk.error));
              break;
          }
        } catch (e) {
          console.warn('Failed to parse SSE chunk:', line);
        }
      }
    }
  }
  
  /**
   * Cancel ongoing stream
   */
  cancel(): void {
    this.abortController?.abort();
    this.abortController = null;
  }
  
  /**
   * Infer provider from model name
   */
  private inferProvider(model: string): string {
    if (model.startsWith('claude') || model.startsWith('claude-')) return 'anthropic';
    if (model.startsWith('gpt-') || model.startsWith('o1')) return 'openai';
    if (model.startsWith('gemini')) return 'google';
    throw new Error(`Cannot infer provider for model: ${model}`);
  }
}

interface StreamCallbacks {
  onStart?: () => void;
  onDelta?: (content: string) => void;
  onUsage?: (usage: TokenUsage) => void;
  onComplete?: () => void;
  onError?: (error: Error) => void;
  onCancel?: () => void;
}
```

---

## Node Implementation

### ChatNode Class

```typescript
// src/nodes/quill/ChatNode.ts

import { Node } from '../Node';
import { ChatStreamHandler } from '@/engine/ChatStreamHandler';
import { chatProviders } from '@/services/ChatProviderRegistry';
import type { 
  ConversationContext, 
  Message, 
  ChatNodeState, 
  TokenUsage,
  ProviderModel,
  MessageContent,
  ContentPart
} from '@/types/chat.types';
import type { ImageBuffer } from '@/nodes/lens/ImageBuffer';

export class ChatNode extends Node {
  static readonly type = 'quill/Chat';
  static readonly displayName = 'Chat';
  static readonly category = 'quill';
  static readonly description = 'Conversational AI with streaming responses';
  
  // Internal state (reactive via Svelte)
  private _state: ChatNodeState;
  private streamHandler = new ChatStreamHandler();
  
  constructor() {
    super();
    this._state = this.createInitialState();
  }
  
  private createInitialState(): ChatNodeState {
    const defaultModel = chatProviders.getAvailableModels()[0] || {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      displayName: 'Claude Sonnet 4',
      capabilities: { vision: true, streaming: true, maxContextTokens: 200000, maxOutputTokens: 16384 }
    };
    
    return {
      prompt: '',
      systemPrompt: '',
      attachments: [],
      model: defaultModel,
      temperature: 0.7,
      maxTokens: 4096,
      response: null,
      contextOutput: null,
      status: 'idle',
      error: null,
      usage: null,
      streamBuffer: '',
      displayMode: 'standard',
      frozen: false
    };
  }
  
  // Reactive state accessor
  get state(): ChatNodeState {
    return this._state;
  }
  
  protected setup(): void {
    // === Input Ports ===
    
    this.in<ConversationContext>('context', null, {
      displayName: 'Context',
      description: 'Conversation history from upstream node'
    });
    
    this.in<string>('system', null, {
      displayName: 'System',
      description: 'System prompt override (connects to quill/System node)'
    });
    
    this.in<ImageBuffer[]>('attachments', null, {
      displayName: 'Images',
      description: 'Images to include in the message (for vision models)'
    });
    
    // === Output Ports ===
    
    this.out<string>('response', {
      displayName: 'Response',
      description: 'The assistant\'s response text'
    });
    
    this.out<ConversationContext>('context', {
      displayName: 'Context',
      description: 'Full conversation history (connect to next Chat node)'
    });
    
    // === Parameters ===
    
    this.addParm('model', {
      value: `${this._state.model.provider}/${this._state.model.model}`,
      displayName: 'Model',
      description: 'AI model to use for generation',
      onChange: () => this.handleModelChange()
    });
    
    this.addParm('temperature', {
      value: 0.7,
      params: { min: 0, max: 2, step: 0.1 },
      displayName: 'Temperature',
      description: 'Creativity/randomness (0 = focused, 2 = creative)'
    });
    
    this.addParm('maxTokens', {
      value: 4096,
      params: { min: 256, max: 32000, step: 256 },
      displayName: 'Max Tokens',
      description: 'Maximum response length'
    });
    
    this.addParm('displayMode', {
      value: 'standard',
      params: {
        options: [
          { value: 'standard', label: 'Standard' },
          { value: 'compact', label: 'Compact' },
          { value: 'expanded', label: 'Expanded' }
        ]
      },
      displayName: 'Display',
      description: 'How the node appears on canvas'
    });
  }
  
  // === Public API ===
  
  /**
   * Update the prompt text
   */
  setPrompt(text: string): void {
    this._state.prompt = text;
    this._state.status = text.trim() ? 'ready' : 'idle';
    this.emit('stateChange', this._state);
  }
  
  /**
   * Update the system prompt
   */
  setSystemPrompt(text: string): void {
    this._state.systemPrompt = text;
    this.emit('stateChange', this._state);
  }
  
  /**
   * Send the message and stream the response
   */
  async send(): Promise<void> {
    // Guards
    if (this._state.frozen) {
      console.log('Node is frozen, skipping generation');
      return;
    }
    if (!this._state.prompt.trim()) {
      console.log('Empty prompt, nothing to send');
      return;
    }
    if (this._state.status === 'streaming') {
      console.log('Already streaming, ignoring send');
      return;
    }
    
    // Gather inputs from connections
    const contextInput = this.inputs[0]?.value as ConversationContext | null;
    const systemOverride = this.inputs[1]?.value as string | null;
    const imageAttachments = this.inputs[2]?.value as ImageBuffer[] | null;
    
    // Build messages array
    const messages: Message[] = [];
    
    // System prompt (override > local > from context)
    const systemPrompt = systemOverride || this._state.systemPrompt;
    if (systemPrompt) {
      messages.push({
        role: 'system',
        content: systemPrompt
      });
    }
    
    // Add previous context (excluding system messages, we handle those separately)
    if (contextInput?.messages) {
      messages.push(...contextInput.messages.filter(m => m.role !== 'system'));
    }
    
    // Build current user message
    const allAttachments = [
      ...this._state.attachments,
      ...(imageAttachments || [])
    ];
    
    const userContent = this.buildUserContent(this._state.prompt, allAttachments);
    const userMessage: Message = {
      role: 'user',
      content: userContent,
      meta: {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        nodeId: this.id
      }
    };
    messages.push(userMessage);
    
    // Reset output state
    this._state.status = 'streaming';
    this._state.streamBuffer = '';
    this._state.response = null;
    this._state.error = null;
    this._state.usage = null;
    this.emit('stateChange', this._state);
    
    const startTime = Date.now();
    
    // Stream the response
    try {
      await this.streamHandler.stream(
        {
          model: `${this._state.model.provider}/${this._state.model.model}`,
          messages,
          temperature: this._state.temperature,
          maxTokens: this._state.maxTokens,
          systemPrompt: systemPrompt || undefined
        },
        {
          onStart: () => {
            this.emit('streamStart');
          },
          
          onDelta: (content) => {
            this._state.streamBuffer += content;
            this.emit('streamDelta', content);
            this.emit('stateChange', this._state);
          },
          
          onUsage: (usage) => {
            this._state.usage = usage;
          },
          
          onComplete: () => {
            this.finalizeResponse(messages, userMessage, startTime, contextInput);
          },
          
          onError: (error) => {
            this._state.status = 'error';
            this._state.error = error.message;
            this.emit('stateChange', this._state);
            this.emit('error', error);
          },
          
          onCancel: () => {
            this._state.status = 'cancelled';
            // Keep partial response if any
            if (this._state.streamBuffer) {
              this._state.response = this._state.streamBuffer;
            }
            this.emit('stateChange', this._state);
            this.emit('cancelled');
          }
        }
      );
    } catch (error) {
      this._state.status = 'error';
      this._state.error = error instanceof Error ? error.message : String(error);
      this.emit('stateChange', this._state);
      this.emit('error', error);
    }
  }
  
  /**
   * Finalize response after streaming completes
   */
  private finalizeResponse(
    messages: Message[],
    userMessage: Message,
    startTime: number,
    contextInput: ConversationContext | null
  ): void {
    const duration = Date.now() - startTime;
    
    // Set final response
    this._state.response = this._state.streamBuffer;
    this._state.status = 'complete';
    
    // Create assistant message
    const assistantMessage: Message = {
      role: 'assistant',
      content: this._state.response,
      meta: {
        id: crypto.randomUUID(),
        model: `${this._state.model.provider}/${this._state.model.model}`,
        timestamp: Date.now(),
        tokens: this._state.usage?.output,
        duration,
        nodeId: this.id
      }
    };
    
    // Build output context
    this._state.contextOutput = {
      messages: [...messages, assistantMessage],
      meta: {
        id: contextInput?.meta?.id || crypto.randomUUID(),
        created: contextInput?.meta?.created || Date.now(),
        modified: Date.now(),
        totalTokens: (contextInput?.meta?.totalTokens || 0) + (this._state.usage?.total || 0)
      }
    };
    
    // Set output port values
    this.setOutput(this.outputs[0], this._state.response);
    this.setOutput(this.outputs[1], this._state.contextOutput);
    
    this.emit('stateChange', this._state);
    this.emit('complete', {
      response: this._state.response,
      usage: this._state.usage,
      duration
    });
  }
  
  /**
   * Cancel ongoing generation
   */
  cancel(): void {
    if (this._state.status === 'streaming') {
      this.streamHandler.cancel();
    }
  }
  
  /**
   * Regenerate response (re-send same prompt)
   */
  async regenerate(): Promise<void> {
    if (this._state.frozen) return;
    await this.send();
  }
  
  /**
   * Toggle frozen state
   */
  toggleFreeze(): void {
    this._state.frozen = !this._state.frozen;
    this.emit('stateChange', this._state);
  }
  
  /**
   * Set display mode
   */
  setDisplayMode(mode: 'standard' | 'compact' | 'expanded'): void {
    this._state.displayMode = mode;
    this.props.displayMode.value = mode;
    this.emit('stateChange', this._state);
  }
  
  // === Attachments ===
  
  /**
   * Add images to current message
   */
  attachImages(images: ImageBuffer[]): void {
    this._state.attachments = [...this._state.attachments, ...images];
    this.emit('stateChange', this._state);
  }
  
  /**
   * Remove an attachment by index
   */
  removeAttachment(index: number): void {
    this._state.attachments = this._state.attachments.filter((_, i) => i !== index);
    this.emit('stateChange', this._state);
  }
  
  /**
   * Clear all attachments
   */
  clearAttachments(): void {
    this._state.attachments = [];
    this.emit('stateChange', this._state);
  }
  
  // === Conversation Access ===
  
  /**
   * Get full conversation up to and including this node
   * Used by the Viewer to display the conversation
   */
  getConversation(): Message[] {
    const contextInput = this.inputs[0]?.value as ConversationContext | null;
    const messages: Message[] = [];
    
    // Previous context
    if (contextInput?.messages) {
      messages.push(...contextInput.messages);
    }
    
    // Current exchange (if we have a response)
    if (this._state.prompt) {
      const userContent = this.buildUserContent(
        this._state.prompt, 
        this._state.attachments
      );
      
      messages.push({
        role: 'user',
        content: userContent,
        meta: {
          id: `${this.id}-user`,
          timestamp: Date.now(),
          nodeId: this.id
        }
      });
      
      if (this._state.response) {
        messages.push({
          role: 'assistant',
          content: this._state.response,
          meta: {
            id: `${this.id}-assistant`,
            model: `${this._state.model.provider}/${this._state.model.model}`,
            nodeId: this.id,
            tokens: this._state.usage?.output,
            duration: this._state.usage ? undefined : undefined // Add if tracked
          }
        });
      }
    }
    
    return messages;
  }
  
  /**
   * Check if model supports vision
   */
  supportsVision(): boolean {
    return this._state.model.capabilities.vision;
  }
  
  // === Private Helpers ===
  
  /**
   * Build multimodal content for user message
   */
  private buildUserContent(text: string, images: ImageBuffer[]): MessageContent {
    if (images.length === 0) {
      return text;
    }
    
    const parts: ContentPart[] = [];
    
    // Add images first (better for most models)
    for (const img of images) {
      parts.push({
        type: 'image',
        image: {
          source: 'base64',
          data: img.toBase64(),
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
   * Handle model parameter change
   */
  private handleModelChange(): void {
    const modelString = this.props.model.value as string;
    const [provider, modelId] = modelString.split('/');
    
    const model = chatProviders.getAvailableModels().find(m =>
      m.provider === provider && m.model === modelId
    );
    
    if (model) {
      this._state.model = model;
      this.emit('stateChange', this._state);
    }
  }
  
  // === Serialization ===
  
  serialize(): ChatNodeSerialized {
    return {
      type: ChatNode.type,
      id: this.id,
      position: { ...this.position },
      size: this.size ? { ...this.size } : undefined,
      params: {
        prompt: this._state.prompt,
        systemPrompt: this._state.systemPrompt,
        model: `${this._state.model.provider}/${this._state.model.model}`,
        temperature: this._state.temperature,
        maxTokens: this._state.maxTokens,
        displayMode: this._state.displayMode,
        frozen: this._state.frozen
      },
      // Cache completed responses for instant reload
      cache: this._state.response ? {
        response: this._state.response,
        contextOutput: this._state.contextOutput!,
        usage: this._state.usage!
      } : undefined
    };
  }
  
  deserialize(data: ChatNodeSerialized): void {
    // Restore parameters
    this._state.prompt = data.params.prompt;
    this._state.systemPrompt = data.params.systemPrompt;
    this._state.temperature = data.params.temperature;
    this._state.maxTokens = data.params.maxTokens;
    this._state.displayMode = data.params.displayMode;
    this._state.frozen = data.params.frozen;
    
    // Restore model
    const [provider, modelId] = data.params.model.split('/');
    const model = chatProviders.getAvailableModels().find(m =>
      m.provider === provider && m.model === modelId
    );
    
    if (model) {
      this._state.model = model;
    } else {
      // Model not available, keep the string for display
      console.warn(`Model ${data.params.model} not available`);
    }
    
    // Restore cached response
    if (data.cache) {
      this._state.response = data.cache.response;
      this._state.contextOutput = data.cache.contextOutput;
      this._state.usage = data.cache.usage;
      this._state.status = 'complete';
      
      // Set output values
      this.setOutput(this.outputs[0], this._state.response);
      this.setOutput(this.outputs[1], this._state.contextOutput);
    }
    
    // Update props to match
    this.props.model.value = data.params.model;
    this.props.temperature.value = data.params.temperature;
    this.props.maxTokens.value = data.params.maxTokens;
    this.props.displayMode.value = data.params.displayMode;
  }
}
```

### SystemNode Class

```typescript
// src/nodes/quill/SystemNode.ts

import { Node } from '../Node';

/**
 * Simple node that outputs a system prompt string
 * Connect to Chat node's 'system' input to set the persona/instructions
 */
export class SystemNode extends Node {
  static readonly type = 'quill/System';
  static readonly displayName = 'System Prompt';
  static readonly category = 'quill';
  static readonly description = 'Define the AI\'s persona and instructions';
  
  private _systemPrompt: string = '';
  
  protected setup(): void {
    this.out<string>('system', {
      displayName: 'System',
      description: 'System prompt to connect to Chat nodes'
    });
    
    this.addParm('prompt', {
      value: 'You are a helpful assistant.',
      displayName: 'System Prompt',
      description: 'Instructions for the AI',
      onChange: () => this.updateOutput()
    });
  }
  
  setPrompt(text: string): void {
    this._systemPrompt = text;
    this.props.prompt.value = text;
    this.updateOutput();
  }
  
  private updateOutput(): void {
    this._systemPrompt = this.props.prompt.value as string;
    this.setOutput(this.outputs[0], this._systemPrompt);
  }
  
  serialize() {
    return {
      type: SystemNode.type,
      id: this.id,
      position: { ...this.position },
      params: {
        prompt: this._systemPrompt
      }
    };
  }
  
  deserialize(data: any): void {
    this._systemPrompt = data.params.prompt;
    this.props.prompt.value = this._systemPrompt;
    this.updateOutput();
  }
}
```

---

## UI Components

### ChatNodeComponent

```svelte
<!-- src/editor/nodes/ChatNodeComponent.svelte -->
<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher, tick } from 'svelte';
  import type { ChatNode } from '@/nodes/quill/ChatNode';
  import type { ChatNodeState } from '@/types/chat.types';
  import { chatProviders } from '@/services/ChatProviderRegistry';
  import MarkdownRenderer from '../common/MarkdownRenderer.svelte';
  import ModelSelector from '../common/ModelSelector.svelte';
  import PortDot from '../common/PortDot.svelte';
  
  // Props
  export let node: ChatNode;
  export let selected: boolean = false;
  export let scale: number = 1;
  
  const dispatch = createEventDispatcher<{
    createFollowUp: void;
    expand: void;
    select: void;
  }>();
  
  // Local state
  let state: ChatNodeState = node.state;
  let promptEl: HTMLTextAreaElement;
  let isEditingPrompt = false;
  let isDraggingImage = false;
  
  // Subscriptions
  onMount(() => {
    node.on('stateChange', handleStateChange);
    node.on('streamDelta', handleStreamDelta);
  });
  
  onDestroy(() => {
    node.off('stateChange', handleStateChange);
    node.off('streamDelta', handleStreamDelta);
  });
  
  function handleStateChange(newState: ChatNodeState) {
    state = { ...newState };
  }
  
  function handleStreamDelta(_delta: string) {
    // Force re-render for streaming text
    state = state;
  }
  
  // === Event Handlers ===
  
  function handlePromptKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      node.send();
    }
    // Shift+Enter = newline (default behavior)
  }
  
  function handleNodeKeydown(e: KeyboardEvent) {
    if (!selected) return;
    
    // Don't intercept when editing prompt
    if (isEditingPrompt && e.target === promptEl) return;
    
    switch (e.key) {
      case 'Tab':
        e.preventDefault();
        dispatch('createFollowUp');
        break;
        
      case 'r':
      case 'R':
        if (!e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          node.regenerate();
        }
        break;
        
      case 'f':
      case 'F':
        if (!e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          node.toggleFreeze();
        }
        break;
        
      case 'e':
      case 'E':
        e.preventDefault();
        focusPrompt();
        break;
        
      case 'Escape':
        if (state.status === 'streaming') {
          e.preventDefault();
          node.cancel();
        } else if (isEditingPrompt) {
          promptEl?.blur();
        }
        break;
        
      case ' ':
        // Space = view in Viewer (when not editing)
        if (!isEditingPrompt) {
          e.preventDefault();
          dispatch('expand');
        }
        break;
    }
  }
  
  function handlePromptInput(e: Event) {
    const target = e.target as HTMLTextAreaElement;
    node.setPrompt(target.value);
    autoResizeTextarea(target);
  }
  
  function autoResizeTextarea(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }
  
  async function focusPrompt() {
    isEditingPrompt = true;
    await tick();
    promptEl?.focus();
    promptEl?.select();
  }
  
  function handlePromptFocus() {
    isEditingPrompt = true;
  }
  
  function handlePromptBlur() {
    isEditingPrompt = false;
  }
  
  // === Drag & Drop Images ===
  
  function handleDragOver(e: DragEvent) {
    if (!node.supportsVision()) return;
    e.preventDefault();
    isDraggingImage = true;
  }
  
  function handleDragLeave() {
    isDraggingImage = false;
  }
  
  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDraggingImage = false;
    
    if (!node.supportsVision()) return;
    
    const files = Array.from(e.dataTransfer?.files || []);
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    
    if (imageFiles.length === 0) return;
    
    // Convert to ImageBuffers
    // (Implementation would use AssetManager or similar)
    // For now, dispatch event to parent to handle
  }
  
  // === Computed ===
  
  $: displayMode = state.displayMode;
  $: isStreaming = state.status === 'streaming';
  $: isComplete = state.status === 'complete';
  $: isError = state.status === 'error';
  $: hasResponse = !!(state.response || state.streamBuffer);
  $: responseText = state.response || state.streamBuffer || '';
  $: supportsVision = node.supportsVision();
  
  $: truncatedResponse = responseText.length > 400 
    ? responseText.slice(0, 400) + '...' 
    : responseText;
  
  $: statusDisplay = {
    idle: '',
    ready: '⏎ send',
    streaming: '● streaming...',
    complete: state.usage ? `${state.usage.total} tok` : '✓',
    error: '⚠ error',
    cancelled: '○ cancelled'
  }[state.status];
  
  $: modelDisplay = state.model?.displayName || 'Select model';
</script>

<div 
  class="chat-node"
  class:selected
  class:streaming={isStreaming}
  class:complete={isComplete}
  class:error={isError}
  class:frozen={state.frozen}
  class:compact={displayMode === 'compact'}
  class:dragging-image={isDraggingImage}
  on:keydown={handleNodeKeydown}
  on:dragover={handleDragOver}
  on:dragleave={handleDragLeave}
  on:drop={handleDrop}
  tabindex="0"
  role="article"
  aria-label="Chat node"
>
  <!-- Header: Context port + Model selector -->
  <header class="header">
    <div class="input-port">
      <PortDot port={node.inputs[0]} side="input" />
    </div>
    
    <ModelSelector 
      value={`${state.model.provider}/${state.model.model}`}
      models={chatProviders.getAvailableModels()}
      disabled={isStreaming}
      on:change={(e) => {
        node.props.model.value = e.detail;
      }}
    />
    
    {#if state.frozen}
      <span class="frozen-badge" title="Frozen - won't regenerate">❄️</span>
    {/if}
  </header>
  
  <!-- Attachments (if any) -->
  {#if state.attachments.length > 0}
    <div class="attachments">
      {#each state.attachments as img, i}
        <div class="attachment-thumb">
          <img src={img.toDataURL()} alt="Attachment {i + 1}" />
          <button 
            class="remove-attachment" 
            on:click={() => node.removeAttachment(i)}
            title="Remove"
          >×</button>
        </div>
      {/each}
    </div>
  {/if}
  
  <!-- Prompt Area -->
  <div 
    class="prompt-area"
    class:has-content={state.prompt.length > 0}
    on:click={focusPrompt}
  >
    {#if displayMode === 'compact' && !isEditingPrompt && state.prompt}
      <div class="compact-prompt" on:click={focusPrompt}>
        "{state.prompt}"
      </div>
    {:else}
      <textarea
        bind:this={promptEl}
        value={state.prompt}
        on:input={handlePromptInput}
        on:keydown={handlePromptKeydown}
        on:focus={handlePromptFocus}
        on:blur={handlePromptBlur}
        placeholder={supportsVision ? "Type a message... (drop images here)" : "Type a message..."}
        rows="1"
        disabled={isStreaming}
        spellcheck="true"
      />
      {#if !state.prompt && !isEditingPrompt}
        <span class="hint">⏎ to send</span>
      {/if}
    {/if}
  </div>
  
  <!-- Response Area -->
  {#if hasResponse || isStreaming}
    <div class="divider" />
    
    <div class="response-area">
      {#if displayMode === 'compact'}
        <div class="compact-response">
          → {truncatedResponse}
        </div>
      {:else}
        <div class="response-content" class:streaming={isStreaming}>
          <MarkdownRenderer content={responseText} />
          {#if isStreaming}
            <span class="cursor">█</span>
          {/if}
        </div>
        
        {#if responseText.length > 400 && !isStreaming}
          <button 
            class="expand-btn" 
            on:click={() => dispatch('expand')}
            title="View full response"
          >
            ▼ more
          </button>
        {/if}
      {/if}
    </div>
  {/if}
  
  <!-- Error Display -->
  {#if isError && state.error}
    <div class="error-area">
      <span class="error-icon">⚠</span>
      <span class="error-message">{state.error}</span>
      <button class="retry-btn" on:click={() => node.regenerate()}>Retry</button>
    </div>
  {/if}
  
  <!-- Footer -->
  <footer class="footer">
    <span class="node-type">Chat</span>
    
    <span class="status">{statusDisplay}</span>
    
    {#if isComplete && !state.frozen}
      <button 
        class="action-btn regenerate" 
        on:click={() => node.regenerate()}
        title="Regenerate (R)"
      >
        ↻
      </button>
    {/if}
    
    {#if isComplete}
      <button 
        class="action-btn follow-up" 
        on:click={() => dispatch('createFollowUp')}
        title="Add follow-up (Tab)"
      >
        +
      </button>
    {/if}
  </footer>
  
  <!-- Output Ports -->
  <div class="output-ports">
    <PortDot port={node.outputs[0]} side="output" label="response" />
    <PortDot port={node.outputs[1]} side="output" label="context" />
  </div>
</div>

<style>
  .chat-node {
    --node-bg: #1e1e1e;
    --node-border: #333;
    --node-border-selected: #4a9eff;
    --node-border-streaming: #f0b429;
    --node-border-error: #e53935;
    --text: #e0e0e0;
    --text-muted: #888;
    --text-placeholder: #555;
    --divider: #2a2a2a;
    --accent: #4a9eff;
    
    background: var(--node-bg);
    border: 1px solid var(--node-border);
    border-radius: 8px;
    min-width: 300px;
    max-width: 480px;
    font-family: var(--font-sans, system-ui, sans-serif);
    font-size: 13px;
    color: var(--text);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  
  .chat-node:focus {
    border-color: var(--node-border-selected);
  }
  
  .chat-node.selected {
    border-color: var(--node-border-selected);
    box-shadow: 0 0 0 2px rgba(74, 158, 255, 0.2);
  }
  
  .chat-node.streaming {
    border-color: var(--node-border-streaming);
  }
  
  .chat-node.error {
    border-color: var(--node-border-error);
  }
  
  .chat-node.frozen {
    opacity: 0.85;
  }
  
  .chat-node.dragging-image {
    border-color: var(--accent);
    border-style: dashed;
  }
  
  /* Header */
  .header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--divider);
  }
  
  .input-port {
    margin-left: -8px;
  }
  
  .frozen-badge {
    font-size: 14px;
    margin-left: auto;
  }
  
  /* Attachments */
  .attachments {
    display: flex;
    gap: 8px;
    padding: 8px 12px;
    flex-wrap: wrap;
    background: rgba(0, 0, 0, 0.2);
  }
  
  .attachment-thumb {
    position: relative;
    width: 48px;
    height: 48px;
  }
  
  .attachment-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 4px;
  }
  
  .remove-attachment {
    position: absolute;
    top: -4px;
    right: -4px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: none;
    background: #e53935;
    color: white;
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s;
  }
  
  .attachment-thumb:hover .remove-attachment {
    opacity: 1;
  }
  
  /* Prompt Area */
  .prompt-area {
    padding: 12px;
    min-height: 44px;
    position: relative;
  }
  
  .prompt-area textarea {
    width: 100%;
    background: transparent;
    border: none;
    color: var(--text);
    font-family: inherit;
    font-size: inherit;
    line-height: 1.5;
    resize: none;
    outline: none;
    min-height: 22px;
    max-height: 200px;
  }
  
  .prompt-area textarea::placeholder {
    color: var(--text-placeholder);
  }
  
  .prompt-area textarea:disabled {
    opacity: 0.7;
  }
  
  .prompt-area .hint {
    position: absolute;
    right: 12px;
    bottom: 12px;
    font-size: 11px;
    color: var(--text-muted);
    pointer-events: none;
  }
  
  .compact-prompt {
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: text;
  }
  
  /* Divider */
  .divider {
    height: 1px;
    background: var(--divider);
    margin: 0 12px;
  }
  
  /* Response Area */
  .response-area {
    padding: 12px;
    max-height: 250px;
    overflow-y: auto;
  }
  
  .response-content {
    line-height: 1.6;
    word-wrap: break-word;
  }
  
  .response-content.streaming {
    color: var(--text-muted);
  }
  
  .cursor {
    animation: blink 0.7s infinite;
    color: var(--accent);
  }
  
  @keyframes blink {
    0%, 50% { opacity: 1; }
    51%, 100% { opacity: 0; }
  }
  
  .compact-response {
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  
  .expand-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 4px 0;
    font-size: 11px;
    margin-top: 8px;
  }
  
  .expand-btn:hover {
    color: var(--text);
  }
  
  /* Error Area */
  .error-area {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: rgba(229, 57, 53, 0.1);
    color: #e53935;
    font-size: 12px;
  }
  
  .error-icon {
    flex-shrink: 0;
  }
  
  .error-message {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  
  .retry-btn {
    background: none;
    border: 1px solid currentColor;
    border-radius: 4px;
    color: inherit;
    padding: 2px 8px;
    cursor: pointer;
    font-size: 11px;
  }
  
  .retry-btn:hover {
    background: rgba(229, 57, 53, 0.2);
  }
  
  /* Footer */
  .footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-top: 1px solid var(--divider);
    font-size: 11px;
    color: var(--text-muted);
  }
  
  .node-type {
    font-weight: 500;
  }
  
  .status {
    margin-left: auto;
  }
  
  .action-btn {
    background: transparent;
    border: 1px solid var(--divider);
    border-radius: 4px;
    color: var(--text-muted);
    width: 22px;
    height: 22px;
    cursor: pointer;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
  }
  
  .action-btn:hover {
    background: var(--divider);
    color: var(--text);
  }
  
  .action-btn.follow-up {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }
  
  .action-btn.follow-up:hover {
    background: #3a8eef;
  }
  
  /* Output Ports */
  .output-ports {
    display: flex;
    justify-content: space-around;
    padding: 4px 12px 8px;
  }
  
  /* Compact Mode Adjustments */
  .chat-node.compact {
    max-width: 320px;
  }
  
  .chat-node.compact .response-area {
    max-height: 60px;
  }
</style>
```

### ModelSelector Component

```svelte
<!-- src/editor/common/ModelSelector.svelte -->
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { ProviderModel } from '@/types/chat.types';
  
  export let value: string;
  export let models: ProviderModel[] = [];
  export let disabled: boolean = false;
  
  const dispatch = createEventDispatcher<{ change: string }>();
  
  // Group models by provider
  $: groupedModels = models.reduce((acc, model) => {
    const provider = model.provider;
    if (!acc[provider]) acc[provider] = [];
    acc[provider].push(model);
    return acc;
  }, {} as Record<string, ProviderModel[]>);
  
  $: providerNames = {
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    google: 'Google'
  };
  
  function handleChange(e: Event) {
    const select = e.target as HTMLSelectElement;
    dispatch('change', select.value);
  }
  
  $: selectedModel = models.find(m => `${m.provider}/${m.model}` === value);
  $: displayName = selectedModel?.displayName || 'Select model';
</script>

<div class="model-selector">
  <select 
    {value} 
    on:change={handleChange}
    {disabled}
    class:has-selection={!!selectedModel}
  >
    {#if !selectedModel}
      <option value="" disabled>Select model</option>
    {/if}
    
    {#each Object.entries(groupedModels) as [provider, providerModels]}
      <optgroup label={providerNames[provider] || provider}>
        {#each providerModels as model}
          <option value={`${model.provider}/${model.model}`}>
            {model.displayName}
            {#if model.capabilities.vision}
              👁
            {/if}
          </option>
        {/each}
      </optgroup>
    {/each}
  </select>
  
  <span class="display-name">{displayName}</span>
  <span class="chevron">▾</span>
</div>

<style>
  .model-selector {
    position: relative;
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--text-muted, #888);
  }
  
  select {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
    width: 100%;
  }
  
  select:disabled {
    cursor: not-allowed;
  }
  
  .display-name {
    pointer-events: none;
  }
  
  .chevron {
    font-size: 10px;
    opacity: 0.6;
    pointer-events: none;
  }
  
  .model-selector:hover .display-name {
    color: var(--text, #e0e0e0);
  }
</style>
```

### ConversationViewer Component

```svelte
<!-- src/editor/viewers/ConversationViewer.svelte -->
<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import type { ChatNode } from '@/nodes/quill/ChatNode';
  import type { Message } from '@/types/chat.types';
  import MarkdownRenderer from '../common/MarkdownRenderer.svelte';
  
  export let node: ChatNode;
  
  let messages: Message[] = [];
  let messagesContainer: HTMLDivElement;
  
  onMount(() => {
    updateMessages();
    node.on('stateChange', updateMessages);
    node.on('streamDelta', handleStreamDelta);
  });
  
  onDestroy(() => {
    node.off('stateChange', updateMessages);
    node.off('streamDelta', handleStreamDelta);
  });
  
  function updateMessages() {
    messages = node.getConversation();
    scrollToBottom();
  }
  
  function handleStreamDelta() {
    messages = node.getConversation();
    scrollToBottom();
  }
  
  async function scrollToBottom() {
    await tick();
    if (messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  }
  
  function getRoleLabel(message: Message): string {
    if (message.role === 'system') return 'System';
    if (message.role === 'user') return 'You';
    if (message.role === 'assistant') {
      // Extract friendly name from model
      const model = message.meta?.model || '';
      if (model.includes('claude')) return 'Claude';
      if (model.includes('gpt')) return 'ChatGPT';
      if (model.includes('gemini')) return 'Gemini';
      return 'Assistant';
    }
    return message.role;
  }
  
  function getMessageText(message: Message): string {
    if (typeof message.content === 'string') {
      return message.content;
    }
    return message.content
      .filter(p => p.type === 'text')
      .map(p => p.text)
      .join('\n');
  }
  
  function hasImages(message: Message): boolean {
    return Array.isArray(message.content) && 
      message.content.some(p => p.type === 'image');
  }
  
  function getImageUrls(message: Message): string[] {
    if (!Array.isArray(message.content)) return [];
    return message.content
      .filter(p => p.type === 'image' && p.image)
      .map(p => {
        const img = p.image!;
        if (img.source === 'url') return img.data;
        if (img.source === 'base64') return `data:${img.mediaType || 'image/png'};base64,${img.data}`;
        return '';
      })
      .filter(Boolean);
  }
  
  function formatTimestamp(ts?: number): string {
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  }
</script>

<div class="conversation-viewer">
  <header class="header">
    <h3>Conversation</h3>
    <span class="message-count">{messages.length} messages</span>
  </header>
  
  <div class="messages" bind:this={messagesContainer}>
    {#each messages as message (message.meta?.id || Math.random())}
      <article class="message {message.role}">
        <header class="message-header">
          <span class="role-label">{getRoleLabel(message)}</span>
          {#if message.meta?.timestamp}
            <time class="timestamp">{formatTimestamp(message.meta.timestamp)}</time>
          {/if}
        </header>
        
        {#if hasImages(message)}
          <div class="message-images">
            {#each getImageUrls(message) as src}
              <img {src} alt="Attached image" loading="lazy" />
            {/each}
          </div>
        {/if}
        
        <div class="message-content">
          {#if message.role === 'assistant'}
            <MarkdownRenderer content={getMessageText(message)} />
          {:else}
            <p>{getMessageText(message)}</p>
          {/if}
        </div>
        
        {#if message.meta?.tokens || message.meta?.duration}
          <footer class="message-meta">
            {#if message.meta.tokens}
              {message.meta.tokens} tokens
            {/if}
            {#if message.meta.duration}
              · {(message.meta.duration / 1000).toFixed(1)}s
            {/if}
          </footer>
        {/if}
      </article>
    {/each}
    
    {#if messages.length === 0}
      <div class="empty-state">
        No messages yet. Send a prompt to start the conversation.
      </div>
    {/if}
  </div>
</div>

<style>
  .conversation-viewer {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--bg, #1a1a1a);
    color: var(--text, #e0e0e0);
  }
  
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--divider, #2a2a2a);
    flex-shrink: 0;
  }
  
  .header h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }
  
  .message-count {
    font-size: 12px;
    color: var(--text-muted, #666);
  }
  
  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  
  .message {
    padding: 12px 16px;
    border-radius: 8px;
    background: var(--message-bg, #252525);
  }
  
  .message.system {
    background: #1e3a5f;
    border-left: 3px solid #4a9eff;
  }
  
  .message.user {
    background: #2d2d2d;
  }
  
  .message.assistant {
    background: #252525;
    border-left: 3px solid #10b981;
  }
  
  .message-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  
  .role-label {
    font-weight: 600;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  
  .message.system .role-label { color: #4a9eff; }
  .message.user .role-label { color: #999; }
  .message.assistant .role-label { color: #10b981; }
  
  .timestamp {
    font-size: 11px;
    color: var(--text-muted, #666);
  }
  
  .message-images {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 12px;
  }
  
  .message-images img {
    max-width: 200px;
    max-height: 150px;
    border-radius: 6px;
    object-fit: cover;
  }
  
  .message-content {
    line-height: 1.6;
  }
  
  .message-content p {
    margin: 0;
    white-space: pre-wrap;
  }
  
  .message-meta {
    margin-top: 8px;
    font-size: 11px;
    color: var(--text-muted, #666);
  }
  
  .empty-state {
    text-align: center;
    color: var(--text-muted, #666);
    padding: 40px;
  }
</style>
```

---

## Keyboard Shortcuts

### Chat Node Shortcuts

| Key | Action | Context |
|-----|--------|---------|
| `Enter` | Send message | In prompt textarea |
| `Shift+Enter` | New line | In prompt textarea |
| `Tab` | Create follow-up node | Node selected |
| `R` | Regenerate response | Node selected |
| `F` | Toggle freeze | Node selected |
| `E` | Edit prompt | Node selected |
| `Escape` | Cancel generation / blur | Streaming or editing |
| `Space` | View in full viewer | Node selected |
| `M` | Open model picker | Node selected (future) |

### Graph-Level Shortcuts

| Key | Action |
|-----|--------|
| `C` | Create new Chat node at cursor |
| `Cmd+Enter` | Send all ready Chat nodes |

---

## Follow-Up Node Creation

When user presses `Tab` or clicks `[+]` on a completed Chat node:

```typescript
// In GraphController or similar

function createChatFollowUp(sourceNode: ChatNode): ChatNode {
  const graph = sourceNode.graph;
  
  // Create new Chat node
  const newNode = graph.createNode('quill/Chat') as ChatNode;
  
  // Position below source with offset
  const spacing = 40;
  newNode.position = {
    x: sourceNode.position.x + 20,
    y: sourceNode.position.y + (sourceNode.size?.height || 150) + spacing
  };
  
  // Inherit model from source
  newNode.props.model.value = sourceNode.props.model.value;
  
  // Connect: source.context → new.context
  graph.connect(
    sourceNode.outputs[1], // context output
    newNode.inputs[0]      // context input
  );
  
  // Select and focus new node
  graph.selection.clear();
  graph.selection.add(newNode);
  
  // Focus prompt textarea (after render)
  requestAnimationFrame(() => {
    const component = getNodeComponent(newNode);
    component?.focusPrompt?.();
  });
  
  return newNode;
}
```

---

## Multi-Model Patterns

### Same Question, Different Models

```
┌─────────────────────────────┐
│ "explain quantum computing" │
│                  Claude 3.5 │
└──────────────○──────────────┘
               │ context
       ┌───────┴───────┐
       ▼               ▼
┌──────○───────┐ ┌─────○────────┐
│ "simplify"   │ │ "simplify"   │
│   Claude 3.5 │ │      GPT-4o  │
└──────────────┘ └──────────────┘
```

### Model Chain (Different Models for Different Tasks)

```
┌───────────────────┐     ┌───────────────────┐     ┌───────────────────┐
│ "draft an email   │     │ "make it more     │     │ "translate to     │
│  about project"   │────▶│  professional"    │────▶│  French"          │
│                   │     │                   │     │                   │
│      Claude Haiku │     │    Claude Sonnet  │     │       GPT-4o      │
│  (fast drafting)  │     │  (quality edit)   │     │   (translation)   │
└───────────────────┘     └───────────────────┘     └───────────────────┘
```

---

## Error Handling

### Error Types

```typescript
type ChatError = 
  | { type: 'network'; message: string }
  | { type: 'auth'; message: string; provider: string }
  | { type: 'rate_limit'; message: string; retryAfter?: number }
  | { type: 'context_length'; message: string; maxTokens: number }
  | { type: 'content_filter'; message: string }
  | { type: 'provider'; message: string; code?: string }
  | { type: 'unknown'; message: string };
```

### Error Display

Errors show in the node with:
- Red border
- Error message in dedicated area
- Retry button (when applicable)
- Details in Inspector panel

### Retry Logic

```typescript
async function sendWithRetry(
  node: ChatNode, 
  maxRetries: number = 3
): Promise<void> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await node.send();
      return; // Success
    } catch (error) {
      lastError = error;
      
      // Don't retry certain errors
      if (error.type === 'auth' || error.type === 'content_filter') {
        throw error;
      }
      
      // Exponential backoff
      if (attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000;
        await sleep(delay);
      }
    }
  }
  
  throw lastError;
}
```

---

## Credential Storage

API keys are stored securely in user preferences, never in project files:

```typescript
// Location: ~/.cascade/credentials.yaml (or secure storage)

interface Credentials {
  anthropic?: string;
  openai?: string;
  google?: string;
}

// Access via CredentialStore service
class CredentialStore {
  async get(provider: string): Promise<string | null>;
  async set(provider: string, key: string): Promise<void>;
  async delete(provider: string): Promise<void>;
  async has(provider: string): Promise<boolean>;
}
```

---

## File Structure

```
src/
├── nodes/
│   └── quill/
│       ├── index.ts           # Package exports
│       ├── ChatNode.ts        # Main chat node
│       └── SystemNode.ts      # System prompt node
│
├── services/
│   ├── ChatProviderRegistry.ts
│   └── providers/
│       ├── AnthropicProvider.ts
│       ├── OpenAIProvider.ts
│       └── GoogleProvider.ts
│
├── engine/
│   └── ChatStreamHandler.ts
│
├── editor/
│   ├── nodes/
│   │   └── ChatNodeComponent.svelte
│   ├── viewers/
│   │   └── ConversationViewer.svelte
│   └── common/
│       ├── ModelSelector.svelte
│       └── MarkdownRenderer.svelte
│
├── types/
│   └── chat.types.ts
│
└── server/
    └── routes/
        └── chat.ts
```

---

## Implementation Phases

### Phase 1: Core Infrastructure (Week 1)
- [ ] Define TypeScript types (`chat.types.ts`)
- [ ] Implement `ChatProviderRegistry`
- [ ] Implement `AnthropicProvider` with streaming
- [ ] Create backend `/api/chat/stream` endpoint
- [ ] Implement `ChatStreamHandler` on frontend
- [ ] Basic `ChatNode` class (send, stream, cancel)

### Phase 2: UI Components (Week 2)
- [ ] `ChatNodeComponent.svelte` with all states
- [ ] `ModelSelector.svelte`
- [ ] `MarkdownRenderer.svelte` integration
- [ ] `PortDot` styling for chat context type
- [ ] Keyboard shortcuts (Enter, Tab, R, Escape)

### Phase 3: Conversation Flow (Week 3)
- [ ] Context input/output working
- [ ] Follow-up node creation (Tab)
- [ ] `ConversationViewer.svelte`
- [ ] Viewer integration (select node → show conversation)
- [ ] `SystemNode` implementation

### Phase 4: Additional Providers (Week 4)
- [ ] `OpenAIProvider` implementation
- [ ] `GoogleProvider` implementation  
- [ ] Provider-specific message formatting
- [ ] Model capability badges (vision icon)

### Phase 5: Vision & Attachments (Week 5)
- [ ] Image drag-drop onto Chat nodes
- [ ] ImageBuffer → base64 conversion
- [ ] Attachment UI in node
- [ ] Connect Lens nodes to Chat attachments input

### Phase 6: Polish & Edge Cases (Week 6)
- [ ] Error handling and display
- [ ] Retry logic with exponential backoff
- [ ] Token counting/estimation
- [ ] Cache restoration on project load
- [ ] Compact display mode
- [ ] Context menu actions
- [ ] Documentation

---

## Testing Strategy

### Unit Tests

```typescript
// tests/chat/ChatNode.test.ts

describe('ChatNode', () => {
  it('should initialize with default state', () => {
    const node = new ChatNode();
    expect(node.state.status).toBe('idle');
    expect(node.state.prompt).toBe('');
  });
  
  it('should update status to ready when prompt is set', () => {
    const node = new ChatNode();
    node.setPrompt('Hello');
    expect(node.state.status).toBe('ready');
  });
  
  it('should not send when frozen', async () => {
    const node = new ChatNode();
    node.setPrompt('Hello');
    node.toggleFreeze();
    await node.send();
    expect(node.state.status).toBe('ready'); // Unchanged
  });
  
  it('should build context output after completion', async () => {
    // Mock streaming
    const node = new ChatNode();
    node.setPrompt('Hello');
    // ... mock stream response
    expect(node.state.contextOutput?.messages.length).toBe(2);
  });
});
```

### Integration Tests

```typescript
// tests/chat/conversation-flow.test.ts

describe('Conversation Flow', () => {
  it('should chain context between nodes', async () => {
    const graph = new Graph();
    
    const node1 = graph.createNode('quill/Chat') as ChatNode;
    node1.setPrompt('Question 1');
    // ... mock response
    
    const node2 = graph.createNode('quill/Chat') as ChatNode;
    graph.connect(node1.outputs[1], node2.inputs[0]);
    node2.setPrompt('Follow up');
    
    const conversation = node2.getConversation();
    expect(conversation.length).toBe(3); // Q1, A1, Q2
  });
});
```

---

## Future Considerations

### Token Management
- Context window warnings when approaching limit
- Auto-summarization of long conversations
- Token budget per conversation

### Advanced Features
- System prompt templates/presets
- Conversation forking (branch from any point)
- Export conversation to markdown
- Import conversation from other tools

### Performance
- Message virtualization for very long conversations
- Lazy loading of cached responses
- Streaming buffer optimization

---

*This specification provides the foundation for implementing conversational AI workflows in Cascade. The modular architecture allows for incremental development and easy addition of new providers.*
