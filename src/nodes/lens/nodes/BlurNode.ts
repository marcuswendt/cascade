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

    this.addParm('method', {
      value: 'box',
      params: {
        options: [
          { value: 'box', label: 'Box (Fast)' },
          { value: 'gaussian', label: 'Gaussian (Accurate)' }
        ]
      },
      displayName: 'Method',
      onChange: () => this.requestCook()
    });

    this.addParm('radius', {
      value: 5.0,
      params: {
        min: 0.0,
        max: 100.0,
        step: 0.1
      },
      displayName: 'Radius',
      onChange: () => this.requestCook()
    });

    this.addParm('wrapEdges', {
      value: false,
      type: 'boolean',
      displayName: 'Wrap Edges',
      onChange: () => this.requestCook()
    });

    this.output = this.out('image');

    this.image.onChange = () => this.requestCook();

    this.onReady = () => this.requestCook();
  }

  /**
   * Fast blur using stacked box blur approximation.
   * 3 passes of box blur closely approximates Gaussian and is O(1) per pixel.
   */
  private boxBlur(source: ImageBuffer, radius: number, wrapEdges: boolean): ImageBuffer {
    if (radius <= 0) {
      return source.clone();
    }

    const { width, height } = source;

    // Calculate box sizes for Gaussian approximation
    // Using 3 passes gives a good approximation
    const sigma = radius;
    const boxes = this.boxesForGauss(sigma, 3);

    // Process each channel
    const result = source.emptyClone();

    for (let c = 0; c < source.channelCount; c++) {
      // Copy source to result for in-place processing
      const channelData = new Float32Array(source.channels[c]);

      // Apply 3 box blur passes
      for (const boxSize of boxes) {
        this.boxBlurPass(channelData, width, height, boxSize, wrapEdges);
      }

      result.channels[c].set(channelData);
    }

    return result;
  }

  /**
   * Calculate box sizes for Gaussian approximation.
   * Returns array of box radii for n passes.
   */
  private boxesForGauss(sigma: number, n: number): number[] {
    // Ideal box width for Gaussian approximation
    const wIdeal = Math.sqrt((12 * sigma * sigma / n) + 1);
    let wl = Math.floor(wIdeal);
    if (wl % 2 === 0) wl--;
    const wu = wl + 2;

    const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
    const m = Math.round(mIdeal);

    const sizes: number[] = [];
    for (let i = 0; i < n; i++) {
      sizes.push(i < m ? wl : wu);
    }
    return sizes.map(s => (s - 1) / 2); // Convert to radius
  }

  /**
   * Single box blur pass (horizontal then vertical) - O(1) per pixel
   */
  private boxBlurPass(data: Float32Array, w: number, h: number, r: number, wrap: boolean): void {
    if (r < 1) return;

    const temp = new Float32Array(w * h);
    const ri = Math.floor(r);
    const diameter = ri * 2 + 1;
    const invDiameter = 1 / diameter;

    // Horizontal pass - O(1) per pixel using sliding window
    for (let y = 0; y < h; y++) {
      const rowOffset = y * w;
      let sum = 0;

      // Initialize sum for first pixel
      for (let i = -ri; i <= ri; i++) {
        const px = wrap ? ((i % w) + w) % w : Math.max(0, Math.min(w - 1, i));
        sum += data[rowOffset + px];
      }
      temp[rowOffset] = sum * invDiameter;

      // Slide window across row
      for (let x = 1; x < w; x++) {
        // Remove left pixel, add right pixel
        const removeX = wrap ? (((x - ri - 1) % w) + w) % w : Math.max(0, x - ri - 1);
        const addX = wrap ? (((x + ri) % w) + w) % w : Math.min(w - 1, x + ri);
        sum -= data[rowOffset + removeX];
        sum += data[rowOffset + addX];
        temp[rowOffset + x] = sum * invDiameter;
      }
    }

    // Vertical pass - O(1) per pixel using sliding window
    for (let x = 0; x < w; x++) {
      let sum = 0;

      // Initialize sum for first pixel
      for (let i = -ri; i <= ri; i++) {
        const py = wrap ? ((i % h) + h) % h : Math.max(0, Math.min(h - 1, i));
        sum += temp[py * w + x];
      }
      data[x] = sum * invDiameter;

      // Slide window down column
      for (let y = 1; y < h; y++) {
        const removeY = wrap ? (((y - ri - 1) % h) + h) % h : Math.max(0, y - ri - 1);
        const addY = wrap ? (((y + ri) % h) + h) % h : Math.min(h - 1, y + ri);
        sum -= temp[removeY * w + x];
        sum += temp[addY * w + x];
        data[y * w + x] = sum * invDiameter;
      }
    }
  }

  /**
   * True Gaussian blur using separable convolution.
   * More accurate but O(radius) per pixel - slower for large radii.
   */
  private trueGaussianBlur(source: ImageBuffer, radius: number, wrapEdges: boolean): ImageBuffer {
    if (radius <= 0) {
      return source.clone();
    }

    const { width, height } = source;
    const result = source.emptyClone();

    // Create Gaussian kernel
    const kernelSize = Math.ceil(radius * 3) * 2 + 1;
    const kernel = new Float32Array(kernelSize);
    const sigma = radius / 3;
    const twoSigmaSq = 2 * sigma * sigma;
    let sum = 0;

    const halfKernel = (kernelSize - 1) >> 1;

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

    // Inline wrapCoord functions
    const wrapX = wrapEdges
      ? (coord: number) => ((coord % width) + width) % width
      : (coord: number) => coord < 0 ? 0 : coord >= width ? width - 1 : coord;
    const wrapY = wrapEdges
      ? (coord: number) => ((coord % height) + height) % height
      : (coord: number) => coord < 0 ? 0 : coord >= height ? height - 1 : coord;

    // Process each channel
    for (let c = 0; c < source.channelCount; c++) {
      const srcChannel = source.channels[c];
      const dstChannel = result.channels[c];
      const temp = new Float32Array(width * height);

      // Horizontal pass
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

      // Vertical pass
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

    const method = this.props.method.value;
    const radius = this.props.radius.value;
    const wrapEdges = this.props.wrapEdges.value;

    const blurred = method === 'gaussian'
      ? this.trueGaussianBlur(buffer, radius, wrapEdges)
      : this.boxBlur(buffer, radius, wrapEdges);

    this.setOutput(this.output, blurred);
  }
}
