/**
 * ColorNode - creates a solid color canvas
 */

import { LensNode } from '../LensNode';
import type { Graph } from '@/nodes/Graph';
import type { OutputPort } from '@/types/node.types';

export class ColorNode extends LensNode {
  private output!: OutputPort<HTMLCanvasElement>;

  constructor(id: string, graph: Graph) {
    super(id, 'Color', graph);
  }

  protected setup(): void {
    this.defineProp('color', {
      value: { r: 1.0, g: 1.0, b: 1.0 },
      type: 'color',
      displayName: 'Color'
    });

    this.defineProp('resolution', {
      value: [512, 512],
      params: {
        min: [1, 1],
        max: [4096, 4096],
        integer: true
      },
      displayName: 'Resolution'
    });

    this.output = this.out('image');

    this.watchProp('color', () => this.render());
    this.watchProp('resolution', () => this.render());

    this.onReady = () => this.render();
  }

  private render(): void {
    const [width, height] = this.props.resolution.value;
    const canvas = this.createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    if (ctx) {
      ctx.fillStyle = this.colorToCss(this.props.color.value);
      ctx.fillRect(0, 0, width, height);
    }

    this.setOutputAndPreview(this.output, canvas);
  }
}
