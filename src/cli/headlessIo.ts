/**
 * `cascade/io`'s local transport — the filesystem instead of `/api/media`.
 *
 * The page reads and writes project files over HTTP because that is the only
 * door it has. A headless run has the directory itself, so this installs the
 * same two operations against it, and a node that imports `loadBitmap` or
 * `saveImage` never learns which host it got.
 *
 * It deliberately keeps the server route's two rules rather than relaxing them
 * offline, because a node must behave identically under both hosts:
 *
 *  - writes are confined to `.cascade-cache/`, since a node's output is derived
 *    data a re-cook reproduces and does not belong beside the source material;
 *  - a written filename is content-addressed, so one node writing to a fixed
 *    name for two different inputs does not silently hand on the wrong pixels.
 *
 * Both are copied from `server/src/routes/media.ts`, which is where the reasons
 * are written out at length.
 *
 * An image a node stores from a canvas (`saveImage`, `cascade/image`'s
 * `writeImage`) is an intermediate: it arrives as pixels through `keep` and is
 * written as a fast lossless PNG (`INTERMEDIATE_PNG_LEVEL`).
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ImagePixels, IoBridge } from '../../server/src/runtime/io.js';
import { installIoBridge } from '../../server/src/runtime/io.js';
import type { ProjectRoot } from '../../server/src/project.js';

const CACHE_DIR = '.cascade-cache';

/** `.cascade-cache/logo.png` -> `.cascade-cache/logo.<hash>.png` */
export function contentAddressed(relative: string, body: Uint8Array): string {
  const hash = crypto.createHash('sha1').update(body).digest('hex').slice(0, 12);
  const directory = path.posix.dirname(relative);
  const name = path.posix.basename(relative);
  const [stem, ...rest] = name.split('.');
  const tail = rest.length ? `.${rest.join('.')}` : '';
  return path.posix.join(directory, `${stem}.${hash}${tail}`);
}

/**
 * The zlib level an intermediate PNG is written at. Measured on a 1024²
 * RGBA filter intermediate (round 2, 7 Nov): Skia's default encoder 157 ms,
 * sharp at level 6 53 ms, at level 1 26 ms, for a file about 1.5x larger.
 * An intermediate is read once by the next node and re-made by a re-cook, so
 * the time is worth more than the bytes. A run's saved outputs are copies at
 * full compression, never these.
 */
export const INTERMEDIATE_PNG_LEVEL = 1;

type SharpFactory = typeof import('sharp').default;
let sharpLoad: Promise<SharpFactory | null> | undefined;

/** sharp, loaded once; null when its native binary is missing. */
function loadSharp(): Promise<SharpFactory | null> {
  sharpLoad ??= import('sharp').then((module) => module.default, () => null);
  return sharpLoad;
}

/**
 * Lossless PNG bytes for pixels, at `level` (zlib 0-9). sharp when it loads;
 * otherwise the installed canvas's own encoder, which has no level to set but
 * is still lossless. Throws only when neither exists.
 */
export async function encodePixelsPng(pixels: ImagePixels, level = INTERMEDIATE_PNG_LEVEL): Promise<Uint8Array> {
  const sharp = await loadSharp();
  if (sharp) {
    const raw = Buffer.from(pixels.data.buffer, pixels.data.byteOffset, pixels.data.byteLength);
    return sharp(raw, { raw: { width: pixels.width, height: pixels.height, channels: 4 } })
      .png({ compressionLevel: level })
      .toBuffer();
  }
  const Canvas = (globalThis as { OffscreenCanvas?: new (w: number, h: number) => OffscreenCanvas }).OffscreenCanvas;
  const Data = (globalThis as { ImageData?: typeof ImageData }).ImageData;
  if (!Canvas || !Data) throw new Error('cascade/io: cannot encode a PNG here (neither sharp nor a canvas is installed)');
  const canvas = new Canvas(pixels.width, pixels.height);
  canvas.getContext('2d')!.putImageData(new Data(pixels.data as Uint8ClampedArray<ArrayBuffer>, pixels.width, pixels.height), 0, 0);
  return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
}

/** The bridge itself, so a test can drive it without installing anything. */
/** The headless bridge always takes pixels. */
export type HeadlessIoBridge = IoBridge & Required<Pick<IoBridge, 'keep'>>;

export function createIoBridge(project: ProjectRoot): HeadlessIoBridge {
  const bridge: HeadlessIoBridge = {
    /** An intermediate image: a fast lossless PNG, content-addressed like any write. */
    async keep(relative: string, pixels: ImagePixels): Promise<string> {
      return bridge.write(relative, await encodePixelsPng(pixels));
    },

    async read(relative: string): Promise<Uint8Array> {
      // `raw` and the resize options are a service of the media route, for a
      // browser that wants a smaller copy over the wire. Offline there is no
      // wire: a node gets the file.
      const full = project.resolveMedia(relative.replace(/^\.?\//, ''));
      try {
        return await fs.readFile(full);
      } catch (error) {
        throw new Error(`cascade/io: cannot load ${relative} — ${error instanceof Error ? error.message : error}`);
      }
    },

    async write(relative: string, data: Uint8Array): Promise<string> {
      const clean = relative.replace(/^\.?\//, '');
      if (!clean.startsWith(`${CACHE_DIR}/`)) {
        throw new Error(`cascade/io: writes are confined to ${CACHE_DIR}/ — got ${clean}`);
      }
      if (!data.byteLength) throw new Error(`cascade/io: refusing to write an empty file to ${clean}`);
      const target = contentAddressed(clean, data);
      const full = project.resolve(target);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, data);
      return target;
    },
  };
  return bridge;
}

/** Install it for the duration of a run. Returns the disposer. */
export function installProjectIo(project: ProjectRoot): () => void {
  return installIoBridge(createIoBridge(project));
}
