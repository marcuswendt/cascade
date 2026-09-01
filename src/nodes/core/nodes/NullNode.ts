import { Node } from '../../Node.js';
import type { Graph } from '../../Graph.js';

export const nodeMetadata = {
  type: 'Null',
  name: 'Null',
  icon: 'Circle',
  description: 'Pass its input through unchanged',
  category: 'routing',
};

export class NullNode extends Node {
  constructor(id: string, graph: Graph) {
    super(id, 'Null', graph);
  }

  protected setup(): void {
    const input = this.in('input', null, { type: 'any' });
    const output = this.out('output');
    const update = () => output.setValue(input.value);
    input.onChange = update;
    this.onUpdate = update;
    this.onReady = update;
  }
}
