/**
 * SwitchNode - routes one of multiple inputs to output based on index
 * Connect multiple inputs and use the index parameter to select which one passes through
 */

import { Node } from '../../Node.js';
import type { Graph } from '../../Graph.js';
import type { OutputPort } from '@/types/node.types';

export const nodeMetadata = {
  type: 'Switch',
  name: 'Switch',
  icon: 'GitBranch',
  description: 'Switch between multiple inputs by index',
  category: 'routing'
};

export class SwitchNode extends Node {
  private output!: OutputPort<any>;

  constructor(id: string, graph: Graph) {
    super(id, 'Switch', graph);
  }

  /**
   * Get the index of the currently active input
   * Used by connection rendering to grey out inactive wires
   */
  get activeInputIndex(): number {
    const inputs = this.getVariadicInputs();
    return Math.min(this.props.index?.value ?? 0, inputs.length - 1);
  }

  /**
   * Check if a specific input port is active (for connection coloring)
   */
  isInputActive(portId: string): boolean {
    const inputs = this.getVariadicInputs();
    const activeIdx = this.activeInputIndex;
    const portIndex = inputs.findIndex(p => p.id === portId);
    return portIndex === activeIdx;
  }

  protected setup(): void {
    this.setVariadic();
    this.output = this.out('output');

    this.defineProp('index', {
      value: 0,
      type: 'int',
      params: { min: 0, max: 0, step: 1 },
      displayName: 'Index'
    });

    this.watchProp('index', () => this.update());

    this.onUpdate = () => this.update();
    this.onReady = () => this.update();
  }

  private update(): void {
    const inputs = this.getVariadicInputs();

    // Update index max based on connected inputs (triggers UI reactivity)
    const connectedCount = inputs.filter(p => p.connections.length > 0).length;
    this.updatePropParams('index', { max: Math.max(0, connectedCount - 1) });

    const idx = Math.min(this.props.index.value, inputs.length - 1);
    const selectedInput = inputs[idx];

    if (selectedInput) {
      this.output.setValue(selectedInput.value);

      // Use input's preview if it's a canvas/image
      if (selectedInput.value instanceof HTMLCanvasElement ||
          selectedInput.value instanceof HTMLImageElement) {
        this.preview = selectedInput.value;
      } else {
        this.preview = null;
      }
    } else {
      this.output.setValue(null);
      this.preview = null;
    }
  }
}
