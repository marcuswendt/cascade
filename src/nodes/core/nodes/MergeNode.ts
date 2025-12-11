/**
 * MergeNode - combines multiple inputs into an array
 * Connect multiple inputs to create an array of values
 */

import { Computation } from '@/core/engine/Node';
import type { Graph } from '@/core/engine/Graph';
import type { OutputPort } from '@/types/node.types';

export class MergeNode extends Computation {
  private output!: OutputPort<any[]>;

  constructor(id: string, graph: Graph) {
    super(id, 'Merge', graph);
  }

  protected setup(): void {
    // Define variadic inputs - automatically grows as connections are made
    this.defineVariadicInput('input', {
      minCount: 2,
      defaultValue: null
    });

    this.output = this.out('output');

    // Append mode - when first input is an array, append others to it
    this.defineProp('append', {
      value: false,
      type: 'boolean',
      displayName: 'Append Mode',
      hidden: () => {
        const inputs = this.getVariadicInputs('input');
        return !Array.isArray(inputs[0]?.value);
      }
    });

    this.watchProp('append', () => this.update());

    this.onUpdate = () => this.update();
    this.onReady = () => this.update();
  }

  private update(): void {
    const inputs = this.getVariadicInputs('input');

    // Collect non-null values
    const values = inputs
      .filter(p => p.value !== null)
      .map(p => p.value);

    // Handle append mode
    const appendMode = this.props.append.value;
    if (appendMode && values.length > 0 && Array.isArray(values[0])) {
      // Append subsequent values to the first array
      const result = [...values[0], ...values.slice(1)];
      this.output.setValue(result);
    } else {
      this.output.setValue(values);
    }

    // Set preview to first visual element if available
    this.preview = null;
    for (const val of values) {
      if (val instanceof HTMLCanvasElement || val instanceof HTMLImageElement) {
        this.preview = val;
        break;
      }
    }
  }
}
