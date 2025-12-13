/**
 * ImageBuffer - High-performance image data container
 *
 * Uses planar Float32Array storage for efficient processing:
 * - Each channel is a separate contiguous array
 * - Supports 1 channel (grayscale), 3 channels (RGB), or 4 channels (RGBA)
 * - Float32 allows HDR values and avoids clamping during intermediate operations
 * - Lazy canvas conversion - only creates HTMLCanvasElement when needed for display
 */

export type ColorSpace = 'linear' | 'srgb';
export type ChannelLayout = 'gray' | 'rgb' | 'rgba';

// Global buffer tracking for memory statistics
let globalBufferCount = 0;
let globalBufferMemory = 0;

export class ImageBuffer {
  // Static methods for global tracking
  static get totalBufferCount(): number { return globalBufferCount; }
  static get totalMemoryBytes(): number { return globalBufferMemory; }
  static get totalMemoryMB(): number { return globalBufferMemory / (1024 * 1024); }
  readonly width: number;
  readonly height: number;
  readonly channels: Float32Array[];
  readonly colorSpace: ColorSpace;

  // Cached data for display - invalidated when data changes
  private _canvas: HTMLCanvasElement | null = null;
  private _imageData: ImageData | null = null;
  private _dirty: boolean = true;
  private _disposed: boolean = false;

  // Instance memory tracking
  private readonly _memoryBytes: number;

  private constructor(
    width: number,
    height: number,
    channels: Float32Array[],
    colorSpace: ColorSpace = 'srgb'
  ) {
    this.width = width;
    this.height = height;
    this.channels = channels;
    this.colorSpace = colorSpace;

    // Calculate and track memory usage (Float32 = 4 bytes per element)
    this._memoryBytes = channels.reduce((sum, ch) => sum + ch.byteLength, 0);
    globalBufferCount++;
    globalBufferMemory += this._memoryBytes;
  }

  /**
   * Get memory usage of this buffer in bytes
   */
  get memoryBytes(): number {
    return this._memoryBytes;
  }

  /**
   * Get memory usage in human-readable format
   */
  get memorySizeStr(): string {
    const bytes = this._memoryBytes;
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
  }

