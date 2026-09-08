/**
 * ImageNodeBase - Base class for all image processing nodes
 *
 * Provides utilities for working with ImageBuffer - the high-performance
 * planar Float32Array image format used throughout the image library.
 */

import { Node } from '@/nodes/Node';
import type { Graph } from '@/nodes/Graph';
import { ImageBuffer, hasPixels, type ImageSourceLike } from './ImageBuffer';
import { surfaceAvailable } from './surface.js';

// Accept buffers and browser/headless drawable objects for compatibility.
export type ImageInput = ImageBuffer | ImageSourceLike | null;

function previewWanted(): boolean {
  return typeof document !== 'undefined' && surfaceAvailable();
}

// Resolution modes for output
export type ResolutionMode = 'input' | 'input1' | 'input2' | 'largest' | 'smallest' | 'custom';

// Fit modes for resizing inputs to match output
export type FitMode = 'fill' | 'fit' | 'stretch' | 'native';

export abstract class ImageNodeBase extends Node {
  // Preview update throttling
  private _previewPending = false;
  private _previewBuffer: ImageBuffer | null = null;
  private _lastPreviewTime = 0;
  private static readonly PREVIEW_INTERVAL = 33; // ~30fps

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
   * Helper for onChange handlers - marks dirty for lazy evaluation
   * Execution is deferred until output is requested by a consumer (Viewer, etc.)
   */
  protected requestCook(): void {
    this.markDirty();
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

    if (hasPixels(input)) {
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

    if (hasPixels(input)) {
      const natural = input as { naturalWidth?: number; naturalHeight?: number };
      return {
        width: natural.naturalWidth || input.width,
        height: natural.naturalHeight || input.height
      };
    }

    return { width: 0, height: 0 };
  }

  // ============ Resolution Utilities ============

  /**
   * Add the standard resolution parameter used by generator nodes
   * Call this in setup() to add a resolution parameter with automatic cooking
   */
  protected addResolutionParm(defaultWidth = 512, defaultHeight = 512): void {
    this.addParm('resolution', {
      value: [defaultWidth, defaultHeight],
      params: {
        min: [1, 1],
        max: [4096, 4096],
        integer: true
      },
      displayName: 'Resolution',
      onChange: () => this.requestCook()
    });
  }

  /**
   * Get the current resolution from the resolution parameter
   * Returns [width, height] tuple
   * Requires addResolutionParm() to have been called in setup()
   */
  protected getResolution(): [number, number] {
    if (!this.props.resolution) {
      console.warn(`${this.type}: getResolution() called but no resolution parameter exists. Call addResolutionParm() in setup().`);
      return [512, 512];
    }
    return this.props.resolution.value as [number, number];
  }

  /**
   * Determine output resolution based on mode and inputs
   */
  protected resolveOutputSize(
    mode: ResolutionMode,
    inputs: (ImageBuffer | null)[],
    customSize?: [number, number]
  ): { width: number; height: number } {
    const validInputs = inputs.filter((b): b is ImageBuffer => b !== null);

    switch (mode) {
      case 'input':
      case 'input1':
        if (validInputs[0]) {
          return { width: validInputs[0].width, height: validInputs[0].height };
        }
        break;
      case 'input2':
        if (validInputs[1]) {
          return { width: validInputs[1].width, height: validInputs[1].height };
        } else if (validInputs[0]) {
          return { width: validInputs[0].width, height: validInputs[0].height };
        }
        break;
      case 'largest':
        if (validInputs.length > 0) {
          let maxArea = 0;
          let largest = validInputs[0];
          for (const buf of validInputs) {
            const area = buf.width * buf.height;
            if (area > maxArea) {
              maxArea = area;
              largest = buf;
            }
          }
          return { width: largest.width, height: largest.height };
        }
        break;
      case 'smallest':
        if (validInputs.length > 0) {
          let minArea = Infinity;
          let smallest = validInputs[0];
          for (const buf of validInputs) {
            const area = buf.width * buf.height;
            if (area < minArea) {
              minArea = area;
              smallest = buf;
            }
          }
          return { width: smallest.width, height: smallest.height };
        }
        break;
      case 'custom':
        if (customSize) {
          return { width: customSize[0], height: customSize[1] };
        }
        break;
    }

    // Fallback to first valid input or default
    if (validInputs[0]) {
      return { width: validInputs[0].width, height: validInputs[0].height };
    }
    return { width: 512, height: 512 };
  }

  /**
   * Resize a buffer to fit target dimensions using the specified fit mode
   *
   * Fit modes:
   * - 'fill': Scale to fill entire target, cropping if necessary (no letterboxing)
   * - 'fit': Scale to fit within target, maintaining aspect ratio (may letterbox)
   * - 'stretch': Stretch to exactly match target dimensions (may distort)
   * - 'native': Use original size, centered in target (may crop or have empty space)
   */
  protected resizeToFit(
    source: ImageBuffer,
    targetWidth: number,
    targetHeight: number,
    fitMode: FitMode = 'fill'
  ): ImageBuffer {
    // Early return if dimensions already match
    if (source.width === targetWidth && source.height === targetHeight) {
      return source;
    }

    const result = ImageBuffer.rgba(targetWidth, targetHeight);
    const srcAspect = source.width / source.height;
    const dstAspect = targetWidth / targetHeight;

    let srcX = 0, srcY = 0, srcW = source.width, srcH = source.height;
    let dstX = 0, dstY = 0, dstW = targetWidth, dstH = targetHeight;

    switch (fitMode) {
      case 'fill':
        // Scale to fill, cropping source if necessary
        if (srcAspect > dstAspect) {
          // Source is wider - crop sides
          srcW = Math.round(source.height * dstAspect);
          srcX = Math.round((source.width - srcW) / 2);
        } else {
          // Source is taller - crop top/bottom
          srcH = Math.round(source.width / dstAspect);
          srcY = Math.round((source.height - srcH) / 2);
        }
        break;

      case 'fit':
        // Scale to fit within bounds (letterbox)
        if (srcAspect > dstAspect) {
          // Source is wider - pillarbox
          dstH = Math.round(targetWidth / srcAspect);
          dstY = Math.round((targetHeight - dstH) / 2);
        } else {
          // Source is taller - letterbox
          dstW = Math.round(targetHeight * srcAspect);
          dstX = Math.round((targetWidth - dstW) / 2);
        }
        // Fill result with black first for letterbox areas
        result.fill(0, 0);
        result.fill(1, 0);
        result.fill(2, 0);
        result.fill(3, 1);
        break;

      case 'stretch':
        // Just use full src and dst - will stretch
        break;

      case 'native':
        // Center source in target at 1:1 scale
        dstW = Math.min(source.width, targetWidth);
        dstH = Math.min(source.height, targetHeight);
        srcW = dstW;
        srcH = dstH;
        dstX = Math.round((targetWidth - dstW) / 2);
        dstY = Math.round((targetHeight - dstH) / 2);
        srcX = Math.round((source.width - srcW) / 2);
        srcY = Math.round((source.height - srcH) / 2);
        // Fill with black for areas outside source
        result.fill(0, 0);
        result.fill(1, 0);
        result.fill(2, 0);
        result.fill(3, 1);
        break;
    }

    // Perform the resize/copy using bilinear interpolation
    const scaleX = srcW / dstW;
    const scaleY = srcH / dstH;

    for (let c = 0; c < Math.min(source.channelCount, 4); c++) {
      const dstChannel = result.channels[c];

      for (let y = 0; y < dstH; y++) {
        for (let x = 0; x < dstW; x++) {
          const sx = srcX + x * scaleX;
          const sy = srcY + y * scaleY;
          dstChannel[(dstY + y) * targetWidth + (dstX + x)] = source.sample(sx, sy, c);
        }
      }
    }

    // Fill alpha if source doesn't have it
    if (source.channelCount < 4 && fitMode !== 'fit' && fitMode !== 'native') {
      for (let y = 0; y < dstH; y++) {
        for (let x = 0; x < dstW; x++) {
          result.channels[3][(dstY + y) * targetWidth + (dstX + x)] = 1;
        }
      }
    }

    return result;
  }

  /**
   * Prepare multiple inputs to have matching dimensions
   * Returns buffers resized to the output resolution
   */
  protected prepareInputs(
    inputs: (ImageInput)[],
    resolutionMode: ResolutionMode = 'input',
    fitMode: FitMode = 'fill',
    customSize?: [number, number]
  ): { buffers: (ImageBuffer | null)[]; width: number; height: number } {
    // Convert all inputs to ImageBuffers
    const buffers = inputs.map(input => this.toImageBuffer(input));

    // Determine output resolution
    const { width, height } = this.resolveOutputSize(resolutionMode, buffers, customSize);

    // Resize all buffers to match output
    const resized = buffers.map(buf => {
      if (!buf) return null;
      if (buf.width === width && buf.height === height) return buf;
      return this.resizeToFit(buf, width, height, fitMode);
    });

    return { buffers: resized, width, height };
  }

  // ============ Output Utilities ============

  /**
   * Set output value and preview from an ImageBuffer
   * This is the standard way to output from an image node
   * Preview updates are throttled to ~30fps to avoid excessive canvas conversions
   */
  public setOutput(
    output: { setValue: (value: ImageBuffer) => void },
    buffer: ImageBuffer
  ): void {
    output.setValue(buffer);
    this._previewBuffer = buffer;
    this.updatePreviewThrottled();
  }

  /** Throttled Studio-only preview update. */
  private updatePreviewThrottled(): void {
    if (!previewWanted()) return;
    const now = performance.now();
    const elapsed = now - this._lastPreviewTime;

    if (elapsed >= ImageNodeBase.PREVIEW_INTERVAL) {
      // Enough time has passed, update immediately
      this._lastPreviewTime = now;
      if (this._previewBuffer) {
        this.preview = this._previewBuffer.toCanvas();
      }
      this._previewPending = false;
    } else if (!this._previewPending) {
      // Schedule an update
      this._previewPending = true;
      const remaining = ImageNodeBase.PREVIEW_INTERVAL - elapsed;
      setTimeout(() => {
        this._previewPending = false;
        this._lastPreviewTime = performance.now();
        if (this._previewBuffer && previewWanted()) {
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

}

// Re-export ImageBuffer for convenience
export { ImageBuffer };
