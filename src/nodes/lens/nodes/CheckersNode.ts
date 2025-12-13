/**
 * CheckersNode - generates a checkerboard pattern as ImageBuffer
 */

import { LensNode, ImageBuffer } from '../LensNode';
import type { Graph } from '@/nodes/Graph';
import type { OutputPort } from '@/types/node.types';

export class CheckersNode extends LensNode {
  private output!: OutputPort<ImageBuffer>;

  constructor(id: string, graph: Graph) {
    super(id, 'Checkers', graph);
  }

  protected setup(): void {
    this.defineProp('color1', {
      value: { r: 1.0, g: 1.0, b: 1.0 },
      type: 'color',
      displayName: 'Color 1',
      onChange: () => this.requestCook()
    });

    this.defineProp('color2', {
      value: { r: 0.0, g: 0.0, b: 0.0 },
      type: 'color',
      displayName: 'Color 2',
      onChange: () => this.requestCook()
    });

    this.defineProp('mode', {
      value: 'size',
      params: {
        options: [
          { value: 'size', label: 'Size' },
          { value: 'divisions', label: 'Divisions' }
        ]
      },
      displayName: 'Mode',
      onChange: () => this.requestCook()
    });

    this.defineProp('size', {
      value: 32,
      params: {
        min: 1,
        max: 512,
        step: 0.1
      },
      displayName: 'Size',
      hidden: () => this.props.mode.value !== 'size',
      onChange: () => this.requestCook()
    });

    this.defineProp('divisions', {
      value: 16,
      params: {
        min: 1,
        max: 512,
        step: 1,
        integer: true
      },
      displayName: 'Divisions',
      hidden: () => this.props.mode.value !== 'divisions',
      onChange: () => this.requestCook()
    });

    this.defineProp('resolution', {
      value: [512, 512],
      params: {
        min: [1, 1],
        max: [4096, 4096],
        integer: true
      },
      displayName: 'Resolution',
      onChange: () => this.requestCook()
    });

    this.output = this.out('image');

    this.onReady = () => this.requestCook();
  }

  protected render(): void {
    const [width, height] = this.props.resolution.value;
    const mode = this.props.mode.value;
    const color1 = this.normalizeColor(this.props.color1.value);
    const color2 = this.normalizeColor(this.props.color2.value);

    let checkerSize: number;
    if (mode === 'size') {
      checkerSize = this.props.size.value;
    } else {
      checkerSize = width / this.props.divisions.value;
    }

    const buffer = this.createRGBA(width, height);
    const r = buffer.r();
    const g = buffer.g();
    const b = buffer.b();
    const a = buffer.a();

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const isEven = (Math.floor(x / checkerSize) + Math.floor(y / checkerSize)) % 2 === 0;
        const color = isEven ? color1 : color2;

        r[idx] = color.r;
        g[idx] = color.g;
        b[idx] = color.b;
        a[idx] = color.a;
      }
    }

    buffer.markDirty();
    this.setOutput(this.output, buffer);
  }
}
