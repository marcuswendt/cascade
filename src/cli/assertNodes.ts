/**
 * `cascade.assert.*`: nodes that fail a run.
 *
 * An agent checking its own render used to do it outside the graph (a QR code
 * scanned by a separate script, a blank frame noticed by eye). An assertion
 * node puts the check in the graph: when it does not hold, the node throws,
 * the run fails with a non-zero exit, and `run --json` carries the message,
 * `{ ok: false, error: { message: "Assertion failed in \"…\" …" } }`.
 *
 * Each passes its input through, so an assertion can sit inline and is cooked
 * whenever what is downstream of it is. An unconsumed `NotBlank` is not saved
 * as an image output (`imageOutputs.ts` skips this namespace).
 *
 * Headless only, for now. They are registered by the CLI host
 * (`headlessBuiltins.ts`) rather than in the runtime's built-in list because
 * that list is in Studio's entry chunk, which has no room; Studio shows them as
 * unresolved modules until its definitions load lazily. Image decoding uses
 * `node:zlib`, which is the other reason they live on the Node side.
 */
import { inflateSync } from 'node:zlib';
import type { DefinitionNodeRegistration } from '../../packages/runtime/src/types.js';

export const ASSERT_NAMESPACE = 'cascade.assert.';

class AssertionFailed extends Error {
  constructor(nodeId: string, moduleId: string, detail: string, message: unknown) {
    const extra = typeof message === 'string' && message.trim() ? ` ${message.trim()}` : '';
    super(`Assertion failed in "${nodeId}" (${moduleId}): ${detail}.${extra}`);
    this.name = 'AssertionFailed';
  }
}

const message = { type: 'string', default: '' } as const;

const rangeDefinition = {
  apiVersion: 1,
  runsOn: 'portable',
  label: 'Assert Range',
  description: 'Fails the run unless value is a finite number in [min, max]; passes value through',
  icon: 'ShieldCheck',
  inputs: { value: { kind: 'data', type: 'float', default: 0 } },
  outputs: { value: { kind: 'data', type: 'float' } },
  props: { min: { type: 'float', default: 0 }, max: { type: 'float', default: 1 }, message },
} as const;

const equalsDefinition = {
  apiVersion: 1,
  runsOn: 'portable',
  label: 'Assert Equals',
  description: 'Fails the run unless value equals expected (JSON-equal; numbers within tolerance); passes value through',
  icon: 'ShieldCheck',
  inputs: { value: { kind: 'data', type: 'any', default: null } },
  outputs: { value: { kind: 'data', type: 'any' } },
  props: { expected: { type: 'any', default: null }, tolerance: { type: 'float', default: 0, min: 0 }, message },
} as const;

const trueDefinition = {
  apiVersion: 1,
  runsOn: 'portable',
  label: 'Assert True',
  description: 'Fails the run unless value is true (wire a condition, or give the prop an expression); passes value through',
  icon: 'ShieldCheck',
  inputs: { value: { kind: 'data', type: 'bool', default: false } },
  outputs: { value: { kind: 'data', type: 'bool' } },
  props: { message },
} as const;

const notBlankDefinition = {
  apiVersion: 1,
  runsOn: 'portable',
  label: 'Assert Not Blank',
  description: 'Fails the run when an image (PNG or PPM) is one flat colour or fully transparent; passes the image through',
  icon: 'ShieldCheck',
  capabilities: ['assets'],
  inputs: { image: { kind: 'data', type: 'image' } },
  outputs: { image: { kind: 'data', type: 'image' } },
  props: {
    tolerance: { type: 'int', default: 0, min: 0, max: 255, step: 1 },
    message,
  },
} as const;

export const rangeRegistration: DefinitionNodeRegistration<typeof rangeDefinition> = {
  kind: 'definition-v1',
  moduleId: 'cascade.assert.Range',
  definition: rangeDefinition,
  loadExecute: async () => ({ nodeId, inputs, props, outputs }) => {
    const value = inputs.value;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new AssertionFailed(nodeId, 'cascade.assert.Range', `value ${String(value)} is not a finite number`, props.message);
    }
    if (value < props.min || value > props.max) {
      throw new AssertionFailed(nodeId, 'cascade.assert.Range', `value ${value} is outside [${props.min}, ${props.max}]`, props.message);
    }
    outputs.value.set(value);
  },
};

export const equalsRegistration: DefinitionNodeRegistration<typeof equalsDefinition> = {
  kind: 'definition-v1',
  moduleId: 'cascade.assert.Equals',
  definition: equalsDefinition,
  loadExecute: async () => ({ nodeId, inputs, props, outputs }) => {
    if (!deepEqual(inputs.value, props.expected, props.tolerance)) {
      throw new AssertionFailed(nodeId, 'cascade.assert.Equals', `got ${preview(inputs.value)}, expected ${preview(props.expected)}`, props.message);
    }
    outputs.value.set(inputs.value);
  },
};

