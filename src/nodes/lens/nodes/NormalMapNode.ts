/**
 * NormalMapNode - computes normal map from height map (red channel)
 */

import { LensNode, type ImageInput } from '../LensNode';
import type { Graph } from '@/core/engine/Graph';
import type { InputPort, OutputPort } from '@/types/node.types';

export class NormalMapNode extends LensNode {
  private image!: InputPort<ImageInput>;
  private output!: OutputPort<HTMLCanvasElement>;

  constructor(id: string, graph: Graph) {
    super(id, 'NormalMap', graph);
  }

  protected setup(): void {
    this.image = this.in<ImageInput>('image', null);

    this.defineProp('scale', {
      value: 1.0,
      params: {
        min: 0.0,
        max: 10.0,
        step: 0.1
      },
      displayName: 'Scale',
      onChange: () => this.render()
    });

    this.defineProp('flipX', {
      value: false,
      type: 'boolean',
      displayName: 'Flip X',
      onChange: () => this.render()
    });

    this.defineProp('flipY', {
      value: false,
      type: 'boolean',
      displayName: 'Flip Y',
      onChange: () => this.render()
    });

    this.output = this.out('image');

    this.image.onChange = () => this.render();

    this.watchProp('scale', () => this.render());
    this.watchProp('flipX', () => this.render());
    this.watchProp('flipY', () => this.render());

    this.onReady = () => this.render();
  }

  private computeNormalMap(imageData: ImageData, scale: number, flipX: boolean, flipY: boolean): ImageData {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;
    const result = new ImageData(width, height);
    const resultData = result.data;

    // Extract red channel (height values)
    const heightMap = new Float32Array(width * height);
    for (let i = 0; i < data.length; i += 4) {
      const idx = i / 4;
      heightMap[idx] = data[i] / 255.0; // Red channel as height
    }

    // Compute gradients using finite differences
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;

        // Get neighboring heights with clamping
        const h00 = heightMap[idx]; // Current
        const h10 = heightMap[Math.min(x + 1, width - 1) + y * width]; // Right
        const h01 = heightMap[x + Math.min(y + 1, height - 1) * width]; // Down

        // Compute gradients (Sobel-like)
        const dx = (h10 - h00) * scale;
        const dy = (h01 - h00) * scale;

        // Apply flips
        const finalDx = flipX ? -dx : dx;
        const finalDy = flipY ? -dy : dy;

        // Compute normal vector: Normal = normalize(-dx, -dy, 1)
        const nx = -finalDx;
        const ny = -finalDy;
        const nz = 1.0;

        const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
        const normalizedX = nx / length;
        const normalizedY = ny / length;
        const normalizedZ = nz / length;

        // Map from [-1, 1] to [0, 1] for normal map format
        const r = (normalizedX * 0.5 + 0.5) * 255;
        const g = (normalizedY * 0.5 + 0.5) * 255;
        const b = (normalizedZ * 0.5 + 0.5) * 255;

        const resultIdx = idx * 4;
        resultData[resultIdx] = Math.round(Math.max(0, Math.min(255, r)));
        resultData[resultIdx + 1] = Math.round(Math.max(0, Math.min(255, g)));
        resultData[resultIdx + 2] = Math.round(Math.max(0, Math.min(255, b)));
        resultData[resultIdx + 3] = 255; // Alpha
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

    const scale = this.props.scale.value;
    const flipX = this.props.flipX.value;
    const flipY = this.props.flipY.value;
    const normalData = this.computeNormalMap(imageData, scale, flipX, flipY);

    const canvas = this.putImageData(normalData);
    this.setOutputAndPreview(this.output, canvas);
  }
}
