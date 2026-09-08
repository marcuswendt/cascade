/**
 * TextNode - Renders text onto an ImageBuffer
 *
 * Similar to Houdini's Font node, provides extensive control over
 * text rendering including font, size, alignment, color, and transforms.
 */

import { ImageNodeBase, ImageBuffer } from '../ImageNodeBase';
import type { Graph } from '@/nodes/Graph';
import type { OutputPort } from '@/types/node.types';
import { colorToCss, normalizeColor } from '@/utils/colorUtils';
import { createSurface } from '../surface.js';

export class TextNode extends ImageNodeBase {
  private output!: OutputPort<ImageBuffer>;

  constructor(id: string, graph: Graph) {
    super(id, 'Text', graph);
  }

  protected setup(): void {
    // Text content (multiline)
    this.addParm('text', {
      value: 'Hello, World!',
      type: 'textarea',
      displayName: 'Text'
    });

    // Font family
    this.addParm('font', {
      value: 'Inter, system-ui, sans-serif',
      type: 'text',
      displayName: 'Font'
    });

    // Font size in pixels
    this.addParm('fontSize', {
      value: 48,
      type: 'slider',
      params: { min: 1, max: 500, step: 1 },
      displayName: 'Font Size'
    });

    // Font weight
    this.addParm('fontWeight', {
      value: 'normal',
      type: 'select',
      params: {
        options: [
          { value: 'normal', label: 'Normal' },
          { value: 'bold', label: 'Bold' },
          { value: '100', label: 'Thin (100)' },
          { value: '200', label: 'Extra Light (200)' },
          { value: '300', label: 'Light (300)' },
          { value: '500', label: 'Medium (500)' },
          { value: '600', label: 'Semi Bold (600)' },
          { value: '700', label: 'Bold (700)' },
          { value: '800', label: 'Extra Bold (800)' },
          { value: '900', label: 'Black (900)' }
        ]
      },
      displayName: 'Font Weight'
    });

    // Font style
    this.addParm('fontStyle', {
      value: 'normal',
      type: 'select',
      params: {
        options: [
          { value: 'normal', label: 'Normal' },
          { value: 'italic', label: 'Italic' },
          { value: 'oblique', label: 'Oblique' }
        ]
      },
      displayName: 'Font Style'
    });

    // Horizontal alignment
    this.addParm('alignH', {
      value: 'center',
      type: 'select',
      params: {
        options: [
          { value: 'left', label: 'Left' },
          { value: 'center', label: 'Center' },
          { value: 'right', label: 'Right' }
        ]
      },
      displayName: 'Horizontal Align'
    });

    // Vertical alignment
    this.addParm('alignV', {
      value: 'middle',
      type: 'select',
      params: {
        options: [
          { value: 'top', label: 'Top' },
          { value: 'middle', label: 'Middle' },
          { value: 'bottom', label: 'Bottom' }
        ]
      },
      displayName: 'Vertical Align'
    });

    // Text color
    this.addParm('color', {
      value: { r: 1.0, g: 1.0, b: 1.0 },
      type: 'color',
      displayName: 'Color'
    });

    // Background color (with alpha for transparency)
    this.addParm('backgroundColor', {
      value: { r: 0.0, g: 0.0, b: 0.0, a: 0.0 },
      type: 'color',
      displayName: 'Background'
    });

    this.addResolutionParm();

    // Position offset (relative to alignment anchor)
    this.addParm('offset', {
      value: [0, 0],
      params: {
        min: [-2048, -2048],
        max: [2048, 2048],
        step: 1
      },
      displayName: 'Offset'
    });

    // Rotation in degrees
    this.addParm('rotation', {
      value: 0,
      type: 'slider',
      params: { min: -180, max: 180, step: 0.1 },
      displayName: 'Rotation'
    });

    // Letter spacing (tracking)
    this.addParm('letterSpacing', {
      value: 0,
      type: 'slider',
      params: { min: -50, max: 100, step: 0.5 },
      displayName: 'Letter Spacing'
    });

    // Line height multiplier
    this.addParm('lineHeight', {
      value: 1.2,
      type: 'slider',
      params: { min: 0.5, max: 3.0, step: 0.05 },
      displayName: 'Line Height'
    });

    // Opacity
    this.addParm('opacity', {
      value: 1.0,
      type: 'slider',
      params: { min: 0, max: 1, step: 0.01 },
      displayName: 'Opacity'
    });

    this.output = this.out('image');

    // Watch all properties for changes (resolution is handled by addResolutionParm)
    const propNames = [
      'text', 'font', 'fontSize', 'fontWeight', 'fontStyle',
      'alignH', 'alignV', 'color', 'backgroundColor',
      'offset', 'rotation', 'letterSpacing', 'lineHeight', 'opacity'
    ];
    propNames.forEach(prop => this.watchProp(prop, () => this.requestCook()));

    this.onReady = () => this.requestCook();
  }

