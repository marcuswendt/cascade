/**
 * BlurNode - applies Gaussian blur to an ImageBuffer
 * Uses separable convolution for efficiency
 */

import { LensNode, ImageBuffer, type ImageInput } from '../LensNode';
import type { Graph } from '@/nodes/Graph';
import type { InputPort, OutputPort } from '@/types/node.types';

export class BlurNode extends LensNode {
  private image!: InputPort<ImageInput>;
  private output!: OutputPort<ImageBuffer>;

  constructor(id: string, graph: Graph) {
    super(id, 'Blur', graph);
  }

  protected setup(): void {
    this.image = this.in<ImageInput>('image', null);

    this.defineProp('radius', {
      value: 5.0,
      params: {
        min: 0.0,
        max: 100.0,
        step: 0.1
      },
      displayName: 'Radius',
      onChange: () => this.requestCook()
    });

    this.defineProp('wrapEdges', {
      value: false,
      type: 'boolean',
      displayName: 'Wrap Edges',
      onChange: () => this.requestCook()
    });

    this.output = this.out('image');

    this.image.onChange = () => this.requestCook();

    this.onReady = () => this.requestCook();
  }

  private gaussianBlur(source: ImageBuffer, radius: number, wrapEdges: boolean): ImageBuffer {
    if (radius <= 0) {
      return source.clone();
    }

    const { width, height } = source;
    const result = source.emptyClone();

    // Create Gaussian kernel using typed array
    const kernelSize = Math.ceil(radius * 3) * 2 + 1;
    const kernel = new Float32Array(kernelSize);
    const sigma = radius / 3;
    const twoSigmaSq = 2 * sigma * sigma;
    let sum = 0;

    const halfKernel = (kernelSize - 1) >> 1; // Fast integer divide by 2

    for (let i = 0; i < kernelSize; i++) {
      const x = i - halfKernel;
      const value = Math.exp(-(x * x) / twoSigmaSq);
      kernel[i] = value;
      sum += value;
    }

    // Normalize kernel
    const invSum = 1 / sum;
    for (let i = 0; i < kernelSize; i++) {
      kernel[i] *= invSum;
    }

    // Inline wrapCoord functions to avoid function call overhead
    const wrapX = wrapEdges
      ? (coord: number) => ((coord % width) + width) % width
      : (coord: number) => coord < 0 ? 0 : coord >= width ? width - 1 : coord;
    const wrapY = wrapEdges
      ? (coord: number) => ((coord % height) + height) % height
      : (coord: number) => coord < 0 ? 0 : coord >= height ? height - 1 : coord;

    // Process each channel separately (benefit of planar format)
    for (let c = 0; c < source.channelCount; c++) {
      const srcChannel = source.channels[c];
      const dstChannel = result.channels[c];

      // Temp buffer for horizontal pass
      const temp = new Float32Array(width * height);

      // Horizontal blur - process row by row
      for (let y = 0; y < height; y++) {
        const rowOffset = y * width;
        for (let x = 0; x < width; x++) {
          let acc = 0;
          for (let k = 0; k < kernelSize; k++) {
            const px = wrapX(x + k - halfKernel);
            acc += srcChannel[rowOffset + px] * kernel[k];
          }
          temp[rowOffset + x] = acc;
        }
      }

      // Vertical blur - use column-wise access pattern
      for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
          let acc = 0;
          for (let k = 0; k < kernelSize; k++) {
            const py = wrapY(y + k - halfKernel);
            acc += temp[py * width + x] * kernel[k];
          }
          dstChannel[y * width + x] = acc;
        }
      }
    }

    return result;
  }

  protected render(): void {
    const buffer = this.toImageBuffer(this.image.value);
    if (!buffer) {
      return;
    }

    const radius = this.props.radius.value;
    const wrapEdges = this.props.wrapEdges.value;
    const blurred = this.gaussianBlur(buffer, radius, wrapEdges);

    this.setOutput(this.output, blurred);
  }
}
