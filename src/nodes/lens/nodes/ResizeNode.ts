/**
 * ResizeNode - scales or resizes an image
 */

import { LensNode, type ImageInput } from '../LensNode';
import type { Graph } from '@/core/engine/Graph';
import type { InputPort, OutputPort } from '@/types/node.types';

export class ResizeNode extends LensNode {
  private image!: InputPort<ImageInput>;
  private output!: OutputPort<HTMLCanvasElement>;

  constructor(id: string, graph: Graph) {
    super(id, 'Resize', graph);
  }

  protected setup(): void {
    this.image = this.in<ImageInput>('image', null);

    this.defineProp('mode', {
      value: 'scale',
      params: {
        options: [
          { value: 'scale', label: 'Scale' },
          { value: 'fixed', label: 'Fixed' }
        ]
      },
      displayName: 'Mode',
      onChange: () => this.render()
    });

    this.defineProp('scale', {
      value: 1.0,
      params: {
        min: 0.1,
        max: 10.0,
        step: 0.1
      },
      displayName: 'Scale',
      hidden: () => this.props.mode.value !== 'scale',
      onChange: () => this.render()
    });

    this.defineProp('width', {
      value: 512,
      params: {
        min: 1,
        max: 4096,
        step: 1
      },
      displayName: 'Width',
      hidden: () => this.props.mode.value !== 'fixed',
      onChange: () => this.render()
    });

    this.defineProp('height', {
      value: 512,
      params: {
        min: 1,
        max: 4096,
        step: 1
      },
      displayName: 'Height',
      hidden: () => this.props.mode.value !== 'fixed',
      onChange: () => this.render()
    });

    this.output = this.out('image');

    this.image.onChange = () => this.render();

    this.onReady = () => this.render();
  }

  private render(): void {
    if (!this.image.value) {
      return;
    }

    const img = this.image.value;
    const { width: srcWidth, height: srcHeight } = this.getImageSize(img);

    if (srcWidth === 0 || srcHeight === 0) {
      return;
    }

    let newWidth: number, newHeight: number;

    if (this.props.mode.value === 'scale') {
      const scale = this.props.scale.value;
      newWidth = Math.round(srcWidth * scale);
      newHeight = Math.round(srcHeight * scale);
    } else {
      newWidth = this.props.width.value;
      newHeight = this.props.height.value;
    }

    const canvas = this.createCanvas(newWidth, newHeight);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(img, 0, 0, newWidth, newHeight);

    this.setOutputAndPreview(this.output, canvas);
  }
}
