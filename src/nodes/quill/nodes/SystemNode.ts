/**
 * SystemNode - System prompt for Chat nodes
 *
 * Outputs a system prompt that can be connected to one or more Chat nodes.
 * Great for reusing personas, instructions, or formatting guidelines.
 */

import { QuillNode } from '../QuillNode';
import type { Graph } from '../../Graph';

export const nodeMetadata = {
  type: 'System',
  name: 'System',
  icon: 'Settings',
  description: 'System prompt for Chat nodes',
  category: 'ai'
};

/**
 * SystemNode - Provides system prompts for Chat conversations
 */
export class SystemNode extends QuillNode {
  private promptValue: string = '';

  constructor(id: string, graph: Graph) {
    super(id, 'System', graph);
  }

  protected setup(): void {
    // Setup the standard text output
    this.setupTextOutput();

    // Prompt parameter with textarea
    this.addParm('prompt', {
      value: '',
      type: 'textarea',
      displayName: 'System Prompt',
      onChange: () => this.updateOutput()
    });

    // Preset templates
    this.addParm('preset', {
      value: 'custom',
      type: 'select',
      params: {
        options: [
          { value: 'custom', label: 'Custom' },
          { value: 'assistant', label: 'Helpful Assistant' },
          { value: 'creative', label: 'Creative Writer' },
          { value: 'technical', label: 'Technical Expert' },
          { value: 'concise', label: 'Concise Responder' },
          { value: 'socratic', label: 'Socratic Teacher' }
        ]
      },
      displayName: 'Preset',
      onChange: () => this.applyPreset()
    });

    // Initialize output
    this.onReady = () => this.updateOutput();
  }

  /**
   * Apply preset template
   */
  private applyPreset(): void {
    const preset = this.props.preset?.value;
    if (!preset || preset === 'custom') return;

    const templates: Record<string, string> = {
      assistant:
        'You are a helpful, harmless, and honest AI assistant. Answer questions clearly and accurately. If you are uncertain, say so. If you cannot help with something, explain why.',

      creative:
        'You are a creative writer with a vivid imagination. Generate engaging, original content with rich descriptions and compelling narratives. Explore unique perspectives and surprising connections.',

      technical:
        'You are a technical expert. Provide accurate, detailed explanations of technical concepts. Use precise terminology, include relevant examples, and structure your responses for clarity. When appropriate, include code examples.',

      concise:
        'You are a concise responder. Provide brief, direct answers without unnecessary elaboration. Get to the point quickly while remaining accurate and helpful.',

      socratic:
        'You are a Socratic teacher. Rather than giving direct answers, guide learning through thoughtful questions. Help the user discover insights on their own. Encourage critical thinking and deeper exploration.'
    };

    const template = templates[preset];
    if (template && this.props.prompt) {
      this.props.prompt.value = template;
      this.promptValue = template;
      this.updateOutput();
    }
  }

  /**
   * Update the text output
   */
  private updateOutput(): void {
    const prompt = this.props.prompt?.value ?? '';
    this.promptValue = prompt;
    this.setTextOutput(prompt);
  }

  /**
   * Get current prompt text
   */
  getPrompt(): string {
    return this.promptValue;
  }

  // =========================================================================
  // Serialization
  // =========================================================================

  serialize(): Record<string, unknown> {
    return {
      prompt: this.promptValue
    };
  }

  deserialize(data: Record<string, unknown>): void {
    if (typeof data.prompt === 'string') {
      this.promptValue = data.prompt;
      if (this.props.prompt) {
        this.props.prompt.value = data.prompt;
      }
    }
    // Set preset to custom if we have custom content
    if (this.props.preset) {
      this.props.preset.value = 'custom';
    }
    this.updateOutput();
  }
}
