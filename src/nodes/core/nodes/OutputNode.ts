/**
 * OutputNode - Explicitly defines a subnet's output
 * Overrides the cooking node when present
 */

import { Node } from '../../Node.js';
import type { Graph } from '../../Graph.js';
import type { DataType } from '@/types/node.types';
import { CORE_TYPES, isCoreType } from '@/types/coreTypes';

const TYPE_CHOICES = CORE_TYPES.map(type => ({ value: type, label: type }));

export const nodeMetadata = {
  type: 'Output',
  name: 'Output',
  icon: 'LogOut',
  description: 'Defines the output of a subnet',
  category: 'network'
};

export class OutputNode extends Node {
  constructor(id: string, graph: Graph) {
    super(id, 'Output', graph);
  }

  protected setup(): void {
    // Input receives the value to output from the subnet
    this.in('input', null);

    // Output index - for multiple outputs from a subnet
    this.addParm('outputIndex', {
      value: 0,
      type: 'int',
      params: { min: 0, step: 1 },
      displayName: 'Output Index'
    });

    this.addParm('outputName', {
      value: '',
      type: 'text',
      displayName: 'Output Name'
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
    this.watchProp('outputIndex', syncParent);
    this.watchProp('outputName', syncParent);
    this.watchProp('dataType', () => {
      if (this.inputs[0]) this.inputs[0].dataType = this.dataType;
      syncParent();
    });

    this.onUpdate = () => this.update();
    this.onReady = () => this.update();
  }

  /**
   * Get the output index this node represents
   */
  get outputIndex(): number {
    return this.props.outputIndex?.value ?? 0;
  }

  get outputName(): string {
    return this.props.outputName?.value ?? '';
  }

  get dataType(): DataType {
    const value = this.props.dataType?.value;
    return typeof value === 'string' && isCoreType(value) ? value : 'any';
  }

  private update(): void {
    // Pass through the input value and preview
    const input = this.inputs[0];
    if (input) {
      if (this.isPreviewValue(input.value)) {
        this.preview = input.value;
      } else {
        this.preview = null;
      }
    }
  }
}
