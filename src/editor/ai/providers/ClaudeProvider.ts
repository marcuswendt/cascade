/**
 * Claude Provider - Anthropic Claude API integration
 */

import type {
  AIProviderConfig,
  AIProviderInterface,
  GenerationRequest,
  GenerationResult,
  StreamCallbacks
} from '../types.js';
import { SYSTEM_PROMPT } from '../types.js';
import { AICodeGenerator } from '../AICodeGenerator.js';

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const API_URL = 'https://api.anthropic.com/v1/messages';

export class ClaudeProvider implements AIProviderInterface {
  name = 'claude' as const;
  displayName = 'Claude';
  private getConfig: () => AIProviderConfig | undefined;

  constructor(getConfig: () => AIProviderConfig | undefined) {
    this.getConfig = getConfig;
  }

  isConfigured(): boolean {
    return !!this.getConfig()?.apiKey;
  }

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    const config = this.getConfig();
    if (!config?.apiKey) {
      throw new Error('Claude API key not configured');
    }

    const model = config.model || DEFAULT_MODEL;
    const userPrompt = AICodeGenerator.buildPrompt(request.prompt, request.context);

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

  async generateStream(request: GenerationRequest, callbacks: StreamCallbacks): Promise<void> {
    const config = this.getConfig();
    if (!config?.apiKey) {
      callbacks.onError(new Error('Claude API key not configured'));
      return;
    }

    const model = config.model || DEFAULT_MODEL;
    const userPrompt = AICodeGenerator.buildPrompt(request.prompt, request.context);

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

  private extractCode(text: string): string {
    // Remove markdown code blocks if present
    const codeBlockMatch = text.match(/```(?:typescript|ts|javascript|js)?\n?([\s\S]*?)```/);
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }
    return text.trim();
  }
}
