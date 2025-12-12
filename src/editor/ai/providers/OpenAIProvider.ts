/**
 * OpenAI Provider - OpenAI GPT API integration
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

const DEFAULT_MODEL = 'gpt-4o';
const API_URL = 'https://api.openai.com/v1/chat/completions';

export class OpenAIProvider implements AIProviderInterface {
  name = 'openai' as const;
  displayName = 'OpenAI';
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
      throw new Error('OpenAI API key not configured');
    }

    const model = config.model || DEFAULT_MODEL;
    const userPrompt = AICodeGenerator.buildPrompt(request.prompt, request.context);
    const baseUrl = config.baseUrl || API_URL;

    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ]
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
      throw new Error(error.error?.message || `OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const code = this.extractCode(data.choices[0]?.message?.content || '');

    return {
      code,
      provider: 'openai',
      model,
      tokensUsed: data.usage?.total_tokens
    };
  }

  async generateStream(request: GenerationRequest, callbacks: StreamCallbacks): Promise<void> {
    const config = this.getConfig();
    if (!config?.apiKey) {
      callbacks.onError(new Error('OpenAI API key not configured'));
      return;
    }

    const model = config.model || DEFAULT_MODEL;
    const userPrompt = AICodeGenerator.buildPrompt(request.prompt, request.context);
    const baseUrl = config.baseUrl || API_URL;

    try {
      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          stream: true,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt }
          ]
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
        throw new Error(error.error?.message || `OpenAI API error: ${response.status}`);
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
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content || '';
              if (content) {
                fullText += content;
                callbacks.onToken(content);
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
        provider: 'openai',
        model
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
