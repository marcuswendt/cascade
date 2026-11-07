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
 * **Images between nodes.** An image a node stores from a canvas
 * (`saveImage`, `cascade/image`'s `writeImage`) is an intermediate: it arrives
 * as pixels through `keep`, named by a hash of those pixels. In a run that
 * keeps pixels (`installProjectIo(project, { resident: true })`, which `cascade
 * run` and `render` use) the pixels stay in memory and the next node in the
 * process reads them back without a file or a decode (`pixels`); the PNG is
 * written behind, at zlib level 1, off the main thread. The path is a file by
 * the time anything reads it from disk: `read` waits for it,
 * `settleProjectImages` waits for all of them (before a Python stage, at the
 * end of a run), and `copyImageFile` writes a run's saved outputs straight from
 * the pixels at full compression. Without residency `keep` encodes at once.
 */
import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ImagePixels, IoBridge } from '../../server/src/runtime/io.js';
import { installIoBridge } from '../../server/src/runtime/io.js';
import type { ProjectRoot } from '../../server/src/project.js';

const CACHE_DIR = '.cascade-cache';

/** `.cascade-cache/logo.png` -> `.cascade-cache/logo.<hash>.png` */
export function contentAddressed(relative: string, body: Uint8Array): string {
  return addressed(relative, crypto.createHash('sha1').update(body).digest('hex').slice(0, 12));
}

/** The same name, addressed by the pixels rather than by one encoding of them. */
export function pixelAddressed(relative: string, pixels: ImagePixels): string {
  const hash = crypto.createHash('sha1')
    .update(`${pixels.width}x${pixels.height}\0`)
    .update(pixels.data)
    .digest('hex')
    .slice(0, 12);
  return addressed(relative, hash);
}

function addressed(relative: string, hash: string): string {
  const directory = path.posix.dirname(relative);
  const name = path.posix.basename(relative);
  const [stem, ...rest] = name.split('.');
  const tail = rest.length ? `.${rest.join('.')}` : '';
  return path.posix.join(directory, `${stem}.${hash}${tail}`);
}

/**
 * How an intermediate PNG is written. Measured on a 1024² RGBA filter
 * intermediate (round 2, 7 Nov): Skia's default encoder 157 ms, sharp at level
 * 1 26 ms for a file about 1.8x larger. An intermediate is read once by the
 * next node and re-made by a re-cook, so the time is worth more than the bytes.
 */
export const INTERMEDIATE_PNG = { level: 1, adaptiveFiltering: false } as const;

/**
 * How a run's saved outputs are written: the default zlib level with adaptive
 * filtering, within 3% of Skia's size (1,024 vs 999 KB on a field-logo frame)
 * in 77 ms rather than 168.
 */
export const FINAL_PNG = { level: 6, adaptiveFiltering: true } as const;

type PngOptions = { readonly level: number; readonly adaptiveFiltering: boolean };
type SharpFactory = typeof import('sharp').default;
let sharpLoad: Promise<SharpFactory | null> | undefined;

/** sharp, loaded once; null when its native binary is missing. */
function loadSharp(): Promise<SharpFactory | null> {
  sharpLoad ??= import('sharp').then((module) => module.default, () => null);
  return sharpLoad;
}

/**
 * Lossless PNG bytes for pixels. sharp when it loads, which encodes on its own
 * threads; otherwise the installed canvas's encoder, which has no level to set
 * but is still lossless. Throws only when neither exists.
 */
export async function encodePixelsPng(pixels: ImagePixels, options: PngOptions = INTERMEDIATE_PNG): Promise<Uint8Array> {
  const sharp = await loadSharp();
  if (sharp) {
    const raw = Buffer.from(pixels.data.buffer, pixels.data.byteOffset, pixels.data.byteLength);
    return sharp(raw, { raw: { width: pixels.width, height: pixels.height, channels: 4 } })
      .png({ compressionLevel: options.level, adaptiveFiltering: options.adaptiveFiltering })
      .toBuffer();
  }
  const Canvas = (globalThis as { OffscreenCanvas?: new (w: number, h: number) => OffscreenCanvas }).OffscreenCanvas;
  const Data = (globalThis as { ImageData?: typeof ImageData }).ImageData;
  if (!Canvas || !Data) throw new Error('cascade/io: cannot encode a PNG here (neither sharp nor a canvas is installed)');
  const canvas = new Canvas(pixels.width, pixels.height);
  canvas.getContext('2d')!.putImageData(new Data(pixels.data as Uint8ClampedArray<ArrayBuffer>, pixels.width, pixels.height), 0, 0);
  return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
}