  protected render(): void {
    const [width, height] = this.getResolution();
    const text = this.props.text.value as string;
    const font = this.props.font.value as string;
    const fontSize = this.props.fontSize.value as number;
    const fontWeight = this.props.fontWeight.value as string;
    const fontStyle = this.props.fontStyle.value as string;
    const alignH = this.props.alignH.value as string;
    const alignV = this.props.alignV.value as string;
    const color = normalizeColor(this.props.color.value);
    const bgColor = normalizeColor(this.props.backgroundColor.value);
    const [offsetX, offsetY] = this.props.offset.value;
    const rotation = this.props.rotation.value as number;
    const letterSpacing = this.props.letterSpacing.value as number;
    const lineHeight = this.props.lineHeight.value as number;
    const opacity = this.props.opacity.value as number;

    // Use the current host's Canvas 2D surface.
    const canvas = createSurface(width, height);
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
    if (!ctx) {
      this.setOutput(this.output, ImageBuffer.rgba(width, height));
      return;
    }

    // Fill background
    if (bgColor.a > 0) {
      ctx.fillStyle = colorToCss(bgColor);
      ctx.fillRect(0, 0, width, height);
    } else {
      // Transparent background
      ctx.clearRect(0, 0, width, height);
    }

    // Set up text rendering
    ctx.save();

    // Apply global alpha for opacity
    ctx.globalAlpha = opacity;

    // Build font string
    const fontString = `${fontStyle} ${fontWeight} ${fontSize}px ${font}`;
    ctx.font = fontString;
    ctx.fillStyle = colorToCss(color);

    // Calculate text metrics for multiline
    const lines = text.split('\n');
    const lineHeightPx = fontSize * lineHeight;
    const totalTextHeight = lines.length * lineHeightPx;

    // Calculate anchor point based on alignment
    let anchorX: number;
    let anchorY: number;

    switch (alignH) {
      case 'left':
        ctx.textAlign = 'left';
        anchorX = 0;
        break;
      case 'right':
        ctx.textAlign = 'right';
        anchorX = width;
        break;
      case 'center':
      default:
        ctx.textAlign = 'center';
        anchorX = width / 2;
        break;
    }

    switch (alignV) {
      case 'top':
        anchorY = fontSize; // Baseline offset
        break;
      case 'bottom':
        anchorY = height - totalTextHeight + fontSize;
        break;
      case 'middle':
      default:
        anchorY = (height - totalTextHeight) / 2 + fontSize;
        break;
    }

    // Apply offset
    anchorX += offsetX;
    anchorY += offsetY;

    // Apply rotation around anchor point
    if (rotation !== 0) {
      const rotationRad = (rotation * Math.PI) / 180;
      ctx.translate(anchorX, anchorY - fontSize / 2 + totalTextHeight / 2);
      ctx.rotate(rotationRad);
      ctx.translate(-anchorX, -(anchorY - fontSize / 2 + totalTextHeight / 2));
    }

    // Render each line
    if (letterSpacing !== 0) {
      // Manual letter spacing - render character by character
      ctx.textAlign = 'left';
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const y = anchorY + i * lineHeightPx;

        // Calculate line width for alignment
        let lineWidth = 0;
        for (const char of line) {
          lineWidth += ctx.measureText(char).width + letterSpacing;
        }
        lineWidth -= letterSpacing; // Remove trailing spacing

        // Calculate starting X based on alignment
        let x: number;
        switch (alignH) {
          case 'left':
            x = anchorX;
            break;
          case 'right':
            x = anchorX - lineWidth;
            break;
          case 'center':
          default:
            x = anchorX - lineWidth / 2;
            break;
        }

        // Render each character
        for (const char of line) {
          ctx.fillText(char, x, y);
          x += ctx.measureText(char).width + letterSpacing;
        }
      }
    } else {
      // Standard text rendering (faster)
      for (let i = 0; i < lines.length; i++) {
        const y = anchorY + i * lineHeightPx;
        ctx.fillText(lines[i], anchorX, y);
      }
    }

    ctx.restore();

    // Convert canvas to ImageBuffer
    const buffer = ImageBuffer.fromCanvas(canvas);
    this.setOutput(this.output, buffer);
  }
}
