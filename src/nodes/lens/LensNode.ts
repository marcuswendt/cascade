/**
 * LensNode - Base class for all image processing nodes
 * Provides common utilities for canvas, image, and pixel manipulation
 */

import { Node } from '@/core/engine/Node';
import type { Graph } from '@/core/engine/Graph';

export type ImageInput = HTMLCanvasElement | HTMLImageElement | null;

export abstract class LensNode extends Node {
  constructor(id: string, type: string, graph: Graph) {
    super(id, type, graph);
  }

  // ============ Image Size Utilities ============

  /**
   * Get dimensions from an image or canvas
   */
  protected getImageSize(img: ImageInput): { width: number; height: number } {
    if (img instanceof HTMLCanvasElement) {
      return { width: img.width, height: img.height };
    } else if (img instanceof HTMLImageElement) {
      return {
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height
      };
    }
    return { width: 0, height: 0 };
  }

  // ============ Canvas Creation ============

  /**
   * Create a canvas with specified dimensions
   */
  protected createCanvas(width: number, height: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  // ============ Image Data Utilities ============

  /**
   * Get ImageData from an image, optionally resized to target dimensions
   */
  protected getImageData(
    img: ImageInput,
    targetWidth?: number,
    targetHeight?: number
  ): ImageData | null {
    if (!img) return null;

    const { width: srcWidth, height: srcHeight } = this.getImageSize(img);
    if (srcWidth === 0 || srcHeight === 0) return null;

    const width = targetWidth ?? srcWidth;
    const height = targetHeight ?? srcHeight;

    const tempCanvas = this.createCanvas(width, height);
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return null;

    tempCtx.drawImage(img, 0, 0, srcWidth, srcHeight, 0, 0, width, height);
    return tempCtx.getImageData(0, 0, width, height);
  }

  /**
   * Create a canvas from ImageData
   */
  protected putImageData(imageData: ImageData): HTMLCanvasElement {
    const canvas = this.createCanvas(imageData.width, imageData.height);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.putImageData(imageData, 0, 0);
    }
    return canvas;
  }

  // ============ Color Utilities ============

  /**
   * Convert a normalized color object to CSS string
   */
  protected colorToCss(color: { r: number; g: number; b: number; a?: number }): string {
    const r = Math.round(color.r * 255);
    const g = Math.round(color.g * 255);
    const b = Math.round(color.b * 255);
    const a = color.a !== undefined ? color.a : 1.0;
    return a < 1.0 ? `rgba(${r},${g},${b},${a})` : `rgb(${r},${g},${b})`;
  }

  /**
   * Normalize color values to 0-1 range
   * Handles both object {r,g,b,a} and array [r,g,b,a] formats
   * Auto-detects if values are already normalized (0-1) or need conversion (0-255)
   */
  protected normalizeColor(color: any): { r: number; g: number; b: number; a: number } {
    // Handle object format
    if (typeof color === 'object' && color !== null && 'r' in color) {
      const isNormalized = color.r <= 1.0 && color.g <= 1.0 && color.b <= 1.0;
      return {
        r: isNormalized ? color.r : color.r / 255,
        g: isNormalized ? color.g : color.g / 255,
        b: isNormalized ? color.b : color.b / 255,
        a: color.a !== undefined ? (isNormalized ? color.a : color.a / 255) : 1.0
      };
    }
    // Handle array format
    if (Array.isArray(color)) {
      const isNormalized = color.every(v => v <= 1.0);
      return {
        r: isNormalized ? color[0] : color[0] / 255,
        g: isNormalized ? color[1] : color[1] / 255,
        b: isNormalized ? color[2] : color[2] / 255,
        a: color[3] !== undefined ? (isNormalized ? color[3] : color[3] / 255) : 1.0
      };
    }
    return { r: 0, g: 0, b: 0, a: 1.0 };
  }

  // ============ Drawing Utilities ============

  /**
   * Draw an image onto a canvas context, optionally scaled
   */
  protected drawImage(
    ctx: CanvasRenderingContext2D,
    img: ImageInput,
    x = 0,
    y = 0,
    width?: number,
    height?: number
  ): void {
    if (!img) return;
    const { width: srcW, height: srcH } = this.getImageSize(img);
    ctx.drawImage(img, 0, 0, srcW, srcH, x, y, width ?? srcW, height ?? srcH);
  }

  /**
   * Set output and preview from a canvas
   * Common pattern used by most image processing nodes
   */
  protected setOutputAndPreview(
    output: { setValue: (value: HTMLCanvasElement) => void },
    canvas: HTMLCanvasElement
  ): void {
    output.setValue(canvas);
    this.preview = canvas;
  }
}
