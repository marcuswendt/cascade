/**
 * RampNode - generates color ramps as ImageBuffer
 */

import { ImageNodeBase, ImageBuffer } from '../ImageNodeBase';
import type { Graph } from '@/nodes/Graph';
import type { OutputPort } from '@/types/node.types';

interface ColorValue {
  r: number;
  g: number;
  b: number;
  a?: number;
}

interface RampPoint {
  position: number;
  color: ColorValue | number[] | string;
  interpolation?: 'linear' | 'smooth' | 'constant';
}

export class RampNode extends ImageNodeBase {
  private output!: OutputPort<ImageBuffer>;

  constructor(id: string, graph: Graph) {
    super(id, 'Ramp', graph);
  }

  protected setup(): void {
    this.addParm('type', {
      value: 'horizontal',
      params: {
        options: [
          { value: 'horizontal', label: 'Horizontal' },
          { value: 'vertical', label: 'Vertical' },
          { value: 'radial', label: 'Radial' },
          { value: 'concentric', label: 'Concentric' }
        ]
      },
      displayName: 'Type',
      onChange: () => this.requestCook()
    });

    this.addParm('points', {
      value: [
        { position: 0.0, color: { r: 0.0, g: 0.0, b: 0.0 }, interpolation: 'linear' },
        { position: 1.0, color: { r: 1.0, g: 1.0, b: 1.0 }, interpolation: 'linear' }
      ],
      type: 'colorramp',
      displayName: 'Ramp',
      onChange: () => this.requestCook()
    });

    this.addResolutionParm();

    this.output = this.out('image');

    this.watchProp('type', () => this.requestCook());
    this.watchProp('points', () => this.requestCook());

    this.onReady = () => this.requestCook();
  }

  private normalizeRampColor(color: ColorValue | number[] | string): ColorValue {
    if (typeof color === 'object' && color !== null && 'r' in color && 'g' in color && 'b' in color) {
      const isNormalized = color.r <= 1.0 && color.g <= 1.0 && color.b <= 1.0;
      return {
        r: isNormalized ? color.r : color.r / 255,
        g: isNormalized ? color.g : color.g / 255,
        b: isNormalized ? color.b : color.b / 255,
        a: color.a !== undefined ? (isNormalized ? color.a : color.a / 255) : 1.0
      };
    }

    if (Array.isArray(color)) {
      const isNormalized = color.every(v => v <= 1.0);
      return {
        r: isNormalized ? color[0] : color[0] / 255,
        g: isNormalized ? color[1] : color[1] / 255,
        b: isNormalized ? color[2] : color[2] / 255,
        a: color[3] !== undefined ? (isNormalized ? color[3] : color[3] / 255) : 1.0
      };
    }

    if (typeof color === 'string') {
      const rgbMatch = color.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
      if (rgbMatch) {
        return {
          r: parseInt(rgbMatch[1], 10) / 255,
          g: parseInt(rgbMatch[2], 10) / 255,
          b: parseInt(rgbMatch[3], 10) / 255,
          a: 1.0
        };
      }

      const hex = color.replace('#', '');
      if (hex.length === 3 || hex.length === 6) {
        const expanded = hex.length === 3
          ? hex.split('').map(c => c + c).join('')
          : hex;
        const result = /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(expanded);
        if (result) {
          return {
            r: parseInt(result[1], 16) / 255,
            g: parseInt(result[2], 16) / 255,
            b: parseInt(result[3], 16) / 255,
            a: 1.0
          };
        }
      }
    }

    return { r: 0, g: 0, b: 0, a: 1.0 };
  }

  private interpolateColor(color1: ColorValue, color2: ColorValue, t: number, interpolation: string): ColorValue {
    if (interpolation === 'constant') {
      return t < 0.5 ? color1 : color2;
    } else if (interpolation === 'smooth') {
      t = t * t * (3 - 2 * t);
    }

    return {
      r: color1.r + (color2.r - color1.r) * t,
      g: color1.g + (color2.g - color1.g) * t,
      b: color1.b + (color2.b - color1.b) * t,
      a: (color1.a ?? 1) + ((color2.a ?? 1) - (color1.a ?? 1)) * t
    };
  }

  private getColorAtPosition(points: RampPoint[], position: number): ColorValue {
    const sortedPoints = [...points].sort((a, b) => a.position - b.position);
    position = Math.max(0, Math.min(1, position));

    let before: RampPoint | null = null;
    let after: RampPoint | null = null;

    for (let i = 0; i < sortedPoints.length; i++) {
      if (sortedPoints[i].position <= position) {
        before = sortedPoints[i];
      }
      if (sortedPoints[i].position >= position && !after) {
        after = sortedPoints[i];
        break;
      }
    }

    if (!before && after) return this.normalizeRampColor(after.color);
    if (before && !after) return this.normalizeRampColor(before.color);
    if (!before && !after) return { r: 0, g: 0, b: 0, a: 1 };

    if (before!.position === position) return this.normalizeRampColor(before!.color);
    if (after!.position === position) return this.normalizeRampColor(after!.color);

    const t = (position - before!.position) / (after!.position - before!.position);
    const color1 = this.normalizeRampColor(before!.color);
    const color2 = this.normalizeRampColor(after!.color);
    const interpolation = after!.interpolation || 'linear';

    return this.interpolateColor(color1, color2, t, interpolation);
  }

  protected render(): void {
    const [width, height] = this.getResolution();
    const rampType = this.props.type.value;
    const points: RampPoint[] = this.props.points.value || [];

    if (points.length === 0) {
      return;
    }

    const buffer = this.createRGBA(width, height);
    const r = buffer.r();
    const g = buffer.g();
    const b = buffer.b();
    const a = buffer.a();

    const centerX = width / 2;
    const centerY = height / 2;
    const maxDist = Math.sqrt(centerX * centerX + centerY * centerY);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let position = 0;

        if (rampType === 'horizontal') {
          position = x / width;
        } else if (rampType === 'vertical') {
          position = y / height;
        } else if (rampType === 'radial') {
          const dx = x - centerX;
          const dy = y - centerY;
          const angle = Math.atan2(dy, dx);
          position = (angle + Math.PI) / (2 * Math.PI);
        } else if (rampType === 'concentric') {
          const dx = x - centerX;
          const dy = y - centerY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          position = dist / maxDist;
        }

        const color = this.getColorAtPosition(points, position);
        const idx = y * width + x;
        r[idx] = color.r;
        g[idx] = color.g;
        b[idx] = color.b;
        a[idx] = color.a ?? 1;
      }
    }

    buffer.markDirty();
    this.setOutput(this.output, buffer);
  }
}
