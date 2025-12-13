/**
 * CompositeNode - blends two images together
 */

import { LensNode, type ImageInput } from '../LensNode';
import type { Graph } from '@/nodes/Graph';
import type { InputPort, OutputPort } from '@/types/node.types';

export class CompositeNode extends LensNode {
  private image1!: InputPort<ImageInput>;
  private image2!: InputPort<ImageInput>;
  private output!: OutputPort<HTMLCanvasElement>;

  constructor(id: string, graph: Graph) {
    super(id, 'Composite', graph);
  }

  protected setup(): void {
    this.image1 = this.in<ImageInput>('image1', null);
    this.image2 = this.in<ImageInput>('image2', null);

    this.defineProp('blendMode', {
      value: 'multiply',
      params: {
        options: [
          { value: 'normal', label: 'Normal' },
          { value: 'multiply', label: 'Multiply' },
          { value: 'screen', label: 'Screen' },
          { value: 'overlay', label: 'Overlay' },
          { value: 'darken', label: 'Darken' },
          { value: 'lighten', label: 'Lighten' },
          { value: 'color-dodge', label: 'Color Dodge' },
          { value: 'color-burn', label: 'Color Burn' },
          { value: 'hard-light', label: 'Hard Light' },
          { value: 'soft-light', label: 'Soft Light' },
          { value: 'difference', label: 'Difference' },
          { value: 'exclusion', label: 'Exclusion' },
          { value: 'add', label: 'Add' },
          { value: 'subtract', label: 'Subtract' },
          { value: 'divide', label: 'Divide' },
          { value: 'pin-light', label: 'Pin Light' },
          { value: 'vivid-light', label: 'Vivid Light' },
          { value: 'linear-dodge', label: 'Linear Dodge' },
          { value: 'linear-burn', label: 'Linear Burn' }
        ]
      },
      displayName: 'Blend Mode',
      onChange: () => {
        this.render().catch(err => {
          console.error('Composite render error in blendMode onChange:', err);
        });
      }
    });

    this.defineProp('opacity', {
      value: 1.0,
      params: {
        min: 0.0,
        max: 1.0,
        step: 0.01
      },
      displayName: 'Opacity',
      onChange: () => {
        this.render().catch(err => {
          console.error('Composite render error in opacity onChange:', err);
        });
      }
    });

    this.output = this.out('image');

    this.image1.onChange = () => {
      this.render().catch(err => {
        console.error('Composite render error in image1 onChange:', err);
      });
    };

    this.image2.onChange = () => {
      this.render().catch(err => {
        console.error('Composite render error in image2 onChange:', err);
      });
    };

    this.onReady = () => {
      this.render().catch(err => {
        console.error('Composite render error in onReady:', err);
      });
    };
  }

  private getBlendMode(mode: string): GlobalCompositeOperation | null {
    const nativeModes: Record<string, GlobalCompositeOperation> = {
      'normal': 'source-over',
      'multiply': 'multiply',
      'screen': 'screen',
      'overlay': 'overlay',
      'darken': 'darken',
      'lighten': 'lighten',
      'color-dodge': 'color-dodge',
      'color-burn': 'color-burn',
      'hard-light': 'hard-light',
      'soft-light': 'soft-light',
      'difference': 'difference',
      'exclusion': 'exclusion'
    };
    return nativeModes[mode] || null;
  }