/** Write a file whole or not at all: render workers share one cache, and a
 *  reader must never open another process's half-written PNG. */
async function writeWhole(full: string, data: Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(full), { recursive: true });
  const staging = `${full}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(staging, data);
  await fs.rename(staging, full);
}

/**
 * Pixel bytes held in memory per project before the oldest images whose file
 * is already written are let go. 512 MB is 128 images at 1024²: several
 * frames of a long filter chain, so a node reading its input always finds it.
 */
export const RESIDENT_BUDGET_BYTES = 512 * 1024 * 1024;

interface HeldImage {
  readonly pixels: ImagePixels;
  /** Settles when the file is on disk; rejects with the write's error. */
  readonly written: Promise<void>;
  done: boolean;
}

/** The images one project's run holds in memory, newest last. */
export class ResidentImages {
  private readonly held = new Map<string, HeldImage>();
  private bytes = 0;
  /** Files written behind, for a test or a trace. */
  encodes = 0;

  constructor(private readonly project: ProjectRoot, private readonly budget = RESIDENT_BUDGET_BYTES) {}

  /** Hold the pixels, start the write behind, return the path at once. */
  keep(relative: string, pixels: ImagePixels): string {
    const target = pixelAddressed(relative, pixels);
    const known = this.held.get(target);
    if (known) {
      this.touch(target, known);
      return target;
    }
    const full = this.project.resolve(target);
    const entry: HeldImage = {
      pixels,
      done: false,
      written: (async () => {
        // The same pixels from an earlier frame or run are already a file.
        if (existsSync(full)) return;
        this.encodes += 1;
        await writeWhole(full, await encodePixelsPng(pixels, INTERMEDIATE_PNG));
      })(),
    };
    // A failed write is reported where the file is needed (settle, read),
    // never as an unhandled rejection in between.
    entry.written.then(() => { entry.done = true; this.trim(); }, () => { entry.done = true; });
    this.held.set(target, entry);
    this.bytes += pixels.data.byteLength;
    this.trim();
    return target;
  }

  /** The pixels behind a path, while held. */
  pixels(relative: string): ImagePixels | undefined {
    const entry = this.held.get(relative);
    if (!entry) return undefined;
    this.touch(relative, entry);
    return entry.pixels;
  }

  /** Resolve when `relative` (or every held image) is a whole file. */
  async settle(relative?: string): Promise<void> {
    if (relative !== undefined) {
      await this.held.get(relative)?.written;
      return;
    }
    await Promise.all([...this.held.values()].filter((entry) => !entry.done).map((entry) => entry.written));
  }

  private touch(key: string, entry: HeldImage): void {
    this.held.delete(key);
    this.held.set(key, entry);
  }

  /** Let the oldest written images go until under budget; a pending one stays. */
  private trim(): void {
    if (this.bytes <= this.budget) return;
    for (const [key, entry] of this.held) {
      if (this.bytes <= this.budget) break;
      if (!entry.done) continue;
      this.held.delete(key);
      this.bytes -= entry.pixels.data.byteLength;
    }
  }
}

/** Per project root: the store of the run that keeps pixels, while it runs. */
const residentStores = new Map<string, ResidentImages>();

/** The project's resident store, when a run installed one. */
export function residentImages(project: Pick<ProjectRoot, 'root'>): ResidentImages | undefined {
  return residentStores.get(project.root);
}

/**
 * Every image the project's run is still writing, written. The barrier before
 * anything reads cache files from disk: a Python stage, a copy, the end of a
 * run. Free when nothing is pending or no run keeps pixels.
 */
export async function settleProjectImages(project: Pick<ProjectRoot, 'root'>): Promise<void> {
  await residentImages(project)?.settle();
}

/**
 * Copy an image a node wrote to where a run saves it. Held pixels are encoded
 * straight to the destination at full compression ({@link FINAL_PNG}), so a
 * saved output is never the level-1 intermediate and never waits for it.
 */
export async function copyImageFile(
  project: Pick<ProjectRoot, 'root' | 'resolveMedia'>,
  relative: string,
  destination: string,
): Promise<void> {
  const clean = relative.replace(/^\.?\//, '');
  const store = residentImages(project);
  const pixels = /\.png$/i.test(clean) ? store?.pixels(clean) : undefined;
  if (pixels) {
    await writeWhole(destination, await encodePixelsPng(pixels, FINAL_PNG));
    return;
  }
  await store?.settle(clean);
  await fs.copyFile(project.resolveMedia(clean), destination);
}

/** The headless bridge always takes pixels. */
export type HeadlessIoBridge = IoBridge & Required<Pick<IoBridge, 'keep' | 'pixels'>>;

/** The bridge itself, so a test can drive it without installing anything. */
export function createIoBridge(project: ProjectRoot): HeadlessIoBridge {
  const confined = (relative: string): string => {
    const clean = relative.replace(/^\.?\//, '');
    if (!clean.startsWith(`${CACHE_DIR}/`)) {
      throw new Error(`cascade/io: writes are confined to ${CACHE_DIR}/ — got ${clean}`);
    }
    return clean;
  };
  const bridge: HeadlessIoBridge = {
    /** An intermediate image: held in memory when the run keeps pixels, else a fast PNG now. */
    async keep(relative: string, pixels: ImagePixels): Promise<string> {
      const clean = confined(relative);
      if (!pixels.width || !pixels.height) throw new Error(`cascade/io: refusing to store an empty image to ${clean}`);
      const store = residentImages(project);
      if (store) return store.keep(clean, pixels);
      const target = pixelAddressed(clean, pixels);
      const full = project.resolve(target);
      if (!existsSync(full)) await writeWhole(full, await encodePixelsPng(pixels, INTERMEDIATE_PNG));
      return target;
    },

    pixels(relative: string): ImagePixels | undefined {
      return residentImages(project)?.pixels(relative.replace(/^\.?\//, ''));
    },

    async read(relative: string): Promise<Uint8Array> {
      // `raw` and the resize options are a service of the media route, for a
      // browser that wants a smaller copy over the wire. Offline there is no
      // wire: a node gets the file.
      const clean = relative.replace(/^\.?\//, '');
      const full = project.resolveMedia(clean);
      try {
        await residentImages(project)?.settle(clean);
        return await fs.readFile(full);
      } catch (error) {
        throw new Error(`cascade/io: cannot load ${relative} — ${error instanceof Error ? error.message : error}`);
      }
    },

    async write(relative: string, data: Uint8Array): Promise<string> {
      const clean = confined(relative);
      if (!data.byteLength) throw new Error(`cascade/io: refusing to write an empty file to ${clean}`);
      const target = contentAddressed(clean, data);
      await writeWhole(project.resolve(target), data);
      return target;
    },
  };
  return bridge;
}

/**
 * Install it for the duration of a run. Returns the disposer. With
 * `resident`, images between nodes stay in memory and are written behind;
 * the disposer stops keeping new ones (writes already started finish, and
 * `settleProjectImages` before disposing waits for them).
 */
export function installProjectIo(project: ProjectRoot, options: { resident?: boolean } = {}): () => void {
  let removeStore = () => {};
  if (options.resident) {
    const store = new ResidentImages(project);
    const previous = residentStores.get(project.root);
    residentStores.set(project.root, store);
    removeStore = () => {
      if (residentStores.get(project.root) !== store) return;
      if (previous) residentStores.set(project.root, previous);
      else residentStores.delete(project.root);
    };
  }
  const removeBridge = installIoBridge(createIoBridge(project));
  return () => {
    removeBridge();
    removeStore();
  };
}
