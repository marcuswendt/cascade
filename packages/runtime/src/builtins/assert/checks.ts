import type { NodeExecutionContext } from "@cascade/contracts";

import type { equalsDefinition, notBlankDefinition, rangeDefinition, trueDefinition } from "./definitions.js";

/** The bodies of `cascade.assert.*`; the declarations are in `index.ts`. */

class AssertionFailed extends Error {
  constructor(nodeId: string, moduleId: string, detail: string, message: unknown) {
    const extra = typeof message === "string" && message.trim() ? ` ${message.trim()}` : "";
    super(`Assertion failed in "${nodeId}" (${moduleId}): ${detail}.${extra}`);
    this.name = "AssertionFailed";
  }
}

export function executeRange({ nodeId, inputs, props, outputs }: NodeExecutionContext<typeof rangeDefinition>): void {
  const value = inputs.value;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new AssertionFailed(nodeId, "cascade.assert.Range", `value ${String(value)} is not a finite number`, props.message);
  }
  if (value < props.min || value > props.max) {
    throw new AssertionFailed(nodeId, "cascade.assert.Range", `value ${value} is outside [${props.min}, ${props.max}]`, props.message);
  }
  outputs.value.set(value);
}

export function executeEquals({ nodeId, inputs, props, outputs }: NodeExecutionContext<typeof equalsDefinition>): void {
  if (!deepEqual(inputs.value, props.expected, props.tolerance)) {
    throw new AssertionFailed(nodeId, "cascade.assert.Equals", `got ${preview(inputs.value)}, expected ${preview(props.expected)}`, props.message);
  }
  outputs.value.set(inputs.value);
}

export function executeTrue({ nodeId, inputs, props, outputs }: NodeExecutionContext<typeof trueDefinition>): void {
  if (inputs.value !== true) throw new AssertionFailed(nodeId, "cascade.assert.True", `value is ${preview(inputs.value)}`, props.message);
  outputs.value.set(true);
}

export async function executeNotBlank(
  { nodeId, inputs, props, outputs, capabilities, signal }: NodeExecutionContext<typeof notBlankDefinition>,
): Promise<void> {
  const image = inputs.image as unknown;
  const ref = typeof image === "string" ? { path: image } : (image as { path?: unknown } | undefined);
  if (!ref || typeof ref.path !== "string" || !ref.path) {
    throw new AssertionFailed(nodeId, "cascade.assert.NotBlank", "no image arrived", props.message);
  }
  const path = ref.path;
  const kept = capabilities.assets.imagePixels?.({ path });
  const pixels: Pixels | null = kept
    ? { width: kept.width, height: kept.height, channels: 4, data: kept.data }
    : await decodeImage(await capabilities.assets.read({ path }, { signal }));
  if (!pixels) throw new AssertionFailed(nodeId, "cascade.assert.NotBlank", `${path} is not a PNG or PPM this node can read`, props.message);
  const verdict = blankness(pixels, props.tolerance);
  if (verdict) throw new AssertionFailed(nodeId, "cascade.assert.NotBlank", `${path} (${pixels.width}x${pixels.height}) is ${verdict}`, props.message);
  outputs.image.set(inputs.image!);
}

function preview(value: unknown): string {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function deepEqual(a: unknown, b: unknown, tolerance: number): boolean {
  if (typeof a === "number" && typeof b === "number") return a === b || Math.abs(a - b) <= tolerance;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, index) => deepEqual(item, b[index], tolerance));
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const keys = Object.keys(left);
    if (keys.length !== Object.keys(right).length) return false;
    return keys.every((key) => key in right && deepEqual(left[key], right[key], tolerance));
  }
  return a === b || (a == null && b == null);
}

export interface Pixels {
  readonly width: number;
  readonly height: number;
  /** Channels per pixel: 1 grey, 2 grey+alpha, 3 RGB, 4 RGBA. */
  readonly channels: number;
  readonly data: ArrayLike<number>;
}