  private blendPixels(base: Uint8ClampedArray, blend: Uint8ClampedArray, mode: string, opacity: number): Uint8ClampedArray {
    const result = new Uint8ClampedArray(base.length);

    for (let i = 0; i < base.length; i += 4) {
      const r1 = base[i] / 255;
      const g1 = base[i + 1] / 255;
      const b1 = base[i + 2] / 255;
      const a1 = base[i + 3] / 255;

      const r2 = blend[i] / 255;
      const g2 = blend[i + 1] / 255;
      const b2 = blend[i + 2] / 255;
      const a2 = blend[i + 3] / 255;

      let r: number, g: number, b: number;

      switch (mode) {
        case 'normal':
          r = r2; g = g2; b = b2;
          break;
        case 'multiply':
          r = r1 * r2; g = g1 * g2; b = b1 * b2;
          break;
        case 'screen':
          r = 1 - (1 - r1) * (1 - r2);
          g = 1 - (1 - g1) * (1 - g2);
          b = 1 - (1 - b1) * (1 - b2);
          break;
        case 'overlay':
          r = r1 < 0.5 ? 2 * r1 * r2 : 1 - 2 * (1 - r1) * (1 - r2);
          g = g1 < 0.5 ? 2 * g1 * g2 : 1 - 2 * (1 - g1) * (1 - g2);
          b = b1 < 0.5 ? 2 * b1 * b2 : 1 - 2 * (1 - b1) * (1 - b2);
          break;
        case 'darken':
          r = Math.min(r1, r2); g = Math.min(g1, g2); b = Math.min(b1, b2);
          break;
        case 'lighten':
          r = Math.max(r1, r2); g = Math.max(g1, g2); b = Math.max(b1, b2);
          break;
        case 'color-dodge':
          r = r2 === 1 ? 1 : Math.min(1, r1 / (1 - r2));
          g = g2 === 1 ? 1 : Math.min(1, g1 / (1 - g2));
          b = b2 === 1 ? 1 : Math.min(1, b1 / (1 - b2));
          break;
        case 'color-burn':
          r = r2 === 0 ? 0 : Math.max(0, 1 - (1 - r1) / r2);
          g = g2 === 0 ? 0 : Math.max(0, 1 - (1 - g1) / g2);
          b = b2 === 0 ? 0 : Math.max(0, 1 - (1 - b1) / b2);
          break;
        case 'hard-light':
          r = r2 < 0.5 ? 2 * r1 * r2 : 1 - 2 * (1 - r1) * (1 - r2);
          g = g2 < 0.5 ? 2 * g1 * g2 : 1 - 2 * (1 - g1) * (1 - g2);
          b = b2 < 0.5 ? 2 * b1 * b2 : 1 - 2 * (1 - b1) * (1 - b2);
          break;
        case 'soft-light':
          r = r2 < 0.5 ? r1 - (1 - 2 * r2) * r1 * (1 - r1) : r1 + (2 * r2 - 1) * (Math.sqrt(r1) - r1);
          g = g2 < 0.5 ? g1 - (1 - 2 * g2) * g1 * (1 - g1) : g1 + (2 * g2 - 1) * (Math.sqrt(g1) - g1);
          b = b2 < 0.5 ? b1 - (1 - 2 * b2) * b1 * (1 - b1) : b1 + (2 * b2 - 1) * (Math.sqrt(b1) - b1);
          break;
        case 'difference':
          r = Math.abs(r1 - r2); g = Math.abs(g1 - g2); b = Math.abs(b1 - b2);
          break;
        case 'exclusion':
          r = r1 + r2 - 2 * r1 * r2;
          g = g1 + g2 - 2 * g1 * g2;
          b = b1 + b2 - 2 * b1 * b2;
          break;
        case 'add':
          r = Math.min(1, r1 + r2); g = Math.min(1, g1 + g2); b = Math.min(1, b1 + b2);
          break;
        case 'subtract':
          r = Math.max(0, r1 - r2); g = Math.max(0, g1 - g2); b = Math.max(0, b1 - b2);
          break;
        case 'divide':
          r = r2 === 0 ? 1 : Math.min(1, r1 / r2);
          g = g2 === 0 ? 1 : Math.min(1, g1 / g2);
          b = b2 === 0 ? 1 : Math.min(1, b1 / b2);
          break;
        case 'pin-light':
          r = r2 < 0.5 ? Math.min(r1, 2 * r2) : Math.max(r1, 2 * (r2 - 0.5));
          g = g2 < 0.5 ? Math.min(g1, 2 * g2) : Math.max(g1, 2 * (g2 - 0.5));
          b = b2 < 0.5 ? Math.min(b1, 2 * b2) : Math.max(b1, 2 * (b2 - 0.5));
          break;
        case 'vivid-light':
          r = r2 < 0.5 ? (r2 === 0 ? 0 : 1 - (1 - r1) / (2 * r2)) : (r2 === 1 ? 1 : r1 / (2 * (1 - r2)));
          g = g2 < 0.5 ? (g2 === 0 ? 0 : 1 - (1 - g1) / (2 * g2)) : (g2 === 1 ? 1 : g1 / (2 * (1 - g2)));
          b = b2 < 0.5 ? (b2 === 0 ? 0 : 1 - (1 - b1) / (2 * b2)) : (b2 === 1 ? 1 : b1 / (2 * (1 - b2)));
          break;
        case 'linear-dodge':
          r = Math.min(1, r1 + r2); g = Math.min(1, g1 + g2); b = Math.min(1, b1 + b2);
          break;
        case 'linear-burn':
          r = Math.max(0, r1 + r2 - 1); g = Math.max(0, g1 + g2 - 1); b = Math.max(0, b1 + b2 - 1);
          break;
        default:
          r = r2; g = g2; b = b2;
      }

      // Apply opacity
      const finalR = r1 + (r - r1) * opacity * a2;
      const finalG = g1 + (g - g1) * opacity * a2;
      const finalB = b1 + (b - b1) * opacity * a2;
      const finalA = a1 + (a2 - a1) * opacity;

      result[i] = Math.round(finalR * 255);
      result[i + 1] = Math.round(finalG * 255);
      result[i + 2] = Math.round(finalB * 255);
      result[i + 3] = Math.round(finalA * 255);
    }

    return result;
  }

