/**
 * NormalMapNode - computes normal map from height map (red/grayscale channel)
 */

import { ImageNodeBase, ImageBuffer, type ImageInput } from '../ImageNodeBase';
import type { Graph } from '@/nodes/Graph';
import type { InputPort, OutputPort } from '@/types/node.types';

export class NormalMapNode extends ImageNodeBase {
  private image!: InputPort<ImageInput>;
  private output!: OutputPort<ImageBuffer>;

  constructor(id: string, graph: Graph) {
    super(id, 'NormalMap', graph);
  }

  protected setup(): void {
    this.image = this.in<ImageInput>('image', null);

    this.addParm('scale', {
      value: 1.0,
      params: {
        min: 0.0,
        max: 10.0,
        step: 0.1
      },
      displayName: 'Scale',
      onChange: () => this.requestCook()
    });

    this.addParm('flipX', {
      value: false,
      type: 'boolean',
      displayName: 'Flip X',
      onChange: () => this.requestCook()
    });

    this.addParm('flipY', {
      value: false,
      type: 'boolean',
      displayName: 'Flip Y',
      onChange: () => this.requestCook()
    });

    this.output = this.out('image');

    this.image.onChange = () => this.requestCook();

    this.onReady = () => this.requestCook();
  }

  private computeNormalMap(source: ImageBuffer, scale: number, flipX: boolean, flipY: boolean): ImageBuffer {
    const { width, height } = source;
    const result = ImageBuffer.rgba(width, height);

    // Use first channel as height (works for grayscale or red channel)
    const heightMap = source.channels[0];

    const rOut = result.channels[0];
    const gOut = result.channels[1];
    const bOut = result.channels[2];
    const aOut = result.channels[3];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;

        // Get neighboring heights with clamping
        const h00 = heightMap[idx];
        const h10 = heightMap[Math.min(x + 1, width - 1) + y * width];
        const h01 = heightMap[x + Math.min(y + 1, height - 1) * width];

        // Compute gradients
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
        rOut[idx] = normalizedX * 0.5 + 0.5;
        gOut[idx] = normalizedY * 0.5 + 0.5;
        bOut[idx] = normalizedZ * 0.5 + 0.5;
        aOut[idx] = 1.0;
      }
    }

    return result;
  }

  protected render(): void {
    const buffer = this.toImageBuffer(this.image.value);
    if (!buffer) {
      return;
    }

    const scale = this.props.scale.value;
    const flipX = this.props.flipX.value;
    const flipY = this.props.flipY.value;

    const normalMap = this.computeNormalMap(buffer, scale, flipX, flipY);
    this.setOutput(this.output, normalMap);
  }
}
