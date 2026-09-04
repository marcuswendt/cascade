/**
 * InputNode - Represents an external input to a subnet
 * Auto-created when wiring into a subnet, or manually for documentation
 */

import { Node } from '../../Node.js';
import type { Graph } from '../../Graph.js';
import type { DataType, OutputPort } from '@/types/node.types';
import { CORE_TYPES, isCoreType } from '@/types/coreTypes';

const TYPE_CHOICES = CORE_TYPES.map(type => ({ value: type, label: type }));

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
    this.addParm('inputIndex', {
      value: 0,
      type: 'int',
      params: { min: 0, step: 1 },
      displayName: 'Input Index'
    });

    // Optional name for documentation
    this.addParm('inputName', {
      value: '',
      type: 'text',
      displayName: 'Input Name'
    });

    this.addParm('dataType', {
      value: 'any',
      type: 'select',
      params: { options: TYPE_CHOICES },
      displayName: 'Data Type'
    });

    // Watch for index changes to trigger parent port sync
    const syncParent = () => {
      if (this.parent && (this.parent as any).syncPorts) {
        (this.parent as any).syncPorts();
      }
      this.update();
    };
    this.watchProp('inputIndex', syncParent);
    this.watchProp('inputName', syncParent);
    this.watchProp('dataType', () => {
      this.output.dataType = this.dataType;
      syncParent();
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

  get dataType(): DataType {
    const value = this.props.dataType?.value;
    return typeof value === 'string' && isCoreType(value) ? value : 'any';
  }

  private update(): void {
    // Get value from parent subnet's corresponding input
    if (this.parent && this.parent.inputs.length > 0) {
      const idx = this.inputIndex;
      const parentInput = this.parent.inputs[idx];
      if (parentInput) {
        this.output.setValue(parentInput.value);

        // Pass through preview
        if (this.isPreviewValue(parentInput.value)) {
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
