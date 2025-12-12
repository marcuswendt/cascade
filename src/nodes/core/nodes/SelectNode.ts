/**
 * SelectNode - routes one of multiple inputs to output based on index
 * Connect multiple inputs and use the index parameter to select which one passes through
 */

import { Node } from '@/core/engine/Node';
import type { Graph } from '@/core/engine/Graph';
import type { OutputPort } from '@/types/node.types';

export class SelectNode extends Node {
  private output!: OutputPort<any>;

  constructor(id: string, graph: Graph) {
    super(id, 'Select', graph);
  }

  protected setup(): void {
    // Define variadic inputs - automatically grows as connections are made
    this.defineVariadicInput('input', {
      minCount: 2,
      defaultValue: null
    });

    this.output = this.out('output');

    // Index property - selects which input to route to output
    this.defineProp('index', {
      value: 0,
      type: 'int',
      params: {
        min: 0,
        max: 1,
        step: 1
      },
      displayName: 'Index'
    });

    this.watchProp('index', () => this.update());

    this.onUpdate = () => this.update();
    this.onReady = () => this.update();
  }

  private update(): void {
    const inputs = this.getVariadicInputs('input');

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
