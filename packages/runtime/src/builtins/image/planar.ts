import type { ImagePixels } from "@cascade/contracts";

/**
 * The working image of the `cascade.image.*` nodes: one Float32Array per
 * channel, 0..1, one, three or four channels.
 *
 * Ported from the class library's `ImageBuffer` with the canvas half left out.
 * The arithmetic is kept exactly — the same Float32 stores, the same 1/255
 * conversion in and the same round-and-clamp out — because the port is held to
 * the class nodes' golden images pixel for pixel
 * (`tests/fixtures/image-golden`). Between nodes an image travels as 8-bit
 * RGBA (`ImagePixels`, see "How an image travels between nodes"), so a value
 * becomes a `Planar` when a node reads it and 8-bit again when it writes.
 */
export class Planar {
  readonly width: number;
  readonly height: number;
  readonly channels: Float32Array[];

  constructor(width: number, height: number, channels: Float32Array[]) {
    pixelCount(width, height);
    this.width = width;
    this.height = height;
    this.channels = channels;
  }

  static grayscale(width: number, height: number): Planar {
    return new Planar(width, height, [new Float32Array(pixelCount(width, height))]);
  }

  static rgba(width: number, height: number): Planar {
    const size = pixelCount(width, height);
    return new Planar(width, height, [
      new Float32Array(size),
      new Float32Array(size),
      new Float32Array(size),
      new Float32Array(size),
    ]);
  }

  /** From 8-bit RGBA, unpremultiplied. */
  static fromPixels(pixels: ImagePixels): Planar {
    const { width, height, data } = pixels;
    const size = width * height;
    const r = new Float32Array(size);
    const g = new Float32Array(size);
    const b = new Float32Array(size);
    const a = new Float32Array(size);
    const inv255 = 1 / 255;
    for (let i = 0; i < size; i++) {
      const idx = i * 4;
      r[i] = data[idx]! * inv255;
      g[i] = data[idx + 1]! * inv255;
      b[i] = data[idx + 2]! * inv255;
      a[i] = data[idx + 3]! * inv255;
    }
    return new Planar(width, height, [r, g, b, a]);
  }

  static solid(width: number, height: number, color: RGBA): Planar {
    const buffer = Planar.rgba(width, height);
    buffer.fill(0, color.r);
    buffer.fill(1, color.g);
    buffer.fill(2, color.b);
    buffer.fill(3, color.a ?? 1);
    return buffer;
  }

  get channelCount(): number {
    return this.channels.length;
  }

  get pixelCount(): number {
    return this.width * this.height;
  }

  fill(channel: number, value: number): void {
    this.channels[channel]!.fill(value);
  }

  clone(): Planar {
    return new Planar(this.width, this.height, this.channels.map((channel) => new Float32Array(channel)));
  }

  emptyClone(): Planar {
    return new Planar(this.width, this.height, this.channels.map(() => new Float32Array(this.pixelCount)));
  }

  toRGBA(): Planar {
    if (this.channels.length >= 4) return this.clone();
    const result = Planar.rgba(this.width, this.height);
    const [r, g = r, b = r] = this.channels.length === 1 ? [this.channels[0]!] : this.channels;
    result.channels[0]!.set(r!);
    result.channels[1]!.set(g!);
    result.channels[2]!.set(b!);
    result.channels[3]!.fill(1);
    return result;
  }

  /** To 8-bit RGBA: a grey image fills red, green and blue, and no alpha is opaque. */
  toPixels(): ImagePixels {
    const size = this.pixelCount;
    const data = new Uint8ClampedArray(size * 4);
    const r = this.channels[0]!;
    const g = this.channels.length > 1 ? this.channels[1]! : r;
    const b = this.channels.length > 2 ? this.channels[2]! : r;
    const a = this.channels.length > 3 ? this.channels[3]! : null;
    for (let i = 0; i < size; i++) {
      const idx = i << 2;
      let v = (r[i]! * 255 + 0.5) | 0;
      data[idx] = v < 0 ? 0 : v > 255 ? 255 : v;
      v = (g[i]! * 255 + 0.5) | 0;
      data[idx + 1] = v < 0 ? 0 : v > 255 ? 255 : v;
      v = (b[i]! * 255 + 0.5) | 0;
      data[idx + 2] = v < 0 ? 0 : v > 255 ? 255 : v;
      if (a) {
        v = (a[i]! * 255 + 0.5) | 0;
        data[idx + 3] = v < 0 ? 0 : v > 255 ? 255 : v;
      } else {
        data[idx + 3] = 255;
      }
    }
    return { width: this.width, height: this.height, data };
  }

  /** Bilinear, clamped at the edges (or wrapped). */
  sample(x: number, y: number, channel = 0, wrap = false): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const ch = this.channels[channel]!;
    const w = this.width;
    const h = this.height;
    const px0 = edge(x0, w, wrap);
    const px1 = edge(x0 + 1, w, wrap);
    const py0 = edge(y0, h, wrap);
    const py1 = edge(y0 + 1, h, wrap);
    const v0 = ch[py0 * w + px0]! * (1 - fx) + ch[py0 * w + px1]! * fx;
    const v1 = ch[py1 * w + px0]! * (1 - fx) + ch[py1 * w + px1]! * fx;
    return v0 * (1 - fy) + v1 * fy;
  }
}

