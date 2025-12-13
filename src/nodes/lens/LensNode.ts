/**
 * LensNode - Base class for all image processing nodes
 *
 * Provides utilities for working with ImageBuffer - the high-performance
 * planar Float32Array image format used throughout the Lens library.
 */

import { Node } from '@/nodes/Node';
import type { Graph } from '@/nodes/Graph';
import { ImageBuffer } from './ImageBuffer';

// Accept ImageBuffer, canvas, or image as input (for backwards compatibility)
export type ImageInput = ImageBuffer | HTMLCanvasElement | HTMLImageElement | null;

export abstract class LensNode extends Node {
  // Preview update throttling
  private _previewPending = false;
  private _previewBuffer: ImageBuffer | null = null;
  private _lastPreviewTime = 0;
  private static readonly PREVIEW_INTERVAL = 33; // ~30fps

  // Execution scheduling
  private _executionScheduled = false;

  constructor(id: string, type: string, graph: Graph) {
    super(id, type, graph);
  }

  /**
   * Override onCook() to call the abstract render() method
   * Cook timing is handled by Node.execute()
   */
  protected onCook(): void | Promise<void> {
    return this.render();
  }

  /**
   * Abstract render method - subclasses implement their rendering logic here
   * Called by onCook() when the node needs to cook
   */
  protected abstract render(): void | Promise<void>;

  /**
   * Schedule execution on next microtask
   * Call this from onChange handlers instead of calling cook/render directly
   */
  protected scheduleExecution(): void {
    if (this._executionScheduled) return;
    this._executionScheduled = true;
    queueMicrotask(() => {
      this._executionScheduled = false;
      this.execute();
    });
  }

  /**
   * Helper for onChange handlers - marks dirty and schedules execution
   */
  protected requestCook(): void {
    this.markDirty();
    this.scheduleExecution();
  }

  // ============ ImageBuffer Utilities ============

  /**
   * Convert any image input to ImageBuffer
   * Returns null if input is null/invalid
   */
  protected toImageBuffer(input: ImageInput): ImageBuffer | null {
    if (!input) return null;

    if (input instanceof ImageBuffer) {
      return input;
    }

    if (input instanceof HTMLCanvasElement || input instanceof HTMLImageElement) {
      return ImageBuffer.fromCanvas(input);
    }

    return null;
  }

  /**
   * Get dimensions from any image input
   */
  protected getImageSize(input: ImageInput): { width: number; height: number } {
    if (!input) return { width: 0, height: 0 };

    if (input instanceof ImageBuffer) {
      return { width: input.width, height: input.height };
    }

    if (input instanceof HTMLCanvasElement) {
      return { width: input.width, height: input.height };
    }

    if (input instanceof HTMLImageElement) {
      return {
        width: input.naturalWidth || input.width,
        height: input.naturalHeight || input.height
      };
    }

    return { width: 0, height: 0 };
  }

  // ============ ImageBuffer Creation ============

  /**
   * Create a grayscale buffer
   */
  protected createGrayscale(width: number, height: number): ImageBuffer {
    return ImageBuffer.grayscale(width, height);
  }

  /**
   * Create an RGB buffer
   */
  protected createRGB(width: number, height: number): ImageBuffer {
    return ImageBuffer.rgb(width, height);
  }

  /**
   * Create an RGBA buffer
   */
  protected createRGBA(width: number, height: number): ImageBuffer {
    return ImageBuffer.rgba(width, height);
  }

  /**
   * Create a solid color buffer
   */
  protected createSolid(
    width: number,
    height: number,
    color: { r: number; g: number; b: number; a?: number }
  ): ImageBuffer {
    return ImageBuffer.solid(width, height, color);
  }

  // ============ Color Utilities ============

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

  // ============ Output Utilities ============

  /**
   * Set output value and preview from an ImageBuffer
   * This is the standard way to output from a Lens node
   * Preview updates are throttled to ~30fps to avoid excessive canvas conversions
   */
  protected setOutput(
    output: { setValue: (value: ImageBuffer) => void },
    buffer: ImageBuffer
  ): void {
    output.setValue(buffer);
    this._previewBuffer = buffer;
    this.updatePreviewThrottled();
  }

  /**
   * Throttled preview update - avoids excessive canvas conversions
   */
  private updatePreviewThrottled(): void {
    const now = performance.now();
    const elapsed = now - this._lastPreviewTime;

    if (elapsed >= LensNode.PREVIEW_INTERVAL) {
      // Enough time has passed, update immediately
      this._lastPreviewTime = now;
      if (this._previewBuffer) {
        this.preview = this._previewBuffer.toCanvas();
      }
      this._previewPending = false;
    } else if (!this._previewPending) {
      // Schedule an update
      this._previewPending = true;
      const remaining = LensNode.PREVIEW_INTERVAL - elapsed;
      setTimeout(() => {
        this._previewPending = false;
        this._lastPreviewTime = performance.now();
        if (this._previewBuffer) {
          this.preview = this._previewBuffer.toCanvas();
        }
      }, remaining);
    }
    // If pending, the scheduled update will handle it
  }

  // ============ Buffer Info (for debugging/monitoring) ============

  /**
   * Get info about the current output buffer
   */
  getBufferInfo(): {
    hasOutput: boolean;
    width: number;
    height: number;
    channels: number;
    layout: string;
    memoryBytes: number;
    memorySizeStr: string;
  } | null {
    if (!this._previewBuffer) {
      return null;
    }
    const buf = this._previewBuffer;
    return {
      hasOutput: true,
      width: buf.width,
      height: buf.height,
      channels: buf.channelCount,
      layout: buf.layout,
      memoryBytes: buf.memoryBytes,
      memorySizeStr: buf.memorySizeStr
    };
  }

  /**
   * Get global ImageBuffer statistics
   */
  static getGlobalBufferStats(): {
    totalBuffers: number;
    totalMemoryBytes: number;
    totalMemoryMB: number;
  } {
    return {
      totalBuffers: ImageBuffer.totalBufferCount,
      totalMemoryBytes: ImageBuffer.totalMemoryBytes,
      totalMemoryMB: ImageBuffer.totalMemoryMB
    };
  }
}

// Re-export ImageBuffer for convenience
export { ImageBuffer };
