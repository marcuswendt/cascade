/**
 * CompositeNode - blends two ImageBuffers together
 * Supports resolution control similar to TouchDesigner TOPs
 */

import { LensNode, ImageBuffer, type ImageInput, type ResolutionMode, type FitMode } from '../LensNode';
import type { Graph } from '@/nodes/Graph';
import type { InputPort, OutputPort } from '@/types/node.types';

export class CompositeNode extends LensNode {
  private image1!: InputPort<ImageInput>;
  private image2!: InputPort<ImageInput>;
  private output!: OutputPort<ImageBuffer>;

  constructor(id: string, graph: Graph) {
    super(id, 'Composite', graph);
  }

  protected setup(): void {
    this.image1 = this.in<ImageInput>('image1', null);
    this.image2 = this.in<ImageInput>('image2', null);

    this.addParm('blendMode', {
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
      onChange: () => this.requestCook()
    });

    this.addParm('opacity', {
      value: 1.0,
      params: {
        min: 0.0,
        max: 1.0,
        step: 0.01
      },
      displayName: 'Opacity',
      onChange: () => this.requestCook()
    });

    // Resolution control - which input determines output size
    this.addParm('outputResolution', {
      value: 'input1',
      params: {
        options: [
          { value: 'input1', label: 'Use Input 1' },
          { value: 'input2', label: 'Use Input 2' },
          { value: 'largest', label: 'Largest Input' },
          { value: 'smallest', label: 'Smallest Input' },
          { value: 'custom', label: 'Custom' }
        ]
      },
      displayName: 'Output Resolution',
      onChange: () => this.requestCook()
    });

    this.addParm('customResolution', {
      value: [512, 512],
      params: {
        min: [1, 1],
        max: [4096, 4096],
        integer: true
      },
      displayName: 'Resolution',
      hidden: () => this.props.outputResolution.value !== 'custom',
      onChange: () => this.requestCook()
    });

    // How to fit inputs that don't match output resolution
    this.addParm('fitMode', {
      value: 'fill',
      params: {
        options: [
          { value: 'fill', label: 'Fill (Crop)' },
          { value: 'fit', label: 'Fit (Letterbox)' },
          { value: 'stretch', label: 'Stretch' },
          { value: 'native', label: 'Native (No Scale)' }
        ]
      },
      displayName: 'Fit Mode',
      onChange: () => this.requestCook()
    });

    this.output = this.out('image');

    this.image1.onChange = () => this.requestCook();
    this.image2.onChange = () => this.requestCook();

    this.onReady = () => this.requestCook();
  }

