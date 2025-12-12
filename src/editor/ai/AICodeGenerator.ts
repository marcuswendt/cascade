/**
 * AICodeGenerator - Multi-provider AI code generation service
 */

import type {
  AIProvider,
  AIProviderConfig,
  AIProviderInterface,
  GenerationRequest,
  GenerationResult,
  StreamCallbacks,
  NodeCodeContext
} from './types.js';
import { ClaudeProvider } from './providers/ClaudeProvider.js';
import { OpenAIProvider } from './providers/OpenAIProvider.js';
import { GeminiProvider } from './providers/GeminiProvider.js';

export class AICodeGenerator {
  private providers: Map<AIProvider, AIProviderInterface> = new Map();
  private configs: Map<AIProvider, AIProviderConfig> = new Map();

  constructor() {
    // Initialize providers (they'll check configs when generating)
    this.providers.set('claude', new ClaudeProvider(() => this.configs.get('claude')));
    this.providers.set('openai', new OpenAIProvider(() => this.configs.get('openai')));
    this.providers.set('gemini', new GeminiProvider(() => this.configs.get('gemini')));
  }

  /**
   * Configure a provider with API key and settings
   */
  configure(provider: AIProvider, config: AIProviderConfig): void {
    this.configs.set(provider, config);
  }

  /**
   * Check if a provider is configured
   */
  isConfigured(provider: AIProvider): boolean {
    const config = this.configs.get(provider);
    return !!config?.apiKey;
  }

  /**
   * Get all configured providers
   */
  getConfiguredProviders(): AIProvider[] {
    return Array.from(this.configs.entries())
      .filter(([_, config]) => !!config.apiKey)
      .map(([provider]) => provider);
  }

  /**
   * Get provider display name
   */
  getProviderDisplayName(provider: AIProvider): string {
    const instance = this.providers.get(provider);
    return instance?.displayName || provider;
  }

  /**
   * Generate code using specified provider
   */
  async generate(request: GenerationRequest): Promise<GenerationResult> {
    const provider = this.providers.get(request.provider);
    if (!provider) {
      throw new Error(`Unknown provider: ${request.provider}`);
    }

    if (!this.isConfigured(request.provider)) {
      throw new Error(`Provider ${request.provider} is not configured. Please add an API key in Settings.`);
    }

    return provider.generate(request);
  }

  /**
   * Generate code with streaming response
   */
  async generateStream(
    request: GenerationRequest,
    callbacks: StreamCallbacks
  ): Promise<void> {
    const provider = this.providers.get(request.provider);
    if (!provider) {
      callbacks.onError(new Error(`Unknown provider: ${request.provider}`));
      return;
    }

    if (!this.isConfigured(request.provider)) {
      callbacks.onError(
        new Error(`Provider ${request.provider} is not configured. Please add an API key in Settings.`)
      );
      return;
    }

    return provider.generateStream(request, callbacks);
  }

  /**
   * Build context from a Computation node
   */
  static buildContext(node: any, modulePath: string): NodeCodeContext {
    const connectedInputs = (node.inputs || []).map((input: any) => ({
      name: input.name,
      type: input.dataType || 'any',
      connected: input.connections?.length > 0
    }));

    const connectedOutputs = (node.outputs || []).map((output: any) => ({
      name: output.name,
      type: output.dataType || 'any',
      connected: output.connections?.length > 0
    }));

    const props = Object.entries(node.props || {}).map(([name, prop]: [string, any]) => ({
      name,
      type: prop.type || 'any',
      value: prop.value
    }));

    return {
      currentCode: node.code || '',
      modulePath,
      nodeType: node.type || 'Custom',
      connectedInputs,
      connectedOutputs,
      props
    };
  }

  /**
   * Build the user prompt with context
   */
  static buildPrompt(userPrompt: string, context: NodeCodeContext): string {
    let prompt = userPrompt;

    // Add context about current code if editing
    if (context.currentCode.trim()) {
      prompt += `\n\n## Current Code\n\`\`\`typescript\n${context.currentCode}\n\`\`\``;
    }

    // Add context about connected ports
    if (context.connectedInputs.length > 0) {
      const inputs = context.connectedInputs
        .filter(i => i.connected)
        .map(i => `- ${i.name}: ${i.type}`)
        .join('\n');
      if (inputs) {
        prompt += `\n\n## Connected Inputs\n${inputs}`;
      }
    }

    if (context.connectedOutputs.length > 0) {
      const outputs = context.connectedOutputs
        .filter(o => o.connected)
        .map(o => `- ${o.name}: ${o.type}`)
        .join('\n');
      if (outputs) {
        prompt += `\n\n## Connected Outputs (expected)\n${outputs}`;
      }
    }

    return prompt;
  }
}

// Singleton instance
let instance: AICodeGenerator | null = null;

export function getAICodeGenerator(): AICodeGenerator {
  if (!instance) {
    instance = new AICodeGenerator();
  }
  return instance;
}

export function configureAIProvider(provider: AIProvider, config: AIProviderConfig): void {
  getAICodeGenerator().configure(provider, config);
}
