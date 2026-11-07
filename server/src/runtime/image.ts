/**
 * `cascade/image` — the one image API a node body uses, in every host.
 *
 * A node that draws used to have two honest choices and one dishonest one.
 * `new OffscreenCanvas` worked in Studio and under `cascade run` (the CLI
 * installs Skia's canvas as that global), but the bytes in and out went
 * through `cascade/io`'s project paths, and fonts had no portable door at all.
 * So the nodes that needed fonts or files reached for `@napi-rs/canvas` and
 * `node:fs` directly, declared `runsOn: 'server'`, and could never be exported
 * as a browser editor — the commons plotter-social job was blocked on exactly
 * that ("Cascade has no browser image contract").
 *
 * The contract, in full:
 *
 *  - **Surface.** `createCanvas(w, h)` is an `OffscreenCanvas`: the browser's
 *    own in a page or a worker, Skia's (`@napi-rs/canvas`, installed by the
 *    headless host) under `cascade run`/`render`/MCP. `context2d(canvas)` asks
 *    for a CPU-backed 2D context (`willReadFrequently`), which is what keeps
 *    Chrome on the same software Skia rasteriser the headless host uses, and
 *    is the right hint anyway for nodes that read pixels back.
 *  - **Pixels in.** `readImage(context, ref)` reads an `ImageRef`, `AssetRef`
 *    or project path through the node's declared `assets` capability and
 *    decodes it with `decodeImage` (`createImageBitmap` in both hosts).
 *  - **Pixels out.** `writeImage(context, canvas, name)` encodes PNG through
 *    `encodeImage` and stores it with `assets.write`, returning the `ImageRef`
 *    to set on an `image` output. The host decides where it lands
 *    (`.cascade-cache/<name>.<hash>.png` headless, an in-memory generated
 *    asset in an exported editor), so a node never names a path.
 *  - **Fonts.** `registerFont(family, bytes)` makes a face drawable by
 *    `ctx.font` in this host: `FontFace` added to the page's or worker's font
 *    set in a browser, Skia's `GlobalFonts` headless. Bytes come from the same
 *    `assets` capability, so a font is a project file like any other.
 *  - **Refusal, not fallback.** No canvas in this host, or no `assets`
 *    capability declared, is an error with one sentence saying which, never a
 *    silent blank image.
 *
 * A node using it declares `runsOn: 'portable'` and `capabilities: ['assets']`
 * and imports nothing host-specific (`node:*`, `@napi-rs/canvas`, `document`).
 * Then the same body cooks in Studio, in `cascade run`, and in an exported
 * editor's worker.
 *
 * The headless host installs its font door under a global key, like
 * `cascade/io`'s bridge, because the node's copy of this module and the CLI's
 * copy are not always the same module instance.
 */

import { canvasPixels, pixelsBitmap, type ImagePixels } from './io.js';

export type { ImagePixels } from './io.js';

/** An image port value. Mirrors Cascade's core `ImageRef`. */
export interface ImageRef {
  path: string;
  size: [number, number];
  channels: 'r' | 'a' | 'rg' | 'rgb' | 'rgba';
  depth: 'u8' | 'u16' | 'f16' | 'f32';
  space: 'srgb' | 'linear';
}

/** Anything naming stored bytes: an `ImageRef`, an `AssetRef`, or a project path. */
export type ImageSourceRef = string | { readonly path: string };

/** The part of the `assets` capability these helpers use. */
export interface ImageAssets {
  read(ref: { path: string }, options: { signal: unknown }): Promise<Uint8Array>;
  write(
    data: Uint8Array,
    metadata: { mediaType?: string; suggestedName?: string },
    options: { signal: unknown },
  ): Promise<{ path: string; mediaType?: string }>;
  /** Optional: store an intermediate from its pixels (see core `AssetCapability.keepImage`). */
  keepImage?(
    pixels: ImagePixels,
    metadata: { suggestedName?: string },
    options: { signal: unknown },
  ): Promise<{ path: string; mediaType?: string }>;
  /** Optional: the pixels behind a stored image while the host holds them in memory. */
  imagePixels?(ref: { path: string }): ImagePixels | undefined;
}

/**
 * The slice of a definition-v1 `NodeExecutionContext` these helpers need, so
 * a node passes its own `context`. Typed loosely on purpose: a node that did
 * not declare `assets` still type-checks here and gets a sentence at run time
 * naming the missing declaration rather than a type error about generics.
 */
export interface ImageNodeContext {
  readonly capabilities: object;
  readonly signal?: unknown;
}

