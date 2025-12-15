/**
 * ColorNode - creates a solid color ImageBuffer
 */

import { LensNode, ImageBuffer } from '../LensNode';
import type { Graph } from '@/nodes/Graph';
import type { OutputPort } from '@/types/node.types';

export class ColorNode extends LensNode {
  private output!: OutputPort<ImageBuffer>;

  constructor(id: string, graph: Graph) {
    super(id, 'Color', graph);
  }

  protected setup(): void {
    this.addParm('color', {
      value: { r: 1.0, g: 1.0, b: 1.0 },
      type: 'color',
      displayName: 'Color'
    });

    this.addResolutionParm();

    this.output = this.out('image');

    this.watchProp('color', () => this.requestCook());

    this.onReady = () => this.requestCook();
  }

  protected render(): void {
    const [width, height] = this.getResolution();
    const color = this.normalizeColor(this.props.color.value);

    const buffer = this.createSolid(width, height, color);
    this.setOutput(this.output, buffer);
  }
}
