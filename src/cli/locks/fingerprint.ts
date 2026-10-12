/**
 * What a node made, reduced to hashes a later run can be compared against.
 *
 * Each output port gets one fingerprint. A port whose value names a file (an
 * image, or a string path such as `exports/spread-1.svg`) is fingerprinted by
 * the file's content, because the path is incidental and the bytes are the
 * render. Rasters also get a hash of their decoded pixels, so a PNG encoder
 * that writes different metadata for identical pixels is still a match.
 *
 * The project's absolute path is replaced by `<project>` in values and text
 * files before hashing: a replay runs in a copy of the project, and a report
 * that mentions where it ran must not read as a different render.
 */
import fssync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { imagePath } from '../sequence.js';
import { digest, short, type Digest } from './store.js';

export type PortFingerprint =
  | {
      readonly kind: 'file';
      /** Where the file was, project-relative. Informational: never compared. */
      readonly path: string;
      readonly sha256: Digest;
      readonly bytes: number;
      /** Rasters: hash of the decoded RGBA, and the size. */
      readonly pixels?: Digest;
      readonly width?: number;
      readonly height?: number;
    }
  | {
      readonly kind: 'value';
      readonly sha256: Digest;
      /** The value itself when it is short enough to read in the lock. */
      readonly value?: unknown;
    };

export type OutputFingerprint = Record<string, PortFingerprint>;

const RASTER = new Set(['.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff']);
const TEXT = new Set(['.svg', '.json', '.txt', '.csv', '.xml']);

export interface FingerprintContext {
  readonly projectRoot: string;
  /** Resolve a project-relative path the way the host does (`shared/` included). */
  readonly resolve: (relative: string) => string;
}

export async function fingerprintOutputs(
  context: FingerprintContext,
  outputs: ReadonlyMap<string, unknown>,
  ports?: readonly string[],
): Promise<OutputFingerprint> {
  const result: Record<string, PortFingerprint> = {};
  const names = ports?.length ? ports : [...outputs.keys()].sort();
  for (const port of names) {
    if (!outputs.has(port)) throw new Error(`The node has no output named "${port}" (it has: ${[...outputs.keys()].join(', ')})`);
    result[port] = await fingerprintValue(context, outputs.get(port));
  }
  return result;
}

async function fingerprintValue(context: FingerprintContext, value: unknown): Promise<PortFingerprint> {
  const file = await existingFile(context, value);
  if (file) return fingerprintFile(context, file.absolute, file.relative);
  const json = normalize(context.projectRoot, JSON.stringify(plain(value)) ?? 'undefined');
  return { kind: 'value', sha256: digest(json), ...(json.length <= 200 ? { value: JSON.parse(json === 'undefined' ? 'null' : json) } : {}) };
}

/** The file a value names, if it names one that exists. */
async function existingFile(context: FingerprintContext, value: unknown): Promise<{ absolute: string; relative: string } | null> {
  const named = imagePath(value);
  if (!named || named.length > 1024 || /^[a-z]+:/i.test(named) || named.includes('\n')) return null;
  const relative = named.replace(/^\.?\//, '');
  try {
    const absolute = path.isAbsolute(named) ? named : context.resolve(relative);
    if ((await fs.stat(absolute)).isFile()) return { absolute, relative };
  } catch { /* not a file */ }
  return null;
}

export async function fingerprintFile(context: FingerprintContext, absolute: string, relative: string): Promise<PortFingerprint> {
  const extension = path.extname(absolute).toLowerCase();
  let bytes = await fs.readFile(absolute);
  if (TEXT.has(extension)) bytes = Buffer.from(normalize(context.projectRoot, bytes.toString('utf8')));
  const base = { kind: 'file' as const, path: relative, sha256: digest(bytes), bytes: bytes.length };
  if (!RASTER.has(extension)) return base;
  const { default: sharp } = await import('sharp');
  const { data, info } = await sharp(absolute, { limitInputPixels: false }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { ...base, pixels: digest(data), width: info.width, height: info.height };
}

/** Typed arrays and maps as plain JSON, so a cooked value hashes the same way every time. */
function plain(value: unknown): unknown {
  if (ArrayBuffer.isView(value)) return Array.from(value as unknown as ArrayLike<number>);
  if (value instanceof Map) return Object.fromEntries([...value].map(([key, entry]) => [String(key), plain(entry)]));
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, plain(entry)]));
  }
  return value;
}

function normalize(projectRoot: string, text: string): string {
  let out = text;
  for (const root of new Set([projectRoot, safeRealpath(projectRoot)])) out = out.split(root).join('<project>');
  return out;
}

function safeRealpath(file: string): string {
  try { return fssync.realpathSync(file); } catch { return file; }
}

export interface PortDifference {
  readonly port: string;
  readonly expected: string;
  readonly actual: string;
}

/**
 * Compare two fingerprints port by port. Pixels decide for rasters (identical
 * pixels in a differently encoded file are the same render); content decides
 * for everything else.
 */
export function compareFingerprints(expected: OutputFingerprint, actual: OutputFingerprint): PortDifference[] {
  const differences: PortDifference[] = [];
  for (const port of Object.keys(expected).sort()) {
    const want = expected[port]!;
    const got = actual[port];
    if (!got) {
      differences.push({ port, expected: describe(want), actual: 'nothing' });
      continue;
    }
    const same = want.kind === 'file' && got.kind === 'file' && want.pixels && got.pixels
      ? want.pixels === got.pixels
      : want.sha256 === got.sha256;
    if (!same) differences.push({ port, expected: describe(want), actual: describe(got) });
  }
  return differences;
}

function describe(fingerprint: PortFingerprint): string {
  if (fingerprint.kind === 'value') {
    return fingerprint.value !== undefined ? `${JSON.stringify(fingerprint.value)} (${short(fingerprint.sha256)})` : `value ${short(fingerprint.sha256)}`;
  }
  const size = fingerprint.width ? ` ${fingerprint.width}x${fingerprint.height}` : '';
  const pixels = fingerprint.pixels ? `, pixels ${short(fingerprint.pixels)}` : '';
  return `file ${short(fingerprint.sha256)}${size}${pixels}, ${fingerprint.bytes} bytes`;
}