export type ImageType = 'image/png' | 'image/webp' | 'image/jpeg';

/** What a host gives `registerFont`. A browser realm needs none. */
export interface ImageHost {
  /** For a `--verbose` line and for errors. */
  readonly renderer: string;
  registerFont(family: string, bytes: Uint8Array, descriptors: FontDescriptors): void | Promise<void>;
}

export interface FontDescriptors {
  /** CSS weight, `'400'`, `'bold'`. Headless reads the weight from the file. */
  weight?: string;
  /** `'normal'` or `'italic'`. Headless reads the style from the file. */
  style?: string;
}

const HOST_KEY = '__cascadeImageHost';

const NO_CANVAS =
  'cascade/image: this host has no canvas. In a browser this needs OffscreenCanvas; headless, Cascade installs ' +
  '@napi-rs/canvas before a run (install it with "npm install @napi-rs/canvas" if it is missing).';

/** Install the headless host's font door. Returns the disposer. */
export function installImageHost(host: ImageHost | null): () => void {
  const globals = globalThis as Record<string, unknown>;
  const previous = globals[HOST_KEY];
  globals[HOST_KEY] = host ?? undefined;
  return () => {
    globals[HOST_KEY] = previous;
  };
}

function installedHost(): ImageHost | null {
  const host = (globalThis as Record<string, unknown>)[HOST_KEY] as ImageHost | undefined;
  return host && typeof host.registerFont === 'function' ? host : null;
}

type CanvasConstructor = new (width: number, height: number) => OffscreenCanvas;

function canvasConstructor(): CanvasConstructor | undefined {
  return (globalThis as { OffscreenCanvas?: CanvasConstructor }).OffscreenCanvas;
}

/** Whether this host can draw. Never throws. */
export function canvasAvailable(): boolean {
  return typeof canvasConstructor() === 'function';
}

/** A drawing surface of whole pixels, at least 1x1. */
export function createCanvas(width: number, height: number): OffscreenCanvas {
  const Canvas = canvasConstructor();
  if (!Canvas) throw new Error(NO_CANVAS);
  return new Canvas(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
}

/**
 * The canvas's 2D context, CPU-backed. `willReadFrequently` keeps a browser
 * off the GPU rasteriser, so a node draws with the same software Skia in Chrome
 * as headless, and `getImageData` does not stall on a readback.
 */
export function context2d(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const context = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | null;
  if (!context) throw new Error('cascade/image: the canvas has no 2D context');
  return context;
}

/** `createCanvas` and `context2d` in one: `const { canvas, context } = surface(w, h)`. */
export function surface(width: number, height: number): {
  canvas: OffscreenCanvas;
  context: OffscreenCanvasRenderingContext2D;
} {
  const canvas = createCanvas(width, height);
  return { canvas, context: context2d(canvas) };
}

/** Encoded bytes (PNG, JPEG, WebP) to something `drawImage` accepts. */
export async function decodeImage(bytes: Uint8Array | ArrayBuffer | Blob): Promise<ImageBitmap> {
  const create = (globalThis as { createImageBitmap?: (source: Blob) => Promise<ImageBitmap> }).createImageBitmap;
  if (typeof create !== 'function') throw new Error(NO_CANVAS);
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart]);
  const image = await create(blob);
  if (!image?.width || !image?.height) throw new Error('cascade/image: could not decode the image data');
  return image;
}

/** A canvas's pixels as encoded bytes, PNG unless asked otherwise. */
export async function encodeImage(
  canvas: OffscreenCanvas,
  options: { type?: ImageType; quality?: number } = {},
): Promise<Uint8Array> {
  const type = options.type ?? 'image/png';
  if (typeof canvas.convertToBlob !== 'function') throw new Error('cascade/image: this canvas cannot encode (no convertToBlob)');
  const blob = await canvas.convertToBlob({ type, ...(options.quality === undefined ? {} : { quality: options.quality }) });
  return new Uint8Array(await blob.arrayBuffer());
}

// One record per realm, so a font registered once is not added again on every
// cook. Keyed by family and content: new bytes under a family name register.
// The headless realm is keyed by its renderer name rather than the host
// object, because a long-lived process (MCP) installs a fresh host per run
// while Skia's font registry lives for the whole process.
const registered = new Map<unknown, Set<string>>();

function fingerprint(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < bytes.length; index += 1) {
    hash ^= bytes[index]!;
    hash = Math.imul(hash, 0x01000193);
  }
  return `${bytes.length}:${(hash >>> 0).toString(16)}`;
}

