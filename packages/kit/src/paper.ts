// Paper: a sheet with low mottle, fine tooth and a soft vignette.
//
// This is the paper from the plotter HTML tool that commons ported for its
// plotter, pen-live and ripple nodes. It writes RGBA bytes, so it needs no
// canvas library: hand it any `ImageData`-shaped buffer, or a 2D context.

import { hexToSrgb } from './colour.js';
import { fbm2, valueNoise2 } from './noise.js';

export interface PaperOptions {
  /** paper colour as `#rrggbb` */
  colour: string;
  /** 0 = smooth, 1 = the tool's default tooth */
  grain: number;
  /** slides the noise, so each sheet (each boiled frame) is a different sheet */
  offset?: number;
  /** octaves of the low mottle (default 4) */
  octaves?: number;
  /** vignette strength at the corners (default 0.18) */
  vignette?: number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Fill an RGBA byte buffer of `width` x `height` with paper. Alpha is 255. */
export function paperPixels(data: Uint8ClampedArray, width: number, height: number, options: PaperOptions): void {
  const base = hexToSrgb(options.colour);
  const off = (options.offset ?? 0) % 997;
  const octaves = options.octaves ?? 4;
  const vignette = options.vignette ?? 0.18;
  const grain = options.grain;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const gx = x + 0.5 + off, gy = y + 0.5 + off * 1.3;
    const mottle = fbm2(gx * 0.012, gy * 0.012, octaves), fine = valueNoise2(gx * 0.85, gy * 0.85);
    const cx = (x + 0.5) / width - 0.5, cy = (y + 0.5) / height - 0.5, vig = 1 - (cx * cx + cy * cy) * vignette;
    const k = (y * width + x) * 4;
    for (let c = 0; c < 3; c++) data[k + c] = clamp01((base[c] * (0.965 + 0.06 * mottle) - (fine - 0.5) * 0.05 * grain) * vig) * 255;
    data[k + 3] = 255;
  }
}

/** The subset of a 2D context paper needs (browser, OffscreenCanvas or @napi-rs/canvas). */
export interface PixelContext {
  createImageData(width: number, height: number): { data: Uint8ClampedArray };
  getImageData(x: number, y: number, width: number, height: number): { data: Uint8ClampedArray };
  putImageData(image: any, x: number, y: number): void;
}

/** Paint a whole `width` x `height` context with paper. */
export function paperSheet(g: PixelContext, width: number, height: number, colour: string, grain: number, offset = 0): void {
  const img = g.createImageData(width, height);
  paperPixels(img.data, width, height, { colour, grain, offset });
  g.putImageData(img, 0, 0);
}
