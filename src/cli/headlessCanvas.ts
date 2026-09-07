/**
 * A canvas for the headless host.
 *
 * Web technology is Cascade's default renderer, which settled the question of
 * what a node draws with and opened a different one: a node that calls
 * `new OffscreenCanvas(size, size)` and `ctx.createRadialGradient(...)` renders
 * in Studio and dies under `cascade run`, because a Node process has no canvas.
 * The FIELD.IO mark is exactly such a node, so "render offline" meant "give the
 * headless host the same drawing surface the page has".
 *
 * The renderer is `@napi-rs/canvas` — Skia, with prebuilt binaries per
 * platform, no node-gyp and no Python. Skia is also what Chrome rasterises
 * Canvas 2D with, so the fidelity argument that made Canvas the right choice in
 * the first place survives the move offline: the same gradient primitive, the
 * same rasteriser, a different process.
 *
 * It is an OPTIONAL dependency, and that is deliberate. A native binding is
 * platform-specific, and `@field/cascade` has to `npm install` cleanly on a
 * teammate's machine — including one whose platform has no prebuilt binary. So
 * npm installs it when it can, a failed or skipped install is not fatal, and a
 * host that reaches for a canvas without one gets a sentence naming what to
 * install rather than a stack trace about `OffscreenCanvas is not defined`.
 *
 * The globals it installs are the ones a browser node actually reaches for.
 * `document` is deliberately NOT among them: `cascade/stage` and the module
 * loader both test `typeof document` to tell the hosts apart, and a headless
 * process that claims to be a page would take the browser branch of each.
 */

export const CANVAS_PACKAGE = '@napi-rs/canvas';

/** The one sentence a missing renderer is allowed to produce. */
export const MISSING_CANVAS_MESSAGE =
  `Cascade cannot render offline: no canvas is available in this Node process. ` +
  `Install the optional renderer with "npm install ${CANVAS_PACKAGE}" and run again. ` +
  `(It is optional because it is a native, platform-specific binding — Cascade installs cleanly without it, ` +
  `but a node drawing with OffscreenCanvas or Canvas 2D needs it.)`;

export class MissingCanvasError extends Error {
  constructor(cause?: unknown) {
    super(MISSING_CANVAS_MESSAGE);
    this.name = 'MissingCanvasError';
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

export interface CanvasHost {
  /** What is drawing, for a `--verbose` line. */
  readonly renderer: string;
  /** Put the globals back the way they were. */
  dispose(): void;
}

interface NapiCanvasModule {
  Canvas: new (width: number, height: number) => {
    width: number;
    height: number;
    encode(format: string, quality?: number): Promise<Uint8Array>;
  };
  Image: new () => { src: unknown; width: number; height: number; complete: boolean; decode(): Promise<void> };
  ImageData: unknown;
  Path2D: unknown;
  DOMMatrix: unknown;
  DOMPoint: unknown;
  DOMRect: unknown;
}

let modulePromise: Promise<NapiCanvasModule> | undefined;

/** Load the renderer, or fail with the one sentence. Cached, including across
 *  a dispose — the binary is loaded once per process either way. */
async function loadCanvasModule(): Promise<NapiCanvasModule> {
  modulePromise ??= import(/* @vite-ignore */ CANVAS_PACKAGE)
    .then((module) => (module.default ?? module) as NapiCanvasModule)
    .catch((error) => {
      modulePromise = undefined;
      throw new MissingCanvasError(error);
    });
  return modulePromise;
}

/** Whether this process can draw. Never throws — callers decide what a `false`
 *  means, and only the ones that need pixels turn it into an error. */
export async function canvasAvailable(): Promise<boolean> {
  try {
    await loadCanvasModule();
    return true;
  } catch {
    return false;
  }
}

/**
 * Install the canvas globals. Throws `MissingCanvasError` when the renderer is
 * not installed, so a caller can decide between reporting it and carrying on —
 * a graph with no canvas node in it still runs on a machine without one.
 */
export async function installHeadlessCanvas(): Promise<CanvasHost> {
  const canvas = await loadCanvasModule();
  const globals = globalThis as Record<string, unknown>;

  /**
   * `OffscreenCanvas`, in terms of Skia's own. Subclassing rather than wrapping
   * matters: `ctx.drawImage(otherCanvas, ...)` is given the native object it
   * expects, so a node compositing one canvas into another works unchanged.
   * The only addition is `convertToBlob`, which is the browser's name for what
   * `encode` already does.
   */
  class HeadlessOffscreenCanvas extends canvas.Canvas {
    async convertToBlob(options: { type?: string; quality?: number } = {}): Promise<Blob> {
      const type = options.type ?? 'image/png';
      const format = type.replace(/^image\//, '');
      // Skia takes quality as 0..100; the browser API is 0..1.
      const quality = options.quality === undefined ? undefined : Math.round(options.quality * 100);
      return new Blob([(await this.encode(format, quality)) as BlobPart], { type });
    }
  }

  /**
   * `createImageBitmap`, over a decoder that has no such function. Skia's Image
   * is a valid `drawImage` source, so the bitmap a node gets back behaves the
   * way it uses one — width, height, and a `close()` that has nothing to
   * release.
   *
   * The `await decode()` is load-bearing and cost an hour: assigning `src`
   * publishes the dimensions immediately but finishes decoding off-thread, so
   * an image drawn without awaiting it reports 1024x1024 and paints nothing.
   * Every downstream filter in the FIELD.IO graph came out transparent black,
   * with no error anywhere — the failure was silent in exactly the way a
   * missing await is.
   */
  const createBitmap = async (source: Blob | ArrayBuffer | Uint8Array): Promise<unknown> => {
    const bytes = source instanceof Uint8Array
      ? source
      : new Uint8Array(source instanceof Blob ? await source.arrayBuffer() : source);
    const image = new canvas.Image();
    image.src = bytes;
    await image.decode();
    if (!image.width || !image.height) throw new Error('cascade: could not decode image data');
    (image as { close?: () => void }).close = () => {};
    return image;
  };

  const installed: Record<string, unknown> = {
    OffscreenCanvas: HeadlessOffscreenCanvas,
    Image: canvas.Image,
    ImageData: canvas.ImageData,
    Path2D: canvas.Path2D,
    DOMMatrix: canvas.DOMMatrix,
    DOMPoint: canvas.DOMPoint,
    DOMRect: canvas.DOMRect,
    createImageBitmap: createBitmap,
  };

  const previous = new Map<string, unknown>();
  for (const [name, value] of Object.entries(installed)) {
    if (value === undefined) continue;
    previous.set(name, globals[name]);
    globals[name] = value;
  }

  return {
    renderer: `${CANVAS_PACKAGE} (Skia)`,
    dispose() {
      for (const [name, value] of previous) {
        if (value === undefined) delete globals[name];
        else globals[name] = value;
      }
    },
  };
}
