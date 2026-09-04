/**
 * TransformNode - 2D transformation (rotation, translation, scaling) for images
 */

import { ImageNodeBase, ImageBuffer } from '../ImageNodeBase';
import type { Graph } from '@/nodes/Graph';
import type { InputPort, OutputPort } from '@/types/node.types';

export class TransformNode extends ImageNodeBase {
  private imageInput!: InputPort<ImageBuffer | null>;
  private output!: OutputPort<ImageBuffer>;

  constructor(id: string, graph: Graph) {
    super(id, 'Transform', graph);
  }

  protected setup(): void {
    this.imageInput = this.in<ImageBuffer | null>('image', null);

    this.addParm('translate', {
      value: [0, 0],
      params: {
        min: [-2048, -2048],
        max: [2048, 2048],
        step: 1
      },
      displayName: 'Translate',
      onChange: () => this.requestCook()
    });

    this.addParm('rotation', {
      value: 0,
      params: {
        min: -180,
        max: 180,
        step: 0.1
      },
      displayName: 'Rotation',
      onChange: () => this.requestCook()
    });

    this.addParm('scale', {
      value: [1, 1],
      params: {
        min: [0.01, 0.01],
        max: [10, 10],
        step: 0.01
      },
      displayName: 'Scale',
      onChange: () => this.requestCook()
    });

    this.addParm('uniformScale', {
      value: true,
      type: 'boolean',
      displayName: 'Uniform Scale',
      onChange: () => this.requestCook()
    });

    this.addParm('pivot', {
      value: 'center',
      params: {
        options: [
          { value: 'center', label: 'Center' },
          { value: 'top-left', label: 'Top Left' },
          { value: 'top-right', label: 'Top Right' },
          { value: 'bottom-left', label: 'Bottom Left' },
          { value: 'bottom-right', label: 'Bottom Right' },
          { value: 'custom', label: 'Custom' }
        ]
      },
      displayName: 'Pivot',
      onChange: () => this.requestCook()
    });

    this.addParm('customPivot', {
      value: [0.5, 0.5],
      params: {
        min: [0, 0],
        max: [1, 1],
        step: 0.01
      },
      displayName: 'Custom Pivot',
      hidden: () => this.props.pivot.value !== 'custom',
      onChange: () => this.requestCook()
    });

    this.addParm('filter', {
      value: 'bilinear',
      params: {
        options: [
          { value: 'nearest', label: 'Nearest' },
          { value: 'bilinear', label: 'Bilinear' }
        ]
      },
      displayName: 'Filter',
      onChange: () => this.requestCook()
    });

    this.addParm('wrap', {
      value: 'clamp',
      params: {
        options: [
          { value: 'clamp', label: 'Clamp' },
          { value: 'repeat', label: 'Repeat' },
          { value: 'mirror', label: 'Mirror' },
          { value: 'transparent', label: 'Transparent' }
        ]
      },
      displayName: 'Wrap Mode',
      onChange: () => this.requestCook()
    });

    this.output = this.out('image');

    this.imageInput.onChange = () => this.requestCook();

    this.onReady = () => this.requestCook();
  }

  private getPivotPoint(width: number, height: number): [number, number] {
    const pivot = this.props.pivot.value;
    switch (pivot) {
      case 'center': return [width / 2, height / 2];
      case 'top-left': return [0, 0];
      case 'top-right': return [width, 0];
      case 'bottom-left': return [0, height];
      case 'bottom-right': return [width, height];
      case 'custom':
        const [px, py] = this.props.customPivot.value;
        return [px * width, py * height];
      default: return [width / 2, height / 2];
    }
  }

  private wrapCoord(coord: number, size: number, mode: string): number {
    if (mode === 'clamp') {
      return Math.max(0, Math.min(size - 1, coord));
    } else if (mode === 'repeat') {
      coord = coord % size;
      if (coord < 0) coord += size;
      return coord;
    } else if (mode === 'mirror') {
      const period = size * 2;
      coord = Math.abs(coord % period);
      if (coord >= size) coord = period - coord - 1;
      return Math.max(0, Math.min(size - 1, coord));
    }
    return coord; // transparent - will be checked separately
  }

