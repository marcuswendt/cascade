/** Host drawing primitives used by the legacy image-node compatibility layer. */
export interface RenderSurface {
  width: number;
  height: number;
  getContext(
    contextId: '2d',
    options?: { willReadFrequently?: boolean; alpha?: boolean },
  ): unknown;
}

export interface RenderDrawable {
  readonly width: number;
  readonly height: number;
}

interface BlobLike {
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type ImageDecodeSource = Uint8Array | ArrayBuffer | BlobLike | string;

interface SurfaceProvider {
  readonly name: string;
  createSurface(width: number, height: number): RenderSurface;
  decodeImage(source: ImageDecodeSource): Promise<RenderDrawable>;
}

interface SurfaceGlobals {
  document?: { createElement(tag: 'canvas'): RenderSurface };
  OffscreenCanvas?: new (width: number, height: number) => RenderSurface;
  createImageBitmap?: (source: unknown) => Promise<RenderDrawable>;
  Image?: new () => {
    src: unknown;
    width: number;
    height: number;
    crossOrigin?: string | null;
    decode(): Promise<void>;
  };
  Blob?: new (parts: unknown[]) => BlobLike;
}

const globals = () => globalThis as unknown as SurfaceGlobals;

export class MissingRenderSurfaceError extends Error {
  readonly name = 'MissingRenderSurfaceError';

  constructor(kind: string) {
    super(
      `Cascade has no ${kind} in this environment. Install the optional ` +
        `'@napi-rs/canvas' renderer before cooking a graph that draws.`,
    );
  }
}

function provider(): SurfaceProvider | null {
  const host = globals();
  if (typeof host.document?.createElement === 'function') return domProvider;
  if (typeof host.OffscreenCanvas === 'function') return offscreenProvider;
  return null;
}

export function surfaceAvailable(): boolean {
  return provider() !== null;
}

export function surfaceProviderName(): string | null {
  return provider()?.name ?? null;
}

export function createSurface(width: number, height: number): RenderSurface {
  const current = provider();
  if (!current) throw new MissingRenderSurfaceError('drawing surface');
  return current.createSurface(width, height);
}

export function decodeImage(source: ImageDecodeSource): Promise<RenderDrawable> {
  const current = provider();
  if (!current) throw new MissingRenderSurfaceError('image decoder');
  return current.decodeImage(source);
}

function bytesOf(source: Uint8Array | ArrayBuffer): Uint8Array {
  return source instanceof Uint8Array ? source : new Uint8Array(source);
}

async function decodeViaBitmap(source: ImageDecodeSource): Promise<RenderDrawable | null> {
  const host = globals();
  if (typeof host.createImageBitmap !== 'function' || typeof source === 'string') return null;
  const input =
    source instanceof Uint8Array || source instanceof ArrayBuffer
      ? typeof host.Blob === 'function'
        ? new host.Blob([bytesOf(source)])
        : bytesOf(source)
      : source;
  return host.createImageBitmap(input);
}

async function decodeViaImage(source: ImageDecodeSource): Promise<RenderDrawable> {
  const host = globals();
  if (typeof host.Image !== 'function') throw new MissingRenderSurfaceError('image decoder');
  const image = new host.Image();
  if (typeof source === 'string') {
    if (!/^(data:|blob:)/.test(source)) image.crossOrigin = 'anonymous';
    image.src = source;
  } else if (source instanceof Uint8Array || source instanceof ArrayBuffer) {
    image.src = bytesOf(source);
  } else {
    image.src = new Uint8Array(await source.arrayBuffer());
  }
  await image.decode();
  if (!image.width || !image.height) throw new Error('cascade: could not decode image data');
  return image;
}

async function decode(source: ImageDecodeSource): Promise<RenderDrawable> {
  if (typeof source !== 'string') {
    const bitmap = await decodeViaBitmap(source);
    if (bitmap) return bitmap;
  }
  return decodeViaImage(source);
}

const domProvider: SurfaceProvider = {
  name: 'DOM canvas',
  createSurface(width, height) {
    const surface = globals().document!.createElement('canvas');
    surface.width = width;
    surface.height = height;
    return surface;
  },
  decodeImage: decode,
};

const offscreenProvider: SurfaceProvider = {
  name: 'OffscreenCanvas',
  createSurface(width, height) {
    const Offscreen = globals().OffscreenCanvas!;
    return new Offscreen(width, height);
  },
  decodeImage: decode,
};
