import { remap } from '../../../../packages/runtime/src/builtins/core/remap.js';
import { Node } from '../../Node.js';
import type { Graph } from '../../Graph.js';

export const nodeMetadata = {
  type: 'Remap',
  name: 'Remap',
  icon: 'ArrowRightLeft',
  description: 'Map a number from one range into another',
  category: 'utility'
};

export class RemapNode extends Node {
  constructor(id: string, graph: Graph) {
    super(id, 'Remap', graph);
  }

  protected setup(): void {
    const value = this.in('value', 0, { type: 'float' });
    const inMin = this.in('inMin', 0, { type: 'float' });
    const inMax = this.in('inMax', 1, { type: 'float' });
    const outMin = this.in('outMin', 0, { type: 'float' });
    const outMax = this.in('outMax', 1, { type: 'float' });
    const result = this.out<number>('result');
    this.addParm('clamp', { value: false, type: 'boolean', displayName: 'Clamp' });

    const update = () => result.setValue(remap(
      value.value,
      inMin.value,
      inMax.value,
      outMin.value,
      outMax.value,
      this.props.clamp.value,
    ));
    for (const input of [value, inMin, inMax, outMin, outMax]) input.onChange = update;
    this.watchProp('clamp', update);
    this.onUpdate = update;
    this.onReady = update;
  }
}