/** 'one flat colour', 'fully transparent', or null when the image has content. */
export function blankness(pixels: Pixels, tolerance = 0): string | null {
  const { channels, data } = pixels;
  const alpha = channels === 2 || channels === 4 ? channels - 1 : -1;
  const colour = alpha === -1 ? channels : channels - 1;
  const min = new Array(channels).fill(255);
  const max = new Array(channels).fill(0);
  let opaque = alpha === -1;
  for (let index = 0; index < data.length; index += channels) {
    if (alpha !== -1 && data[index + alpha]! > tolerance) opaque = true;
    for (let channel = 0; channel < channels; channel += 1) {
      const value = data[index + channel]!;
      if (value < min[channel]) min[channel] = value;
      if (value > max[channel]) max[channel] = value;
    }
  }
  if (!opaque) return "fully transparent";
  const spread = Math.max(...max.map((value, channel) => value - min[channel]));
  if (spread <= tolerance) return colour === 1 ? `one flat grey (${min[0]})` : `one flat colour (rgb ${min.slice(0, 3).join(", ")})`;
  return null;
}

/** 8-bit non-interlaced PNG (grey, grey+alpha, RGB, RGBA) or binary PPM/PGM. */
export async function decodeImage(bytes: Uint8Array): Promise<Pixels | null> {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return decodePng(bytes);
  if (bytes[0] === 0x50 && (bytes[1] === 0x36 || bytes[1] === 0x35)) return decodePnm(bytes);
  return null;
}

function decodePnm(bytes: Uint8Array): Pixels | null {
  const fields: string[] = [];
  let index = 2;
  while (fields.length < 3 && index < bytes.length) {
    while (index < bytes.length && /\s/.test(String.fromCharCode(bytes[index]!))) index += 1;
    if (bytes[index] === 0x23) {
      while (index < bytes.length && bytes[index] !== 0x0a) index += 1;
      continue;
    }
    let field = "";
    while (index < bytes.length && !/\s/.test(String.fromCharCode(bytes[index]!))) field += String.fromCharCode(bytes[index++]!);
    fields.push(field);
  }
  const [width, height, maxValue] = fields.map(Number);
  if (!width || !height || maxValue !== 255) return null;
  const channels = bytes[1] === 0x36 ? 3 : 1;
  return { width, height, channels, data: bytes.subarray(index + 1, index + 1 + width * height * channels) };
}

interface StreamGlobals {
  DecompressionStream?: new (format: string) => unknown;
  Blob?: new (parts: unknown[]) => { stream(): { pipeThrough(transform: unknown): unknown } };
  Response?: new (body: unknown) => { arrayBuffer(): Promise<ArrayBuffer> };
}

/** zlib inflate with the realm's own `DecompressionStream`, in a page, a worker or Node. */
async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const globals = globalThis as StreamGlobals;
  if (!globals.DecompressionStream || !globals.Blob || !globals.Response) {
    throw new Error("cascade.assert.NotBlank: this host has no DecompressionStream to read a PNG with");
  }
  const stream = new globals.Blob([data]).stream().pipeThrough(new globals.DecompressionStream("deflate"));
  return new Uint8Array(await new globals.Response(stream).arrayBuffer());
}

async function decodePng(bytes: Uint8Array): Promise<Pixels | null> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Uint8Array[] = [];
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      const depth = body[8];
      const colourType = body[9];
      const interlace = body[12];
      channels = ({ 0: 1, 4: 2, 2: 3, 6: 4 } as Record<number, number>)[colourType!] ?? 0;
      if (depth !== 8 || !channels || interlace !== 0) return null;
    } else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  if (!width || !height || !idat.length) return null;
  const joined = new Uint8Array(idat.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of idat) {
    joined.set(part, at);
    at += part.length;
  }
  const raw = await inflate(joined);
  const stride = width * channels;
  const data = new Uint8Array(stride * height);
  for (let row = 0; row < height; row += 1) {
    const filter = raw[row * (stride + 1)];
    const line = raw.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1));
    const out = data.subarray(row * stride, (row + 1) * stride);
    const previous = row > 0 ? data.subarray((row - 1) * stride, row * stride) : new Uint8Array(stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? out[x - channels]! : 0;
      const up = previous[x]!;
      const upLeft = x >= channels ? previous[x - channels]! : 0;
      const value = line[x]!;
      switch (filter) {
        case 0: out[x] = value; break;
        case 1: out[x] = (value + left) & 255; break;
        case 2: out[x] = (value + up) & 255; break;
        case 3: out[x] = (value + ((left + up) >> 1)) & 255; break;
        case 4: {
          const estimate = left + up - upLeft;
          const a = Math.abs(estimate - left);
          const b = Math.abs(estimate - up);
          const c = Math.abs(estimate - upLeft);
          out[x] = (value + (a <= b && a <= c ? left : b <= c ? up : upLeft)) & 255;
          break;
        }
        default: return null;
      }
    }
  }
  return { width, height, channels, data };
}