  private async render(): Promise<void> {
    // Execute upstream nodes for any missing inputs
    const upstreamPromises: Promise<void>[] = [];

    if (!this.image1.value) {
      this.image1.connections.forEach(conn => {
        const upstreamNode = this.graph.getNode(conn.from.nodeId);
        if (upstreamNode) {
          upstreamPromises.push(
            this.graph.execute(upstreamNode).catch((err: Error) => {
              console.warn('Failed to execute upstream node for image1:', err);
            })
          );
        }
      });
    }

    if (!this.image2.value) {
      this.image2.connections.forEach(conn => {
        const upstreamNode = this.graph.getNode(conn.from.nodeId);
        if (upstreamNode) {
          upstreamPromises.push(
            this.graph.execute(upstreamNode).catch((err: Error) => {
              console.warn('Failed to execute upstream node for image2:', err);
            })
          );
        }
      });
    }

    if (upstreamPromises.length > 0) {
      await Promise.all(upstreamPromises);
    }

    if (!this.image1.value || !this.image2.value) {
      return;
    }

    const img1 = this.image1.value;
    const img2 = this.image2.value;

    const { width, height } = this.getImageSize(img1);
    if (width === 0 || height === 0) {
      return;
    }

    const canvas = this.createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const blendMode = this.props.blendMode.value;
    const opacity = this.props.opacity.value;
    const nativeMode = this.getBlendMode(blendMode);

    try {
      if (nativeMode && opacity === 1.0) {
        // Use native canvas operations for supported modes when opacity is 1.0
        this.drawImage(ctx, img1, 0, 0, width, height);
        ctx.globalCompositeOperation = nativeMode;
        this.drawImage(ctx, img2, 0, 0, width, height);
        ctx.globalCompositeOperation = 'source-over';
      } else {
        // Use manual pixel blending for unsupported modes or when opacity < 1.0
        const baseData = this.getImageData(img1, width, height);
        const blendData = this.getImageData(img2, width, height);

        if (!baseData || !blendData) {
          // Fallback: just draw image1 if blending fails
          this.drawImage(ctx, img1, 0, 0, width, height);
          this.setOutputAndPreview(this.output, canvas);
          return;
        }

        const resultData = this.blendPixels(baseData.data, blendData.data, blendMode, opacity);
        const resultImageData = ctx.createImageData(width, height);
        resultImageData.data.set(resultData);
        ctx.putImageData(resultImageData, 0, 0);
      }

      this.setOutputAndPreview(this.output, canvas);
    } catch (error) {
      console.error('Composite render error:', error);
      this.error = error as Error;
    }
  }
}
