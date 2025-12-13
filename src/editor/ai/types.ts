/**
 * AI Code Generation Types
 */

export type AIProvider = 'claude' | 'openai' | 'gemini';

export interface AIProviderConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

export interface NodeCodeContext {
  currentCode: string;
  modulePath: string;
  nodeType: string;
  connectedInputs: PortInfo[];
  connectedOutputs: PortInfo[];
  props: PropInfo[];
}

export interface PortInfo {
  name: string;
  type: string;
  connected: boolean;
}

export interface PropInfo {
  name: string;
  type: string;
  value: any;
}

export interface GenerationRequest {
  prompt: string;
  context: NodeCodeContext;
  provider: AIProvider;
  stream?: boolean;
}

export interface GenerationResult {
  code: string;
  provider: AIProvider;
  model: string;
  tokensUsed?: number;
}

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onComplete: (result: GenerationResult) => void;
  onError: (error: Error) => void;
}

export interface AIProviderInterface {
  name: AIProvider;
  displayName: string;
  isConfigured: () => boolean;
  generate: (request: GenerationRequest) => Promise<GenerationResult>;
  generateStream: (request: GenerationRequest, callbacks: StreamCallbacks) => Promise<void>;
}