  protected render(): void {
    const input = this.toImageBuffer(this.imageInput.value);
    if (!input) {
      return;
    }

    const width = input.width;
    const height = input.height;
    const [tx, ty] = this.props.translate.value;
    const rotation = this.props.rotation.value * Math.PI / 180;
    let [sx, sy] = this.props.scale.value;
    const uniformScale = this.props.uniformScale.value;
    const filterMode = this.props.filter.value;
    const wrapMode = this.props.wrap.value;

    if (uniformScale) {
      sy = sx;
    }

    const [pivotX, pivotY] = this.getPivotPoint(width, height);

    // Pre-compute inverse transform matrix
    const cosR = Math.cos(-rotation);
    const sinR = Math.sin(-rotation);
    const invSx = 1 / sx;
    const invSy = 1 / sy;

    const buffer = ImageBuffer.rgba(width, height);
    const channelCount = Math.min(input.channelCount, 4);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Transform from destination to source coordinates
        // 1. Translate to pivot
        let dx = x - pivotX - tx;
        let dy = y - pivotY - ty;

        // 2. Rotate (inverse)
        const rx = dx * cosR - dy * sinR;
        const ry = dx * sinR + dy * cosR;

        // 3. Scale (inverse)
        const srcX = rx * invSx + pivotX;
        const srcY = ry * invSy + pivotY;

        // Check bounds for transparent mode
        if (wrapMode === 'transparent') {
          if (srcX < 0 || srcX >= width || srcY < 0 || srcY >= height) {
            const idx = y * width + x;
            for (let c = 0; c < 4; c++) {
              buffer.channels[c][idx] = c === 3 ? 0 : 0; // transparent black
            }
            continue;
          }
        }

        const idx = y * width + x;

        if (filterMode === 'nearest') {
          const sx0 = Math.round(srcX);
          const sy0 = Math.round(srcY);
          const wx = this.wrapCoord(sx0, width, wrapMode);
          const wy = this.wrapCoord(sy0, height, wrapMode);
          const srcIdx = wy * width + wx;

          for (let c = 0; c < channelCount; c++) {
            buffer.channels[c][idx] = input.channels[c][srcIdx];
          }
          // Fill alpha if input doesn't have it
          if (channelCount < 4) {
            buffer.channels[3][idx] = 1;
          }
        } else {
          // Bilinear interpolation
          const x0 = Math.floor(srcX);
          const y0 = Math.floor(srcY);
          const x1 = x0 + 1;
          const y1 = y0 + 1;
          const fx = srcX - x0;
          const fy = srcY - y0;

          const wx0 = this.wrapCoord(x0, width, wrapMode);
          const wx1 = this.wrapCoord(x1, width, wrapMode);
          const wy0 = this.wrapCoord(y0, height, wrapMode);
          const wy1 = this.wrapCoord(y1, height, wrapMode);

          const idx00 = wy0 * width + wx0;
          const idx10 = wy0 * width + wx1;
          const idx01 = wy1 * width + wx0;
          const idx11 = wy1 * width + wx1;

          for (let c = 0; c < channelCount; c++) {
            const v00 = input.channels[c][idx00];
            const v10 = input.channels[c][idx10];
            const v01 = input.channels[c][idx01];
            const v11 = input.channels[c][idx11];

            const v0 = v00 + (v10 - v00) * fx;
            const v1 = v01 + (v11 - v01) * fx;
            buffer.channels[c][idx] = v0 + (v1 - v0) * fy;
          }
          // Fill alpha if input doesn't have it
          if (channelCount < 4) {
            buffer.channels[3][idx] = 1;
          }
        }
      }
    }

    buffer.markDirty();
    this.setOutput(this.output, buffer);
  }
}
