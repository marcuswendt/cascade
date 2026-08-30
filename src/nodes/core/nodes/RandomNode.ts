import { randomFromSeed } from '../../../../packages/runtime/src/builtins/core/random.js';
import { Node } from '../../Node.js';
import type { Graph } from '../../Graph.js';

export const nodeMetadata = {
  type: 'Random',
  name: 'Random',
  icon: 'Dice5',
  description: 'Generate a deterministic value from an explicit seed',
  category: 'utility'
};

export class RandomNode extends Node {
  constructor(id: string, graph: Graph) {
    super(id, 'Random', graph);
  }

  protected setup(): void {
    const seed = this.in('seed', 0, { type: 'int' });
    const sample = this.in('sample', 0, { type: 'int' });
    const value = this.out<number>('value');
    const update = () => value.setValue(randomFromSeed(seed.value, sample.value));
    seed.onChange = update;
    sample.onChange = update;
    this.onUpdate = update;
    this.onReady = update;
  }
}