  private blendBuffers(base: ImageBuffer, blend: ImageBuffer, mode: string, opacity: number): ImageBuffer {
    const width = base.width;
    const height = base.height;
    const result = ImageBuffer.rgba(width, height);

    // Ensure both have RGBA
    const baseRGBA = base.channelCount >= 4 ? base : base.toRGBA();
    const blendRGBA = blend.channelCount >= 4 ? blend : blend.toRGBA();

    const r1 = baseRGBA.channels[0];
    const g1 = baseRGBA.channels[1];
    const b1 = baseRGBA.channels[2];
    const a1 = baseRGBA.channels[3];

    const r2 = blendRGBA.channels[0];
    const g2 = blendRGBA.channels[1];
    const b2 = blendRGBA.channels[2];
    const a2 = blendRGBA.channels[3];

    const rOut = result.channels[0];
    const gOut = result.channels[1];
    const bOut = result.channels[2];
    const aOut = result.channels[3];

    for (let i = 0; i < width * height; i++) {
      const baseR = r1[i], baseG = g1[i], baseB = b1[i], baseA = a1[i];
      const blendR = r2[i], blendG = g2[i], blendB = b2[i], blendA = a2[i];

      let r: number, g: number, b: number;

      switch (mode) {
        case 'normal':
          r = blendR; g = blendG; b = blendB;
          break;
        case 'multiply':
          r = baseR * blendR; g = baseG * blendG; b = baseB * blendB;
          break;
        case 'screen':
          r = 1 - (1 - baseR) * (1 - blendR);
          g = 1 - (1 - baseG) * (1 - blendG);
          b = 1 - (1 - baseB) * (1 - blendB);
          break;
        case 'overlay':
          r = baseR < 0.5 ? 2 * baseR * blendR : 1 - 2 * (1 - baseR) * (1 - blendR);
          g = baseG < 0.5 ? 2 * baseG * blendG : 1 - 2 * (1 - baseG) * (1 - blendG);
          b = baseB < 0.5 ? 2 * baseB * blendB : 1 - 2 * (1 - baseB) * (1 - blendB);
          break;
        case 'darken':
          r = Math.min(baseR, blendR); g = Math.min(baseG, blendG); b = Math.min(baseB, blendB);
          break;
        case 'lighten':
          r = Math.max(baseR, blendR); g = Math.max(baseG, blendG); b = Math.max(baseB, blendB);
          break;
        case 'color-dodge':
          r = blendR === 1 ? 1 : Math.min(1, baseR / (1 - blendR));
          g = blendG === 1 ? 1 : Math.min(1, baseG / (1 - blendG));
          b = blendB === 1 ? 1 : Math.min(1, baseB / (1 - blendB));
          break;
        case 'color-burn':
          r = blendR === 0 ? 0 : Math.max(0, 1 - (1 - baseR) / blendR);
          g = blendG === 0 ? 0 : Math.max(0, 1 - (1 - baseG) / blendG);
          b = blendB === 0 ? 0 : Math.max(0, 1 - (1 - baseB) / blendB);
          break;
        case 'hard-light':
          r = blendR < 0.5 ? 2 * baseR * blendR : 1 - 2 * (1 - baseR) * (1 - blendR);
          g = blendG < 0.5 ? 2 * baseG * blendG : 1 - 2 * (1 - baseG) * (1 - blendG);
          b = blendB < 0.5 ? 2 * baseB * blendB : 1 - 2 * (1 - baseB) * (1 - blendB);
          break;
        case 'soft-light':
          r = blendR < 0.5 ? baseR - (1 - 2 * blendR) * baseR * (1 - baseR) : baseR + (2 * blendR - 1) * (Math.sqrt(baseR) - baseR);
          g = blendG < 0.5 ? baseG - (1 - 2 * blendG) * baseG * (1 - baseG) : baseG + (2 * blendG - 1) * (Math.sqrt(baseG) - baseG);
          b = blendB < 0.5 ? baseB - (1 - 2 * blendB) * baseB * (1 - baseB) : baseB + (2 * blendB - 1) * (Math.sqrt(baseB) - baseB);
          break;
        case 'difference':
          r = Math.abs(baseR - blendR); g = Math.abs(baseG - blendG); b = Math.abs(baseB - blendB);
          break;
        case 'exclusion':
          r = baseR + blendR - 2 * baseR * blendR;
          g = baseG + blendG - 2 * baseG * blendG;
          b = baseB + blendB - 2 * baseB * blendB;
          break;
        case 'add':
          r = Math.min(1, baseR + blendR); g = Math.min(1, baseG + blendG); b = Math.min(1, baseB + blendB);
          break;
        case 'subtract':
          r = Math.max(0, baseR - blendR); g = Math.max(0, baseG - blendG); b = Math.max(0, baseB - blendB);
          break;
        case 'divide':
          r = blendR === 0 ? 1 : Math.min(1, baseR / blendR);
          g = blendG === 0 ? 1 : Math.min(1, baseG / blendG);
          b = blendB === 0 ? 1 : Math.min(1, baseB / blendB);
          break;
        case 'pin-light':
          r = blendR < 0.5 ? Math.min(baseR, 2 * blendR) : Math.max(baseR, 2 * (blendR - 0.5));
          g = blendG < 0.5 ? Math.min(baseG, 2 * blendG) : Math.max(baseG, 2 * (blendG - 0.5));
          b = blendB < 0.5 ? Math.min(baseB, 2 * blendB) : Math.max(baseB, 2 * (blendB - 0.5));
          break;
        case 'vivid-light':
          r = blendR < 0.5 ? (blendR === 0 ? 0 : 1 - (1 - baseR) / (2 * blendR)) : (blendR === 1 ? 1 : baseR / (2 * (1 - blendR)));
          g = blendG < 0.5 ? (blendG === 0 ? 0 : 1 - (1 - baseG) / (2 * blendG)) : (blendG === 1 ? 1 : baseG / (2 * (1 - blendG)));
          b = blendB < 0.5 ? (blendB === 0 ? 0 : 1 - (1 - baseB) / (2 * blendB)) : (blendB === 1 ? 1 : baseB / (2 * (1 - blendB)));
          break;
        case 'linear-dodge':
          r = Math.min(1, baseR + blendR); g = Math.min(1, baseG + blendG); b = Math.min(1, baseB + blendB);
          break;
        case 'linear-burn':
          r = Math.max(0, baseR + blendR - 1); g = Math.max(0, baseG + blendG - 1); b = Math.max(0, baseB + blendB - 1);
          break;
        default:
          r = blendR; g = blendG; b = blendB;
      }

      // Apply opacity
      rOut[i] = baseR + (r - baseR) * opacity * blendA;
      gOut[i] = baseG + (g - baseG) * opacity * blendA;
      bOut[i] = baseB + (b - baseB) * opacity * blendA;
      aOut[i] = baseA + (blendA - baseA) * opacity;
    }

    return result;
  }

  protected render(): void {
    // Get resolution settings
    const resolutionMode = this.props.outputResolution.value as ResolutionMode;
    const fitMode = this.props.fitMode.value as FitMode;
    const customSize = this.props.customResolution.value as [number, number];

    // Prepare inputs - handles resolution matching
    const { buffers } = this.prepareInputs(
      [this.image1.value, this.image2.value],
      resolutionMode,
      fitMode,
      customSize
    );

    const [buf1, buf2] = buffers;

    if (!buf1 || !buf2) {
      return;
    }

    const blendMode = this.props.blendMode.value;
    const opacity = this.props.opacity.value;

    try {
      const result = this.blendBuffers(buf1, buf2, blendMode, opacity);
      this.setOutput(this.output, result);
    } catch (error) {
      console.error('Composite render error:', error);
      this.error = error as Error;
    }
  }
}