interface BrowserFontSet { add(face: unknown): unknown }
type FontFaceConstructor = new (family: string, source: ArrayBuffer | Uint8Array, descriptors?: FontDescriptors) => {
  load(): Promise<unknown>;
};

/**
 * Make `family` drawable by `ctx.font` here. Idempotent per family and bytes.
 * A browser realm (page or worker) uses `FontFace`; the headless host
 * registers with Skia. A host with neither refuses.
 */
export async function registerFont(
  family: string,
  bytes: Uint8Array | ArrayBuffer,
  descriptors: FontDescriptors = {},
): Promise<void> {
  if (!family.trim()) throw new Error('cascade/image: registerFont needs a family name');
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!data.byteLength) throw new Error(`cascade/image: the font for ${family} is empty`);
  const host = installedHost();
  const globals = globalThis as { FontFace?: FontFaceConstructor; fonts?: BrowserFontSet; document?: { fonts?: BrowserFontSet } };
  const fonts = host ? null : globals.fonts ?? globals.document?.fonts;
  const realm: unknown = host ? `headless:${host.renderer}` : fonts ?? globalThis;
  const key = `${family}\u0000${descriptors.weight ?? ''}\u0000${descriptors.style ?? ''}\u0000${fingerprint(data)}`;
  const seen = registered.get(realm) ?? new Set<string>();
  if (seen.has(key)) return;
  if (host) {
    await host.registerFont(family, data, descriptors);
  } else if (typeof globals.FontFace === 'function' && fonts) {
    // A copy: FontFace may detach or keep the buffer it is given.
    const face = new globals.FontFace(family, data.slice().buffer, descriptors);
    fonts.add(await face.load());
  } else {
    throw new Error('cascade/image: this host cannot register fonts (no FontFace and no headless canvas host)');
  }
  seen.add(key);
  registered.set(realm, seen);
}

function assetsOf(context: ImageNodeContext): ImageAssets {
  const assets = (context.capabilities as { assets?: ImageAssets }).assets;
  if (!assets || typeof assets.read !== 'function' || typeof assets.write !== 'function') {
    throw new Error("cascade/image: this node reads or writes images, so its definition must declare capabilities: ['assets']");
  }
  return assets;
}

function refOf(ref: ImageSourceRef): { path: string } {
  const path = typeof ref === 'string' ? ref : ref?.path;
  if (typeof path !== 'string' || !path) throw new Error('cascade/image: no image to read (an empty path or an unset image input)');
  return { path };
}

const NEVER = { aborted: false, addEventListener() {}, removeEventListener() {} };

/** A stored file's bytes through the node's `assets` capability: an image, a font, anything. */
export async function readBytes(context: ImageNodeContext, ref: ImageSourceRef): Promise<Uint8Array> {
  return assetsOf(context).read(refOf(ref), { signal: context.signal ?? NEVER });
}

/** Read and decode an image input, an asset, or a project file. */
export async function readImage(context: ImageNodeContext, ref: ImageSourceRef): Promise<ImageBitmap> {
  // An image the host still holds in memory skips the read and the decode.
  const pixels = assetsOf(context).imagePixels?.(refOf(ref));
  if (pixels) return pixelsBitmap(pixels);
  return decodeImage(await readBytes(context, ref));
}

/**
 * Encode a canvas and store it; set the result on an `image` output. `name`
 * is a suggestion (`context.nodeId + '.png'` keeps instances apart); the host
 * picks the stored path.
 */
export async function writeImage(
  context: ImageNodeContext,
  canvas: OffscreenCanvas,
  name: string,
  options: { type?: ImageType; quality?: number; space?: 'srgb' | 'linear' } = {},
): Promise<ImageRef> {
  const type = options.type ?? 'image/png';
  const assets = assetsOf(context);
  const signal = context.signal ?? NEVER;
  // A PNG intermediate goes to the host as pixels when it can take them: a
  // fast lossless write, or no encode at all until something needs the file.
  const pixels = type === 'image/png' && assets.keepImage ? canvasPixels(canvas) : null;
  const stored = pixels && assets.keepImage
    ? await assets.keepImage(pixels, { suggestedName: name }, { signal })
    : await assets.write(
      await encodeImage(canvas, { type, ...(options.quality === undefined ? {} : { quality: options.quality }) }),
      { mediaType: type, suggestedName: name },
      { signal },
    );
  return {
    path: stored.path,
    size: [canvas.width, canvas.height],
    channels: 'rgba',
    depth: 'u8',
    space: options.space ?? 'srgb',
  };
}
