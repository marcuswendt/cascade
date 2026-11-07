/**
 * Studio's in-memory images: what `assets.keepImage` stores in the page.
 *
 * The image library (`cascade.image.*`) hands every intermediate on as pixels
 * (doc/PROJECT_AUTHORING.md, "How an image travels between nodes"). Under
 * `cascade run` the host keeps them and writes a PNG behind; Studio keeps them
 * here and writes nothing, which is what the class nodes did — they passed
 * float buffers in memory, never a file. Without this, each cook of each image
 * node would encode a PNG, upload it into the project's `assets/images/` and
 * fetch it back for the next node and the Viewer.
 *
 * A kept image has a path under `.cascade-studio/` that names no file. The
 * page reads it back three ways: `imagePixels` (the next image node), `read`
 * (a project node reading bytes: encoded to PNG on demand), and `url` (the
 * Viewer and port previews, through `mediaUrl`: a data URL drawn once per
 * image). A server-side reader cannot see it — a Python stage given a kept
 * path finds no file — which is no worse than before, when the same port held
 * an `ImageBuffer` object no server could read either.
 *
 * Bounded: each node keeps its last few images (a re-cook supersedes the one
 * before, but a downstream node may still be reading it) and the store drops
 * the oldest past a byte budget.
 */
import type { ImagePixels } from '../../../packages/contracts/src/index.js';

export const STUDIO_IMAGE_ROOT = '.cascade-studio/';
const PER_NAME = 3;
const BUDGET_BYTES = 512 * 1024 * 1024;

interface Kept {
  readonly pixels: ImagePixels;
  readonly name: string;
  url?: string;
}

const kept = new Map<string, Kept>();
let bytes = 0;
let sequence = 0;

function clean(path: string): string {
  return path.replace(/^\.\//, '');
}

function drop(path: string): void {
  const entry = kept.get(path);
  if (!entry) return;
  kept.delete(path);
  bytes -= entry.pixels.data.byteLength;
}

/** Keep pixels under a fresh path. `name` groups a node's successive images. */
export function keepStudioImage(pixels: ImagePixels, name = 'image.png'): string {
  const safe = name.replace(/[^A-Za-z0-9._-]/g, '_') || 'image.png';
  const path = `${STUDIO_IMAGE_ROOT}${++sequence}-${safe}`;
  kept.set(path, { pixels, name: safe });
  bytes += pixels.data.byteLength;
  const siblings = [...kept].filter(([, entry]) => entry.name === safe).map(([key]) => key);
  for (const old of siblings.slice(0, Math.max(0, siblings.length - PER_NAME))) drop(old);
  for (const old of kept.keys()) {
    if (bytes <= BUDGET_BYTES || old === path) break;
    drop(old);
  }
  return path;
}

export function isStudioImage(path: string): boolean {
  return kept.has(clean(path));
}

export function studioImagePixels(path: string): ImagePixels | undefined {
  return kept.get(clean(path))?.pixels;
}

interface CanvasLike {
  width: number;
  height: number;
  getContext(kind: '2d'): { putImageData(data: unknown, x: number, y: number): void } | null;
}

function draw(pixels: ImagePixels): CanvasLike {
  const globals = globalThis as {
    document?: { createElement(tag: 'canvas'): CanvasLike };
    OffscreenCanvas?: new (width: number, height: number) => CanvasLike;
    ImageData?: new (data: Uint8ClampedArray, width: number, height: number) => unknown;
  };
  if (!globals.ImageData) throw new Error('Studio cannot draw a kept image: no ImageData here');
  let canvas: CanvasLike;
  if (globals.document) {
    canvas = globals.document.createElement('canvas');
    canvas.width = pixels.width;
    canvas.height = pixels.height;
  } else if (globals.OffscreenCanvas) {
    canvas = new globals.OffscreenCanvas(pixels.width, pixels.height);
  } else {
    throw new Error('Studio cannot draw a kept image: no canvas here');
  }
  canvas.getContext('2d')!.putImageData(new globals.ImageData(pixels.data, pixels.width, pixels.height), 0, 0);
  return canvas;
}

/** A kept image as PNG bytes, for a reader that wants a file's contents. */
export async function studioImageBytes(path: string): Promise<Uint8Array | undefined> {
  const entry = kept.get(clean(path));
  if (!entry) return undefined;
  const canvas = draw(entry.pixels) as CanvasLike & {
    toBlob?(callback: (blob: Blob | null) => void, type?: string): void;
    convertToBlob?(options: { type: string }): Promise<Blob>;
  };
  const blob = canvas.convertToBlob
    ? await canvas.convertToBlob({ type: 'image/png' })
    : await new Promise<Blob | null>((resolve) => canvas.toBlob!(resolve, 'image/png'));
  if (!blob) throw new Error(`Studio could not encode ${path}`);
  return new Uint8Array(await blob.arrayBuffer());
}

/** A kept image as a URL an <img> can show, drawn once; undefined for any other path. */
export function studioImageUrl(path: string): string | undefined {
  const entry = kept.get(clean(path));
  if (!entry) return undefined;
  entry.url ??= (draw(entry.pixels) as CanvasLike & { toDataURL(type?: string): string }).toDataURL('image/png');
  return entry.url;
}