export const trueRegistration: DefinitionNodeRegistration<typeof trueDefinition> = {
  kind: 'definition-v1',
  moduleId: 'cascade.assert.True',
  definition: trueDefinition,
  loadExecute: async () => ({ nodeId, inputs, props, outputs }) => {
    if (inputs.value !== true) throw new AssertionFailed(nodeId, 'cascade.assert.True', `value is ${preview(inputs.value)}`, props.message);
    outputs.value.set(true);
  },
};

export const notBlankRegistration: DefinitionNodeRegistration<typeof notBlankDefinition> = {
  kind: 'definition-v1',
  moduleId: 'cascade.assert.NotBlank',
  definition: notBlankDefinition,
  loadExecute: async () => async ({ nodeId, inputs, props, outputs, capabilities, signal }) => {
    const image = inputs.image as unknown;
    const ref = typeof image === 'string' ? { path: image } : image as { path?: unknown } | undefined;
    if (!ref || typeof ref.path !== 'string' || !ref.path) {
      throw new AssertionFailed(nodeId, 'cascade.assert.NotBlank', 'no image arrived', props.message);
    }
    const bytes = await capabilities.assets.read(ref as never, { signal });
    const pixels = decodeImage(bytes);
    if (!pixels) throw new AssertionFailed(nodeId, 'cascade.assert.NotBlank', `${ref.path} is not a PNG or PPM this node can read`, props.message);
    const verdict = blankness(pixels, props.tolerance);
    if (verdict) throw new AssertionFailed(nodeId, 'cascade.assert.NotBlank', `${ref.path} (${pixels.width}x${pixels.height}) is ${verdict}`, props.message);
    outputs.image.set(inputs.image!);
  },
};

export const assertNodeRegistrations: readonly DefinitionNodeRegistration[] = Object.freeze([
  equalsRegistration,
  notBlankRegistration,
  rangeRegistration,
  trueRegistration,
] as DefinitionNodeRegistration[]);

// ---------------------------------------------------------------------------

function preview(value: unknown): string {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function deepEqual(a: unknown, b: unknown, tolerance: number): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a === b || Math.abs(a - b) <= tolerance;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, index) => deepEqual(item, b[index], tolerance));
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = Object.keys(a as object);
    if (keys.length !== Object.keys(b as object).length) return false;
    return keys.every((key) => key in (b as object) && deepEqual((a as any)[key], (b as any)[key], tolerance));
  }
  return a === b || (a == null && b == null);
}

export interface Pixels {
  readonly width: number;
  readonly height: number;
  /** Channels per pixel: 1 grey, 2 grey+alpha, 3 RGB, 4 RGBA. */
  readonly channels: number;
  readonly data: Uint8Array;
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
  if (!opaque) return 'fully transparent';
  const spread = Math.max(...max.map((value, channel) => value - min[channel]));
  if (spread <= tolerance) return colour === 1 ? `one flat grey (${min[0]})` : `one flat colour (rgb ${min.slice(0, 3).join(', ')})`;
  return null;
}

/** 8-bit non-interlaced PNG (grey, grey+alpha, RGB, RGBA) or binary PPM/PGM. */
export function decodeImage(bytes: Uint8Array): Pixels | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return decodePng(bytes);
  if (bytes[0] === 0x50 && (bytes[1] === 0x36 || bytes[1] === 0x35)) return decodePnm(bytes);
  return null;
}

function decodePnm(bytes: Uint8Array): Pixels | null {
  const fields: string[] = [];
  let index = 2;
  while (fields.length < 3 && index < bytes.length) {
    while (index < bytes.length && /\s/.test(String.fromCharCode(bytes[index]!))) index += 1;
    if (bytes[index] === 0x23) { while (index < bytes.length && bytes[index] !== 0x0a) index += 1; continue; }
    let field = '';
    while (index < bytes.length && !/\s/.test(String.fromCharCode(bytes[index]!))) field += String.fromCharCode(bytes[index++]!);
    fields.push(field);
  }
  const [width, height, maxValue] = fields.map(Number);
  if (!width || !height || maxValue !== 255) return null;
  const channels = bytes[1] === 0x36 ? 3 : 1;
  return { width, height, channels, data: bytes.subarray(index + 1, index + 1 + width * height * channels) };
}

function decodePng(bytes: Uint8Array): Pixels | null {
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
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      const depth = body[8];
      const colourType = body[9];
      const interlace = body[12];
      channels = ({ 0: 1, 4: 2, 2: 3, 6: 4 } as Record<number, number>)[colourType!] ?? 0;
      if (depth !== 8 || !channels || interlace !== 0) return null;
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (!width || !height || !idat.length) return null;
  const raw = inflateSync(Buffer.concat(idat));
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
