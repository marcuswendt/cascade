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

// System prompt for code generation
export const SYSTEM_PROMPT = `You are an expert TypeScript developer helping to write node code for Cascade, a visual programming framework.

## Cascade Node Structure

Each node is a TypeScript function that:
1. Defines input ports using \`node.in(name, defaultValue, options)\`
2. Defines output ports using \`node.out(name)\`
3. Defines props (UI controls) using \`node.defineProp(name, config)\`
4. Implements logic to process inputs and set outputs

## Available APIs

\`\`\`typescript
// Input port - receives data from connected nodes
const input = node.in<T>('name', defaultValue, { type: 'number' | 'color' | 'any' });

// Output port - sends data to connected nodes
const output = node.out<T>('name');
output.setValue(value);  // Set output value
output.trigger();        // Trigger connected nodes

// Props - UI controls shown in Inspector
node.defineProp('propName', {
  value: initialValue,
  type: 'slider' | 'number' | 'color' | 'select' | 'text' | 'boolean' | 'vec2' | 'vec3',
  params: { min: 0, max: 100, step: 1, options: [...] },
  onChange: (prop, node) => { /* react to changes */ }
});

// Lifecycle hooks
node.onReady = () => { /* called after initialization */ };
node.onDestroy = () => { /* cleanup */ };

// Utilities
node.log(...args);                    // Log to console
await node.require('package-name');   // Load NPM package from esm.sh
\`\`\`

## Guidelines

1. Write clean, efficient TypeScript code
2. Use meaningful variable names
3. Handle edge cases (null/undefined inputs)
4. Add brief comments for complex logic
5. Use async/await for asynchronous operations
6. Canvas operations should use OffscreenCanvas when possible
7. Always call output.setValue() to propagate results

## Response Format

Return ONLY the node code, no markdown formatting or explanations. The code should be ready to execute directly.
`;
