import type { AssetCapability, CascadeAbortSignal, ImagePixels, ImageRef } from "@cascade/contracts";

import { Planar, type RGBA } from "./planar.js";

/**
 * How a `cascade.image.*` node reads and writes an image: the in-memory image
 * contract ("How an image travels between nodes" in doc/PROJECT_AUTHORING.md),
 * for built-ins that cannot import `cascade/image` (the runtime depends on
 * contracts alone).
 *
 * In: the host's pixels when it still holds them (`assets.imagePixels`), else
 * the stored bytes decoded with the realm's `createImageBitmap` and read back
 * off an `OffscreenCanvas`. Out: the pixels to `assets.keepImage` when the
 * host keeps images in memory (`cascade run`/`render`, Studio), else a PNG
 * through `assets.write` (an exported editor, the web player).
 */
export interface ImageNodeContext {
  readonly nodeId: string;
  readonly capabilities: { readonly assets?: AssetCapability };
  readonly signal: CascadeAbortSignal;
}

interface Bitmap {
  readonly width: number;
  readonly height: number;
  close?(): void;
}

export interface Context2D {
  fillStyle: unknown;
  font: string;
  textAlign: string;
  globalAlpha: number;
  fillRect(x: number, y: number, width: number, height: number): void;
  clearRect(x: number, y: number, width: number, height: number): void;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  drawImage(image: Bitmap, x: number, y: number): void;
  getImageData(x: number, y: number, width: number, height: number): { data: Uint8ClampedArray };
  putImageData(data: unknown, x: number, y: number): void;
}

interface Surface {
  readonly width: number;
  readonly height: number;
  getContext(kind: "2d", options?: { willReadFrequently?: boolean }): Context2D | null;
  convertToBlob(options?: { type?: string }): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
}

interface CanvasGlobals {
  OffscreenCanvas?: new (width: number, height: number) => Surface;
  createImageBitmap?: (source: unknown) => Promise<Bitmap>;
  ImageData?: new (data: Uint8ClampedArray, width: number, height: number) => unknown;
  Blob?: new (parts: unknown[]) => unknown;
}

const NO_CANVAS =
  "cascade.image: this host has no canvas. In a browser this needs OffscreenCanvas; headless, Cascade installs " +
  '@napi-rs/canvas before a run (install it with "npm install @napi-rs/canvas" if it is missing).';

/** The host's canvas, read here and nowhere else (see `cascade.geo.Render`). */
function canvasGlobals(): CanvasGlobals {
  return globalThis as CanvasGlobals;
}

/**
 * A CPU-backed 2D surface. `willReadFrequently` keeps a browser on the
 * software rasteriser the headless host also uses, as `cascade/image` does.
 */
export function surface(width: number, height: number): { canvas: Surface; context: Context2D } {
  const Canvas = canvasGlobals().OffscreenCanvas;
  if (!Canvas) throw new Error(NO_CANVAS);
  const canvas = new Canvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("cascade.image: the canvas has no 2D context");
  return { canvas, context };
}

function assetsOf(context: ImageNodeContext): AssetCapability {
  const assets = context.capabilities.assets;
  if (!assets) throw new Error(`${context.nodeId}: this host gives cascade.image nodes no assets capability`);
  return assets;
}

/** An image input, an asset or a project path, as the reference to read. */
export function imageReference(value: unknown): { path: string } | null {
  if (typeof value === "string") return value ? { path: value } : null;
  const path = (value as { path?: unknown } | null | undefined)?.path;
  return typeof path === "string" && path ? { path } : null;
}

/** Decode stored bytes to 8-bit RGBA through the realm's canvas. */
export async function decodePixels(bytes: Uint8Array): Promise<ImagePixels> {
  const globals = canvasGlobals();
  if (!globals.createImageBitmap || !globals.Blob) throw new Error(NO_CANVAS);
  const bitmap = await globals.createImageBitmap(new globals.Blob([bytes]));
  try {
    const { width, height } = bitmap;
    if (!width || !height) throw new Error("cascade.image: could not decode the image data");
    const { context } = surface(width, height);
    context.drawImage(bitmap, 0, 0);
    return { width, height, data: context.getImageData(0, 0, width, height).data };
  } finally {
    bitmap.close?.();
  }
}

