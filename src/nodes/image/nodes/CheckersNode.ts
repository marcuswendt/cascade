/**
 * CheckersNode - generates a checkerboard pattern as ImageBuffer
 */

import { ImageNodeBase, ImageBuffer } from '../ImageNodeBase';
import type { Graph } from '@/nodes/Graph';
import type { OutputPort } from '@/types/node.types';

export class CheckersNode extends ImageNodeBase {
  private output!: OutputPort<ImageBuffer>;

  constructor(id: string, graph: Graph) {
    super(id, 'Checkers', graph);
  }

  protected setup(): void {
    this.addParm('color1', {
      value: { r: 1.0, g: 1.0, b: 1.0 },
      type: 'color',
      displayName: 'Color 1',
      onChange: () => this.requestCook()
    });

    this.addParm('color2', {
      value: { r: 0.0, g: 0.0, b: 0.0 },
      type: 'color',
      displayName: 'Color 2',
      onChange: () => this.requestCook()
    });

    this.addParm('mode', {
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

    this.addParm('size', {
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

    this.addParm('divisions', {
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

    this.addParm('centered', {
      value: false,
      type: 'boolean',
      displayName: 'Centered',
      onChange: () => this.requestCook()
    });

    this.addResolutionParm();

    this.output = this.out('image');

    // Watch all props to ensure updates trigger re-render
    this.watchProp('color1', () => this.requestCook());
    this.watchProp('color2', () => this.requestCook());
    this.watchProp('mode', () => this.requestCook());
    this.watchProp('size', () => this.requestCook());
    this.watchProp('divisions', () => this.requestCook());
    this.watchProp('centered', () => this.requestCook());

    this.onReady = () => this.requestCook();
  }

  protected render(): void {
    const [width, height] = this.getResolution();
    const mode = this.props.mode.value;
    const color1 = this.normalizeColor(this.props.color1.value);
    const color2 = this.normalizeColor(this.props.color2.value);
    const centered = this.props.centered.value;

    let checkerSize: number;
    if (mode === 'size') {
      checkerSize = this.props.size.value;
    } else {
      checkerSize = width / this.props.divisions.value;
    }

    // Calculate offset to center the pattern
    let offsetX = 0;
    let offsetY = 0;
    if (centered) {
      // Offset so that the center of the image is at the center of a checker cell
      offsetX = (width / 2) % checkerSize - checkerSize / 2;
      offsetY = (height / 2) % checkerSize - checkerSize / 2;
    }

    const buffer = this.createRGBA(width, height);
    const r = buffer.r();
    const g = buffer.g();
    const b = buffer.b();
    const a = buffer.a();

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const isEven = (Math.floor((x - offsetX) / checkerSize) + Math.floor((y - offsetY) / checkerSize)) % 2 === 0;
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
