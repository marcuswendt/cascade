/**
 * BlurNode - applies Gaussian blur to an image
 */

import { LensNode, type ImageInput } from '../LensNode';
import type { Graph } from '@/nodes/Graph';
import type { InputPort, OutputPort } from '@/types/node.types';

export class BlurNode extends LensNode {
  private image!: InputPort<ImageInput>;
  private output!: OutputPort<HTMLCanvasElement>;

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
      onChange: () => this.render()
    });

    this.defineProp('wrapEdges', {
      value: false,
      type: 'boolean',
      displayName: 'Wrap Edges',
      onChange: () => this.render()
    });

    this.output = this.out('image');

    this.image.onChange = () => this.render();

    this.watchProp('radius', () => this.render());
    this.watchProp('wrapEdges', () => this.render());

    this.onReady = () => this.render();
  }

  private gaussianBlur(imageData: ImageData, radius: number, wrapEdges: boolean): ImageData {
    if (radius <= 0) {
      return imageData;
    }

    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;
    const result = new ImageData(width, height);
    const resultData = result.data;

    // Create Gaussian kernel
    const kernelSize = Math.ceil(radius * 3) * 2 + 1;
    const kernel: number[] = [];
    const sigma = radius / 3;
    const twoSigmaSq = 2 * sigma * sigma;
    let sum = 0;

    for (let i = 0; i < kernelSize; i++) {
      const x = i - Math.floor(kernelSize / 2);
      const value = Math.exp(-(x * x) / twoSigmaSq);
      kernel[i] = value;
      sum += value;
    }

    // Normalize kernel
    for (let i = 0; i < kernelSize; i++) {
      kernel[i] /= sum;
    }

    // Helper function to get pixel coordinate with edge handling
    function getCoord(coord: number, max: number, wrap: boolean): number {
      if (wrap) {
        if (coord < 0) {
          return max + (coord % max);
        } else if (coord >= max) {
          return coord % max;
        }
        return coord;
      } else {
        return Math.max(0, Math.min(max - 1, coord));
      }
    }

    // Apply horizontal blur
    const tempData = new Uint8ClampedArray(data.length);
    const halfKernel = Math.floor(kernelSize / 2);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let r = 0, g = 0, b = 0, a = 0;

        for (let k = 0; k < kernelSize; k++) {
          const px = getCoord(x + k - halfKernel, width, wrapEdges);
          const idx = (y * width + px) * 4;
          const weight = kernel[k];
          r += data[idx] * weight;
          g += data[idx + 1] * weight;
          b += data[idx + 2] * weight;
          a += data[idx + 3] * weight;
        }

        const idx = (y * width + x) * 4;
        tempData[idx] = r;
        tempData[idx + 1] = g;
        tempData[idx + 2] = b;
        tempData[idx + 3] = a;
      }
    }

    // Apply vertical blur
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let r = 0, g = 0, b = 0, a = 0;

        for (let k = 0; k < kernelSize; k++) {
          const py = getCoord(y + k - halfKernel, height, wrapEdges);
          const idx = (py * width + x) * 4;
          const weight = kernel[k];
          r += tempData[idx] * weight;
          g += tempData[idx + 1] * weight;
          b += tempData[idx + 2] * weight;
          a += tempData[idx + 3] * weight;
        }

        const idx = (y * width + x) * 4;
        resultData[idx] = Math.round(r);
        resultData[idx + 1] = Math.round(g);
        resultData[idx + 2] = Math.round(b);
        resultData[idx + 3] = Math.round(a);
      }
    }

    return result;
  }

  private render(): void {
    if (!this.image.value) {
      return;
    }

    const img = this.image.value;
    const { width, height } = this.getImageSize(img);

    if (width === 0 || height === 0) {
      return;
    }

    const imageData = this.getImageData(img, width, height);
    if (!imageData) {
      return;
    }

    const radius = this.props.radius.value;
    const wrapEdges = this.props.wrapEdges.value;
    const blurredData = this.gaussianBlur(imageData, radius, wrapEdges);

    const canvas = this.putImageData(blurredData);
    this.setOutputAndPreview(this.output, canvas);
  }
}