export interface RGBA {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a?: number;
}

function edge(coord: number, max: number, wrap: boolean): number {
  return wrap ? ((coord % max) + max) % max : Math.max(0, Math.min(max - 1, coord));
}

function pixelCount(width: number, height: number): number {
  const count = width * height;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    !Number.isSafeInteger(count)
  ) {
    throw new RangeError(`Image dimensions must be positive safe integers; received ${width}×${height}`);
  }
  return count;
}

/** A plain resample to a new size, every channel, opaque when there was no alpha. */
export function resample(source: Planar, width: number, height: number): Planar {
  const result = Planar.rgba(width, height);
  const scaleX = source.width / width;
  const scaleY = source.height / height;
  for (let c = 0; c < Math.min(source.channelCount, 4); c++) {
    const dst = result.channels[c]!;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        dst[y * width + x] = source.sample(x * scaleX, y * scaleY, c);
      }
    }
  }
  if (source.channelCount < 4) result.fill(3, 1);
  return result;
}

export type ResolutionMode = "input" | "input1" | "input2" | "largest" | "smallest" | "custom";
export type FitMode = "fill" | "fit" | "stretch" | "native";

/** Which input decides the output size. */
export function resolveOutputSize(
  mode: ResolutionMode,
  inputs: readonly (Planar | null)[],
  customSize?: readonly [number, number],
): { width: number; height: number } {
  const valid = inputs.filter((buffer): buffer is Planar => buffer !== null);
  const area = (buffer: Planar) => buffer.width * buffer.height;
  switch (mode) {
    case "input":
    case "input1":
      if (valid[0]) return { width: valid[0].width, height: valid[0].height };
      break;
    case "input2": {
      const chosen = valid[1] ?? valid[0];
      if (chosen) return { width: chosen.width, height: chosen.height };
      break;
    }
    case "largest":
    case "smallest":
      if (valid.length > 0) {
        let best = valid[0]!;
        let bestArea = mode === "largest" ? 0 : Infinity;
        for (const buffer of valid) {
          if (mode === "largest" ? area(buffer) > bestArea : area(buffer) < bestArea) {
            bestArea = area(buffer);
            best = buffer;
          }
        }
        return { width: best.width, height: best.height };
      }
      break;
    case "custom":
      if (customSize) return { width: customSize[0], height: customSize[1] };
      break;
  }
  if (valid[0]) return { width: valid[0].width, height: valid[0].height };
  return { width: 512, height: 512 };
}

/**
 * Fit an image to a size: `fill` crops, `fit` letterboxes, `stretch` distorts,
 * `native` centres it at 1:1.
 */
export function resizeToFit(source: Planar, targetWidth: number, targetHeight: number, fitMode: FitMode = "fill"): Planar {
  if (source.width === targetWidth && source.height === targetHeight) return source;
  const result = Planar.rgba(targetWidth, targetHeight);
  const srcAspect = source.width / source.height;
  const dstAspect = targetWidth / targetHeight;
  let srcX = 0, srcY = 0, srcW = source.width, srcH = source.height;
  let dstX = 0, dstY = 0, dstW = targetWidth, dstH = targetHeight;
  const black = () => {
    result.fill(0, 0);
    result.fill(1, 0);
    result.fill(2, 0);
    result.fill(3, 1);
  };
  switch (fitMode) {
    case "fill":
      if (srcAspect > dstAspect) {
        srcW = Math.round(source.height * dstAspect);
        srcX = Math.round((source.width - srcW) / 2);
      } else {
        srcH = Math.round(source.width / dstAspect);
        srcY = Math.round((source.height - srcH) / 2);
      }
      break;
    case "fit":
      if (srcAspect > dstAspect) {
        dstH = Math.round(targetWidth / srcAspect);
        dstY = Math.round((targetHeight - dstH) / 2);
      } else {
        dstW = Math.round(targetHeight * srcAspect);
        dstX = Math.round((targetWidth - dstW) / 2);
      }
      black();
      break;
    case "stretch":
      break;
    case "native":
      dstW = Math.min(source.width, targetWidth);
      dstH = Math.min(source.height, targetHeight);
      srcW = dstW;
      srcH = dstH;
      dstX = Math.round((targetWidth - dstW) / 2);
      dstY = Math.round((targetHeight - dstH) / 2);
      srcX = Math.round((source.width - srcW) / 2);
      srcY = Math.round((source.height - srcH) / 2);
      black();
      break;
  }
  const scaleX = srcW / dstW;
  const scaleY = srcH / dstH;
  for (let c = 0; c < Math.min(source.channelCount, 4); c++) {
    const dst = result.channels[c]!;
    for (let y = 0; y < dstH; y++) {
      for (let x = 0; x < dstW; x++) {
        dst[(dstY + y) * targetWidth + (dstX + x)] = source.sample(srcX + x * scaleX, srcY + y * scaleY, c);
      }
    }
  }
  if (source.channelCount < 4 && fitMode !== "fit" && fitMode !== "native") {
    const alpha = result.channels[3]!;
    for (let y = 0; y < dstH; y++) {
      for (let x = 0; x < dstW; x++) alpha[(dstY + y) * targetWidth + (dstX + x)] = 1;
    }
  }
  return result;
}
