/**
 * Claude Provider - Anthropic Claude API integration with CLI fallback
 */

import type {
  AIProviderConfig,
  AIProviderInterface,
  GenerationRequest,
  GenerationResult,
  StreamCallbacks
} from '../types.js';
import { SYSTEM_PROMPT } from '../systemPrompt.js';
import { AICodeGenerator } from '../AICodeGenerator.js';

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const API_URL = 'https://api.anthropic.com/v1/messages';
const CLI_API_BASE = 'http://localhost:3030/api/ai';

export class ClaudeProvider implements AIProviderInterface {
  name = 'claude' as const;
  displayName = 'Claude';
  private getConfig: () => AIProviderConfig | undefined;
  private cliAvailable: boolean | null = null;

  constructor(getConfig: () => AIProviderConfig | undefined) {
    this.getConfig = getConfig;
  }

  /**
   * Check if CLI is available (cached after first check)
   */
  async checkCliAvailable(): Promise<boolean> {
    if (this.cliAvailable !== null) {
      return this.cliAvailable;
    }

    try {
      const response = await fetch(`${CLI_API_BASE}/claude-cli/status`);
      if (response.ok) {
        const data = await response.json();
        this.cliAvailable = data.available === true;
      } else {
        this.cliAvailable = false;
      }
    } catch {
      this.cliAvailable = false;
    }

    return this.cliAvailable;
  }

  isConfigured(): boolean {
    return !!this.getConfig()?.apiKey;
  }

  /**
   * Check if either API or CLI is available
   */
  async isAvailable(): Promise<boolean> {
    if (this.isConfigured()) {
      return true;
    }
    return this.checkCliAvailable();
  }

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    const config = this.getConfig();
    const userPrompt = AICodeGenerator.buildPrompt(request.prompt, request.context);

    // If API key is configured, use API
    if (config?.apiKey) {
      return this.generateWithApi(userPrompt, config);
    }

    // Try CLI fallback
    const cliAvailable = await this.checkCliAvailable();
    if (cliAvailable) {
      return this.generateWithCli(userPrompt);
    }

    throw new Error('Claude API key not configured and CLI not available');
  }

  private async generateWithApi(userPrompt: string, config: AIProviderConfig): Promise<GenerationResult> {
    const model = config.model || DEFAULT_MODEL;

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: userPrompt }
        ]
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
      throw new Error(error.error?.message || `Claude API error: ${response.status}`);
    }

    const data = await response.json();
    const code = this.extractCode(data.content[0]?.text || '');

    return {
      code,
      provider: 'claude',
      model,
      tokensUsed: data.usage?.input_tokens + data.usage?.output_tokens
    };
  }

  private async generateWithCli(userPrompt: string): Promise<GenerationResult> {
    const response = await fetch(`${CLI_API_BASE}/claude-cli/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: userPrompt,
        systemPrompt: SYSTEM_PROMPT
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'CLI request failed' }));
      throw new Error(error.error || 'Claude CLI error');
    }

    const data = await response.json();
    const code = this.extractCode(data.code || '');

    return {
      code,
      provider: 'claude',
      model: 'claude-cli'
    };
  }

  async generateStream(request: GenerationRequest, callbacks: StreamCallbacks): Promise<void> {
    const config = this.getConfig();
    const userPrompt = AICodeGenerator.buildPrompt(request.prompt, request.context);

    // If API key is configured, use API
    if (config?.apiKey) {
      return this.streamWithApi(userPrompt, config, callbacks);
    }

    // Try CLI fallback
    const cliAvailable = await this.checkCliAvailable();
    if (cliAvailable) {
      return this.streamWithCli(userPrompt, callbacks);
    }

    callbacks.onError(new Error('Claude API key not configured and CLI not available'));
  }

  private async streamWithApi(
    userPrompt: string,
    config: AIProviderConfig,
    callbacks: StreamCallbacks
  ): Promise<void> {
    const model = config.model || DEFAULT_MODEL;

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          stream: true,
          system: SYSTEM_PROMPT,
          messages: [
            { role: 'user', content: userPrompt }
          ]
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
        throw new Error(error.error?.message || `Claude API error: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let fullText = '';
      let inputTokens = 0;
      let outputTokens = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);

              if (parsed.type === 'content_block_delta') {
                const text = parsed.delta?.text || '';
                fullText += text;
                callbacks.onToken(text);
              } else if (parsed.type === 'message_delta') {
                outputTokens = parsed.usage?.output_tokens || outputTokens;
              } else if (parsed.type === 'message_start') {
                inputTokens = parsed.message?.usage?.input_tokens || 0;
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }

      const code = this.extractCode(fullText);
      callbacks.onComplete({
        code,
        provider: 'claude',
        model,
        tokensUsed: inputTokens + outputTokens
      });
    } catch (error) {
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async streamWithCli(userPrompt: string, callbacks: StreamCallbacks): Promise<void> {
    try {
      const response = await fetch(`${CLI_API_BASE}/claude-cli/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: userPrompt,
          systemPrompt: SYSTEM_PROMPT
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'CLI request failed' }));
        throw new Error(error.error || 'Claude CLI error');
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (!data) continue;

            try {
              const parsed = JSON.parse(data);

              if (parsed.type === 'token') {
                fullText += parsed.content;
                callbacks.onToken(parsed.content);
              } else if (parsed.type === 'complete') {
                const code = this.extractCode(parsed.code || fullText);
                callbacks.onComplete({
                  code,
                  provider: 'claude',
                  model: 'claude-cli'
                });
                return;
              } else if (parsed.type === 'error') {
                throw new Error(parsed.content);
              }
            } catch (e) {
              // Skip invalid JSON, but rethrow actual errors
              if (e instanceof Error && e.message !== 'Unexpected end of JSON input') {
                throw e;
              }
            }
          }
        }
      }

      // If we got here without a complete event, use accumulated text
      const code = this.extractCode(fullText);
      callbacks.onComplete({
        code,
        provider: 'claude',
        model: 'claude-cli'
      });
    } catch (error) {
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private extractCode(text: string): string {
    // Remove markdown code blocks if present
    const codeBlockMatch = text.match(/```(?:typescript|ts|javascript|js)?\n?([\s\S]*?)```/);
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }
    return text.trim();
  }
}
