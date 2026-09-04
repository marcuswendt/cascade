/**
 * ColorNode - creates a solid color ImageBuffer
 */

import { ImageNodeBase, ImageBuffer } from '../ImageNodeBase';
import type { Graph } from '@/nodes/Graph';
import type { OutputPort } from '@/types/node.types';
import { normalizeColor } from '@/utils/colorUtils';

export class ColorNode extends ImageNodeBase {
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
    const color = normalizeColor(this.props.color.value);

    const buffer = ImageBuffer.solid(width, height, color);
    this.setOutput(this.output, buffer);
  }
}