  /**
   * Dispose of this buffer and free memory tracking
   * Note: The actual memory is freed by GC, this just updates tracking
   */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    globalBufferCount--;
    globalBufferMemory -= this._memoryBytes;
    this._canvas = null;
    this._imageData = null;
  }

  get isDisposed(): boolean {
    return this._disposed;
  }

  // ============ Factory Methods ============

  /**
   * Create a grayscale (single channel) buffer
   */
  static grayscale(width: number, height: number): ImageBuffer {
    const size = width * height;
    return new ImageBuffer(width, height, [new Float32Array(size)]);
  }

  /**
   * Create an RGB (3 channel) buffer
   */
  static rgb(width: number, height: number): ImageBuffer {
    const size = width * height;
    return new ImageBuffer(width, height, [
      new Float32Array(size),
      new Float32Array(size),
      new Float32Array(size)
    ]);
  }

  /**
   * Create an RGBA (4 channel) buffer
   */
  static rgba(width: number, height: number): ImageBuffer {
    const size = width * height;
    return new ImageBuffer(width, height, [
      new Float32Array(size),
      new Float32Array(size),
      new Float32Array(size),
      new Float32Array(size)
    ]);
  }

  /**
   * Create from an HTMLCanvasElement or HTMLImageElement
   */
  static fromCanvas(source: HTMLCanvasElement | HTMLImageElement): ImageBuffer {
    let width: number, height: number;
    let canvas: HTMLCanvasElement;

    if (source instanceof HTMLImageElement) {
      width = source.naturalWidth || source.width;
      height = source.naturalHeight || source.height;
      canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(source, 0, 0);
    } else {
      width = source.width;
      height = source.height;
      canvas = source;
    }

    const ctx = canvas.getContext('2d')!;
    const imageData = ctx.getImageData(0, 0, width, height);
    return ImageBuffer.fromImageData(imageData);
  }

  /**
   * Create from ImageData (interleaved RGBA Uint8)
   */
  static fromImageData(imageData: ImageData): ImageBuffer {
    const { width, height, data } = imageData;
    const size = width * height;

    const r = new Float32Array(size);
    const g = new Float32Array(size);
    const b = new Float32Array(size);
    const a = new Float32Array(size);

    // Convert from interleaved Uint8 to planar Float32
    // Use multiplication instead of division (faster)
    const inv255 = 1 / 255;
    for (let i = 0; i < size; i++) {
      const idx = i * 4;
      r[i] = data[idx] * inv255;
      g[i] = data[idx + 1] * inv255;
      b[i] = data[idx + 2] * inv255;
      a[i] = data[idx + 3] * inv255;
    }

    return new ImageBuffer(width, height, [r, g, b, a]);
  }

  /**
   * Create a filled solid color buffer
   */
  static solid(width: number, height: number, color: { r: number; g: number; b: number; a?: number }): ImageBuffer {
    const buffer = ImageBuffer.rgba(width, height);
    buffer.fill(0, color.r);
    buffer.fill(1, color.g);
    buffer.fill(2, color.b);
    buffer.fill(3, color.a ?? 1);
    return buffer;
  }

  // ============ Properties ============

  get channelCount(): number {
    return this.channels.length;
  }

  get layout(): ChannelLayout {
    switch (this.channels.length) {
      case 1: return 'gray';
      case 3: return 'rgb';
      default: return 'rgba';
    }
  }

  get pixelCount(): number {
    return this.width * this.height;
  }

  // ============ Channel Access ============

  /**
   * Get a channel by index (0=R/Gray, 1=G, 2=B, 3=A)
   */
  getChannel(index: number): Float32Array {
    if (index < 0 || index >= this.channels.length) {
      throw new Error(`Channel index ${index} out of bounds (0-${this.channels.length - 1})`);
    }
    return this.channels[index];
  }

  /**
   * Get channel by name
   */
  r(): Float32Array { return this.channels[0]; }
  g(): Float32Array { return this.channels[Math.min(1, this.channels.length - 1)]; }
  b(): Float32Array { return this.channels[Math.min(2, this.channels.length - 1)]; }
  a(): Float32Array {
    return this.channels.length >= 4
      ? this.channels[3]
      : this.createOpaqueAlpha();
  }

  private createOpaqueAlpha(): Float32Array {
    const alpha = new Float32Array(this.pixelCount);
    alpha.fill(1);
    return alpha;
  }

  // ============ Pixel Access ============

  /**
   * Get pixel index from coordinates
   */
  index(x: number, y: number): number {
    return y * this.width + x;
  }

  /**
   * Get all channel values at a pixel
   */
  getPixel(x: number, y: number): number[] {
    const idx = this.index(x, y);
    return this.channels.map(ch => ch[idx]);
  }

  /**
   * Set all channel values at a pixel
   */
  setPixel(x: number, y: number, values: number[]): void {
    const idx = this.index(x, y);
    for (let c = 0; c < Math.min(values.length, this.channels.length); c++) {
      this.channels[c][idx] = values[c];
    }
    this._dirty = true;
  }

  /**
   * Get a single channel value at a pixel
   */
  getValue(x: number, y: number, channel: number = 0): number {
    return this.channels[channel][this.index(x, y)];
  }

  /**
   * Set a single channel value at a pixel
   */
  setValue(x: number, y: number, channel: number, value: number): void {
    this.channels[channel][this.index(x, y)] = value;
    this._dirty = true;
  }

  // ============ Bulk Operations ============

  /**
   * Fill a channel with a constant value
   */
  fill(channel: number, value: number): void {
    this.channels[channel].fill(value);
    this._dirty = true;
  }

  /**
   * Fill all channels
   */
  fillAll(values: number[]): void {
    for (let c = 0; c < this.channels.length; c++) {
      this.channels[c].fill(values[c] ?? 0);
    }
    this._dirty = true;
  }

  /**
   * Create a deep copy
   */
  clone(): ImageBuffer {
    const newChannels = this.channels.map(ch => new Float32Array(ch));
    return new ImageBuffer(this.width, this.height, newChannels, this.colorSpace);
  }

  /**
   * Create a copy with different dimensions (doesn't resize data)
   */
  emptyClone(): ImageBuffer {
    return new ImageBuffer(
      this.width,
      this.height,
      this.channels.map(() => new Float32Array(this.pixelCount)),
      this.colorSpace
    );
  }

  /**
   * Mark buffer as modified (invalidates canvas cache)
   */
  markDirty(): void {
    this._dirty = true;
  }

  // ============ Conversion ============

  /**
   * Convert to grayscale (luminance)
   */
  toGrayscale(): ImageBuffer {
    if (this.channels.length === 1) {
      return this.clone();
    }

    const result = ImageBuffer.grayscale(this.width, this.height);
    const gray = result.channels[0];
    const r = this.channels[0];
    const g = this.channels[1];
    const b = this.channels[2];

    // ITU-R BT.709 luminance coefficients
    for (let i = 0; i < this.pixelCount; i++) {
      gray[i] = 0.2126 * r[i] + 0.7152 * g[i] + 0.0722 * b[i];
    }

    return result;
  }

  /**
   * Convert grayscale to RGBA
   */
  toRGBA(): ImageBuffer {
    if (this.channels.length >= 4) {
      return this.clone();
    }

    const result = ImageBuffer.rgba(this.width, this.height);

    if (this.channels.length === 1) {
      // Grayscale to RGBA
      const gray = this.channels[0];
      result.channels[0].set(gray);
      result.channels[1].set(gray);
      result.channels[2].set(gray);
      result.channels[3].fill(1);
    } else if (this.channels.length === 3) {
      // RGB to RGBA
      result.channels[0].set(this.channels[0]);
      result.channels[1].set(this.channels[1]);
      result.channels[2].set(this.channels[2]);
      result.channels[3].fill(1);
    }

    return result;
  }

  /**
   * Convert to ImageData (for canvas rendering)
   * Cached - only rebuilds when dirty
   */
  toImageData(): ImageData {
    if (this._imageData && !this._dirty) {
      return this._imageData;
    }

    const imageData = new ImageData(this.width, this.height);
    const data = imageData.data;
    const size = this.pixelCount;

    const r = this.channels[0];
    const g = this.channels.length > 1 ? this.channels[1] : r;
    const b = this.channels.length > 2 ? this.channels[2] : r;
    const hasAlpha = this.channels.length > 3;
    const a = hasAlpha ? this.channels[3] : null;

    // Optimized loop: inline clamping, avoid repeated property access
    for (let i = 0; i < size; i++) {
      const idx = i << 2; // i * 4
      let v: number;

      // Red
      v = (r[i] * 255 + 0.5) | 0; // Fast round
      data[idx] = v < 0 ? 0 : v > 255 ? 255 : v;

      // Green
      v = (g[i] * 255 + 0.5) | 0;
      data[idx + 1] = v < 0 ? 0 : v > 255 ? 255 : v;

      // Blue
      v = (b[i] * 255 + 0.5) | 0;
      data[idx + 2] = v < 0 ? 0 : v > 255 ? 255 : v;

      // Alpha
      if (hasAlpha) {
        v = (a![i] * 255 + 0.5) | 0;
        data[idx + 3] = v < 0 ? 0 : v > 255 ? 255 : v;
      } else {
        data[idx + 3] = 255;
      }
    }

    this._imageData = imageData;
    return imageData;
  }

  /**
   * Convert to HTMLCanvasElement (cached)
   */
  toCanvas(): HTMLCanvasElement {
    if (this._canvas && !this._dirty) {
      return this._canvas;
    }

    if (!this._canvas) {
      this._canvas = document.createElement('canvas');
      this._canvas.width = this.width;
      this._canvas.height = this.height;
    }

    const ctx = this._canvas.getContext('2d')!;
    ctx.putImageData(this.toImageData(), 0, 0);
    this._dirty = false;

    return this._canvas;
  }

  // ============ Utility ============

  /**
   * Check if coordinates are within bounds
   */
  inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  /**
   * Get coordinate with edge handling
   */
  wrapCoord(coord: number, max: number, wrap: boolean): number {
    if (wrap) {
      return ((coord % max) + max) % max;
    }
    return Math.max(0, Math.min(max - 1, coord));
  }

  /**
   * Sample with bilinear interpolation
   */
  sample(x: number, y: number, channel: number = 0, wrap: boolean = false): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = x0 + 1;
    const y1 = y0 + 1;
    const fx = x - x0;
    const fy = y - y0;

    const ch = this.channels[channel];
    const w = this.width;
    const h = this.height;

    const px0 = this.wrapCoord(x0, w, wrap);
    const px1 = this.wrapCoord(x1, w, wrap);
    const py0 = this.wrapCoord(y0, h, wrap);
    const py1 = this.wrapCoord(y1, h, wrap);

    const v00 = ch[py0 * w + px0];
    const v10 = ch[py0 * w + px1];
    const v01 = ch[py1 * w + px0];
    const v11 = ch[py1 * w + px1];

    // Bilinear interpolation
    const v0 = v00 * (1 - fx) + v10 * fx;
    const v1 = v01 * (1 - fx) + v11 * fx;
    return v0 * (1 - fy) + v1 * fy;
  }

  /**
   * Sample all channels with bilinear interpolation
   */
  samplePixel(x: number, y: number, wrap: boolean = false): number[] {
    return this.channels.map((_, c) => this.sample(x, y, c, wrap));
  }
}
