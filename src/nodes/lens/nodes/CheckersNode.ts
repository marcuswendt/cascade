/**
 * CheckersNode - generates a checkerboard pattern
 */

import { LensNode } from '../LensNode';
import type { Graph } from '@/nodes/Graph';
import type { OutputPort } from '@/types/node.types';

export class CheckersNode extends LensNode {
  private output!: OutputPort<HTMLCanvasElement>;

  constructor(id: string, graph: Graph) {
    super(id, 'Checkers', graph);
  }

  protected setup(): void {
    this.defineProp('color1', {
      value: { r: 1.0, g: 1.0, b: 1.0 },
      type: 'color',
      displayName: 'Color 1',
      onChange: () => this.render()
    });

    this.defineProp('color2', {
      value: { r: 0.0, g: 0.0, b: 0.0 },
      type: 'color',
      displayName: 'Color 2',
      onChange: () => this.render()
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
      onChange: () => this.render()
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
      onChange: () => this.render()
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
      onChange: () => this.render()
    });

    this.defineProp('resolution', {
      value: [512, 512],
      params: {
        min: [1, 1],
        max: [4096, 4096],
        integer: true
      },
      displayName: 'Resolution',
      onChange: () => this.render()
    });

    this.output = this.out('image');

    this.onReady = () => this.render();
  }

  private render(): void {
    const [width, height] = this.props.resolution.value;
    const mode = this.props.mode.value;
    const color1 = this.props.color1.value;
    const color2 = this.props.color2.value;

    // Calculate checker size based on mode
    let checkerSize: number;
    if (mode === 'size') {
      checkerSize = this.props.size.value;
    } else {
      // divisions mode: divide width by divisions
      checkerSize = width / this.props.divisions.value;
    }

    const canvas = this.createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw checkerboard pattern
    for (let y = 0; y < height; y += checkerSize) {
      for (let x = 0; x < width; x += checkerSize) {
        const isEven = Math.floor(x / checkerSize) + Math.floor(y / checkerSize);
        ctx.fillStyle = isEven % 2 === 0 ? this.colorToCss(color1) : this.colorToCss(color2);
        ctx.fillRect(x, y, checkerSize, checkerSize);
      }
    }

    this.setOutputAndPreview(this.output, canvas);
  }
}
