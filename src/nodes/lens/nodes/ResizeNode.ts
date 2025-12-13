/**
 * ResizeNode - scales or resizes an ImageBuffer with bilinear interpolation
 */

import { LensNode, ImageBuffer, type ImageInput } from '../LensNode';
import type { Graph } from '@/nodes/Graph';
import type { InputPort, OutputPort } from '@/types/node.types';

export class ResizeNode extends LensNode {
  private image!: InputPort<ImageInput>;
  private output!: OutputPort<ImageBuffer>;

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
      onChange: () => this.requestCook()
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
      onChange: () => this.requestCook()
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
      onChange: () => this.requestCook()
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
      onChange: () => this.requestCook()
    });

    this.output = this.out('image');

    this.image.onChange = () => this.requestCook();

    this.onReady = () => this.requestCook();
  }

  private resizeBuffer(source: ImageBuffer, newWidth: number, newHeight: number): ImageBuffer {
    const result = ImageBuffer.rgba(newWidth, newHeight);
    const scaleX = source.width / newWidth;
    const scaleY = source.height / newHeight;

    // Process each channel using bilinear interpolation
    for (let c = 0; c < Math.min(source.channelCount, 4); c++) {
      const dstChannel = result.channels[c];

      for (let y = 0; y < newHeight; y++) {
        for (let x = 0; x < newWidth; x++) {
          const srcX = x * scaleX;
          const srcY = y * scaleY;
          dstChannel[y * newWidth + x] = source.sample(srcX, srcY, c);
        }
      }
    }

    // Fill alpha if source doesn't have it
    if (source.channelCount < 4) {
      result.fill(3, 1);
    }

    return result;
  }

  protected render(): void {
    const buffer = this.toImageBuffer(this.image.value);
    if (!buffer) {
      return;
    }

    let newWidth: number, newHeight: number;

    if (this.props.mode.value === 'scale') {
      const scale = this.props.scale.value;
      newWidth = Math.round(buffer.width * scale);
      newHeight = Math.round(buffer.height * scale);
    } else {
      newWidth = this.props.width.value;
      newHeight = this.props.height.value;
    }

    const resized = this.resizeBuffer(buffer, newWidth, newHeight);
    this.setOutput(this.output, resized);
  }
}