/** A whole canvas's pixels. */
export function readPixelsFromCanvas(canvas: Surface): ImagePixels {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("cascade.image: the canvas has no 2D context");
  return { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data };
}

export async function readPixels(context: ImageNodeContext, ref: { path: string }): Promise<ImagePixels> {
  const assets = assetsOf(context);
  const kept = assets.imagePixels?.(ref);
  if (kept) return kept;
  return decodePixels(await assets.read(ref, { signal: context.signal }));
}

/** An image input as a `Planar`, or null when nothing is wired. */
export async function readPlanar(context: ImageNodeContext, value: unknown): Promise<Planar | null> {
  const ref = imageReference(value);
  return ref ? Planar.fromPixels(await readPixels(context, ref)) : null;
}

async function encodePng(pixels: ImagePixels): Promise<Uint8Array> {
  const globals = canvasGlobals();
  if (!globals.ImageData) throw new Error(NO_CANVAS);
  const { canvas, context } = surface(pixels.width, pixels.height);
  context.putImageData(new globals.ImageData(pixels.data, pixels.width, pixels.height), 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return new Uint8Array(await blob.arrayBuffer());
}

/** Store pixels as this node's image output and return the value to set. */
export async function writePixels(context: ImageNodeContext, pixels: ImagePixels): Promise<ImageRef> {
  const assets = assetsOf(context);
  const name = `${context.nodeId}.png`;
  const options = { signal: context.signal };
  const stored = assets.keepImage
    ? await assets.keepImage(pixels, { suggestedName: name }, options)
    : await assets.write(await encodePng(pixels), { mediaType: "image/png", suggestedName: name }, options);
  return { path: stored.path, size: [pixels.width, pixels.height], channels: "rgba", depth: "u8", space: "srgb" };
}

/** Set a node's `image` output from a `Planar`. */
export async function output(
  context: ImageNodeContext & { readonly outputs: { readonly image: { set(value: ImageRef): void } } },
  image: Planar,
): Promise<void> {
  context.outputs.image.set(await writePixels(context, image.toPixels()));
}

/**
 * A colour in any of the shapes the class library accepted: `[r, g, b, a]`
 * (Cascade's one colour), the older `{ r, g, b, a }`, 0–255 components, or a
 * CSS `rgb()` / hex string. Saved graphs hold all of them.
 */
export function normalizeColor(input: unknown): Required<RGBA> {
  if (input && typeof input === "object" && !Array.isArray(input) && "r" in input && "g" in input && "b" in input) {
    const color = input as { r: number; g: number; b: number; a?: number };
    const unit = color.r <= 1 && color.g <= 1 && color.b <= 1;
    return {
      r: unit ? color.r : color.r / 255,
      g: unit ? color.g : color.g / 255,
      b: unit ? color.b : color.b / 255,
      a: color.a !== undefined ? (unit ? color.a : color.a / 255) : 1,
    };
  }
  if (Array.isArray(input)) {
    const unit = input.every((value) => value <= 1);
    return {
      r: unit ? input[0] : input[0] / 255,
      g: unit ? input[1] : input[1] / 255,
      b: unit ? input[2] : input[2] / 255,
      a: input[3] !== undefined ? (unit ? input[3] : input[3] / 255) : 1,
    };
  }
  if (typeof input === "string") {
    const rgb = input.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
    if (rgb) return { r: parseInt(rgb[1]!, 10) / 255, g: parseInt(rgb[2]!, 10) / 255, b: parseInt(rgb[3]!, 10) / 255, a: 1 };
    const hex = input.replace("#", "");
    if (hex.length === 3 || hex.length === 6) {
      const expanded = hex.length === 3 ? hex.split("").map((digit) => digit + digit).join("") : hex;
      const parts = /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(expanded);
      if (parts) return { r: parseInt(parts[1]!, 16) / 255, g: parseInt(parts[2]!, 16) / 255, b: parseInt(parts[3]!, 16) / 255, a: 1 };
    }
  }
  return { r: 0, g: 0, b: 0, a: 1 };
}

/** `rgb(r,g,b)`, or `rgba(r,g,b,a)` below full alpha, for `fillStyle`. */
export function colorToCss(color: RGBA): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = color.a !== undefined ? color.a : 1;
  return a < 1 ? `rgba(${r},${g},${b},${a})` : `rgb(${r},${g},${b})`;
}
