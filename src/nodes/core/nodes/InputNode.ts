/**
 * InputNode - Represents an external input to a subnet
 * Auto-created when wiring into a subnet, or manually for documentation
 */

import { Node } from '../../Node.js';
import type { Graph } from '../../Graph.js';
import type { OutputPort } from '@/types/node.types';

export const nodeMetadata = {
  type: 'Input',
  name: 'Input',
  icon: 'LogIn',
  description: 'Represents an external input to a subnet',
  category: 'network'
};

export class InputNode extends Node {
  private output!: OutputPort<any>;

  constructor(id: string, graph: Graph) {
    super(id, 'Input', graph);
  }

  protected setup(): void {
    // Output passes through the external input value
    this.output = this.out('output');

    // Input index - which external input this represents
    this.defineProp('inputIndex', {
      value: 0,
      type: 'int',
      params: { min: 0, step: 1 },
      displayName: 'Input Index'
    });

    // Optional name for documentation
    this.defineProp('inputName', {
      value: '',
      type: 'text',
      displayName: 'Input Name'
    });

    // Watch for index changes to trigger parent port sync
    this.watchProp('inputIndex', () => {
      if (this.parent && (this.parent as any).syncPorts) {
        (this.parent as any).syncPorts();
      }
      this.update();
    });

    this.onUpdate = () => this.update();
    this.onReady = () => this.update();
  }

  /**
   * Get the input index this node represents
   */
  get inputIndex(): number {
    return this.props.inputIndex?.value ?? 0;
  }

  /**
   * Get the input name (for documentation)
   */
  get inputName(): string {
    return this.props.inputName?.value ?? '';
  }

  private update(): void {
    // Get value from parent subnet's corresponding input
    if (this.parent && this.parent.inputs.length > 0) {
      const idx = this.inputIndex;
      const parentInput = this.parent.inputs[idx];
      if (parentInput) {
        this.output.setValue(parentInput.value);

        // Pass through preview
        if (parentInput.value instanceof HTMLCanvasElement ||
            parentInput.value instanceof HTMLImageElement) {
          this.preview = parentInput.value;
        } else {
          this.preview = null;
        }
        return;
      }
    }

    this.output.setValue(null);
    this.preview = null;
  }
}
