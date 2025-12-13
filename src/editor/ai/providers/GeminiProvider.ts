/**
 * Gemini Provider - Google Gemini API integration
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

const DEFAULT_MODEL = 'gemini-1.5-pro';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export class GeminiProvider implements AIProviderInterface {
  name = 'gemini' as const;
  displayName = 'Gemini';
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
      throw new Error('Gemini API key not configured');
    }

    const model = config.model || DEFAULT_MODEL;
    const userPrompt = AICodeGenerator.buildPrompt(request.prompt, request.context);
    const url = `${API_BASE}/${model}:generateContent?key=${config.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: SYSTEM_PROMPT }]
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: userPrompt }]
          }
        ],
        generationConfig: {
          maxOutputTokens: 4096,
          temperature: 0.7
        }
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
      throw new Error(error.error?.message || `Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const code = this.extractCode(text);

    return {
      code,
      provider: 'gemini',
      model,
      tokensUsed: data.usageMetadata?.totalTokenCount
    };
  }

  async generateStream(request: GenerationRequest, callbacks: StreamCallbacks): Promise<void> {
    const config = this.getConfig();
    if (!config?.apiKey) {
      callbacks.onError(new Error('Gemini API key not configured'));
      return;
    }

    const model = config.model || DEFAULT_MODEL;
    const userPrompt = AICodeGenerator.buildPrompt(request.prompt, request.context);
    const url = `${API_BASE}/${model}:streamGenerateContent?key=${config.apiKey}&alt=sse`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: SYSTEM_PROMPT }]
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: userPrompt }]
            }
          ],
          generationConfig: {
            maxOutputTokens: 4096,
            temperature: 0.7
          }
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
        throw new Error(error.error?.message || `Gemini API error: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let fullText = '';
      let totalTokens = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);

            try {
              const parsed = JSON.parse(data);
              const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
              if (text) {
                fullText += text;
                callbacks.onToken(text);
              }
              if (parsed.usageMetadata?.totalTokenCount) {
                totalTokens = parsed.usageMetadata.totalTokenCount;
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
        provider: 'gemini',
        model,
        tokensUsed: totalTokens
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
