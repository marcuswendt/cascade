/**
 * Rendering offline: the canvas, the file transport, and the frame-range
 * contract.
 *
 * The regression these guard against is specific. Web technology is the default
 * renderer, so `field-logo` draws with `new OffscreenCanvas(...)` and
 * `ctx.createRadialGradient(...)` — which renders in Studio and, until the
 * headless host got a canvas of its own, died under `cascade run`. The tests
 * that matter most are the ones about what happens when the optional renderer
 * is NOT installed: a missing renderer must produce a sentence naming what to
 * install, never a stack trace.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CANVAS_PACKAGE,
  MISSING_CANVAS_MESSAGE,
  MissingCanvasError,
  canvasAvailable,
  installHeadlessCanvas,
} from '@/cli/headlessCanvas';
import {
  contentAddressed,
  copyImageFile,
  createIoBridge,
  installProjectIo,
  residentImages,
  ResidentImages,
  settleProjectImages,
} from '@/cli/headlessIo';
import { parseFrameSpec } from '@/cli/frames';
import { installIoBridge, saveImage, loadBitmap, saveBytes } from '../server/src/runtime/io';
import { ProjectRoot } from '../server/src/project';
import { readImage, surface, writeImage } from '../server/src/runtime/image';
import { createNodeAssetCapability } from '@/cli/nodeAssets';

const disposers: (() => void)[] = [];
afterEach(() => {
  while (disposers.length) disposers.pop()!();
});

/**
 * FLEVEL of the zlib stream in a PNG's first IDAT chunk, from its header's
 * second byte: 0 for zlib level 1 (fastest), 2 for the default level 6,
 * 3 for 7-9.
 */
function zlibLevel(png: Uint8Array): number {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  for (let offset = 8; offset + 8 <= png.length;) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    if (type === 'IDAT') return png[offset + 9]! >> 6;
    offset += 12 + length;
  }
  throw new Error('no IDAT chunk');
}

function scratchProject(): ProjectRoot {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-headless-'));
  return new ProjectRoot(root);
}

describe('a missing renderer', () => {
  it('names the package and the command that installs it', () => {
    expect(MISSING_CANVAS_MESSAGE).toContain(CANVAS_PACKAGE);
    expect(MISSING_CANVAS_MESSAGE).toContain(`npm install ${CANVAS_PACKAGE}`);
  });

  it('says why it is optional, so the absence reads as a choice rather than a break', () => {
    expect(MISSING_CANVAS_MESSAGE).toMatch(/optional/i);
  });

  it('carries that sentence as the error message, not a module-resolution trace', () => {
    const error = new MissingCanvasError(new Error("Cannot find package '@napi-rs/canvas'"));
    expect(error.message).toBe(MISSING_CANVAS_MESSAGE);
    expect(error.message).not.toMatch(/ERR_MODULE_NOT_FOUND|node_modules/);
  });
});

describe('the headless canvas', () => {
  it('reports whether this machine can draw, without throwing either way', async () => {
    await expect(canvasAvailable()).resolves.toBeTypeOf('boolean');
  });

  it('installs and removes its globals rather than leaking them into the process', async () => {
    if (!(await canvasAvailable())) return;
    const before = (globalThis as Record<string, unknown>).OffscreenCanvas;
    const host = await installHeadlessCanvas();
    expect((globalThis as Record<string, unknown>).OffscreenCanvas).toBeTypeOf('function');
    host.dispose();
    expect((globalThis as Record<string, unknown>).OffscreenCanvas).toBe(before);
  });

  it('leaves `document` undefined — the hosts tell themselves apart by it', async () => {
    if (!(await canvasAvailable())) return;
    const host = await installHeadlessCanvas();
    disposers.push(() => host.dispose());
    expect(typeof document).toBe('undefined');
  });

  it('draws the gradient the FIELD.IO mark is made of', async () => {
    if (!(await canvasAvailable())) return;
    const host = await installHeadlessCanvas();
    disposers.push(() => host.dispose());

    const canvas = new OffscreenCanvas(64, 64);
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(56, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, '#001028');
    gradient.addColorStop(1, '#ffffff');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);

    const pixels = ctx.getImageData(0, 0, 64, 64).data;
    const dark = pixels[(32 * 64 + 56) * 4];
    const light = pixels[(32 * 64 + 2) * 4];
    expect(dark).toBeLessThan(40);          // the focus, near black
    expect(light).toBeGreaterThan(180);     // the far rim, near the page colour
  });

  it('round-trips a canvas through a bitmap, decode included', async () => {
    if (!(await canvasAvailable())) return;
    const host = await installHeadlessCanvas();
    disposers.push(() => host.dispose());

    const canvas = new OffscreenCanvas(8, 8);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ff8000';
    ctx.fillRect(0, 0, 8, 8);
    const blob = await canvas.convertToBlob({ type: 'image/png' });

    // A bitmap drawn before its decode finished painted nothing at all, with no
    // error — every filter downstream of the mark came out transparent black.
    const bitmap = await createImageBitmap(blob);
    const target = new OffscreenCanvas(8, 8);
    const targetCtx = target.getContext('2d', { willReadFrequently: true })!;
    targetCtx.drawImage(bitmap, 0, 0);
    const pixel = targetCtx.getImageData(0, 0, 1, 1).data;
    expect([pixel[0], pixel[1], pixel[2]]).toEqual([255, 128, 0]);
  });
});

describe('the local file transport', () => {
  it('content-addresses a filename, so two inputs never share one output file', () => {
    const first = contentAddressed('.cascade-cache/logo.png', new Uint8Array([1, 2, 3]));
    const second = contentAddressed('.cascade-cache/logo.png', new Uint8Array([4, 5, 6]));
    expect(first).not.toBe(second);
    expect(first).toMatch(/^\.cascade-cache\/logo\.[0-9a-f]{12}\.png$/);
  });

  it('writes into the cache directory and reads the same bytes back', async () => {
    const project = scratchProject();
    const bridge = createIoBridge(project);
    const stored = await bridge.write('.cascade-cache/thing.bin', new Uint8Array([9, 8, 7]));
    expect(stored.startsWith('.cascade-cache/')).toBe(true);
    expect(Array.from(await bridge.read(stored))).toEqual([9, 8, 7]);
  });

  it('refuses a write outside the cache directory, the way the server route does', async () => {
    const bridge = createIoBridge(scratchProject());
    await expect(bridge.write('renders/final.png', new Uint8Array([1]))).rejects.toThrow(/confined/);
  });

  it('refuses an empty write rather than storing a file nothing can decode', async () => {
    const bridge = createIoBridge(scratchProject());
    await expect(bridge.write('.cascade-cache/empty.png', new Uint8Array())).rejects.toThrow(/empty/);
  });

  it('says which file it could not read', async () => {
    const bridge = createIoBridge(scratchProject());
    await expect(bridge.read('.cascade-cache/absent.png')).rejects.toThrow(/absent\.png/);
  });
});

describe('cascade/io over the local transport', () => {
  it('saves a canvas and loads it back with no server anywhere', async () => {
    if (!(await canvasAvailable())) return;
    const host = await installHeadlessCanvas();
    disposers.push(() => host.dispose());
    const project = scratchProject();
    disposers.push(installIoBridge(createIoBridge(project)));

    const canvas = new OffscreenCanvas(16, 16);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#204080';
    ctx.fillRect(0, 0, 16, 16);

    const stored = await saveImage(canvas, '.cascade-cache/test.png');
    expect(fs.existsSync(project.resolve(stored))).toBe(true);

    const bitmap = await loadBitmap(stored);
    expect([bitmap.width, bitmap.height]).toEqual([16, 16]);
  });

  it('accepts a raw Skia canvas too — saveImage takes whatever the host draws with', async () => {
    if (!(await canvasAvailable())) return;
    const project = scratchProject();
    disposers.push(installIoBridge(createIoBridge(project)));

    const encoded = new Uint8Array([137, 80, 78, 71]);
    const source = { encode: async () => encoded };
    const stored = await saveImage(source, '.cascade-cache/raw.png');
    expect(Array.from(fs.readFileSync(project.resolve(stored)))).toEqual([137, 80, 78, 71]);
  });

  /**
   * Round 2's first move: a 1024² intermediate cost 157 ms in Skia's default
   * PNG encoder, eight times a frame in field-logo. Counted rather than timed,
   * so the guard holds on a loaded machine: no canvas encode at all, and the
   * zlib stream in the file says level 1 (FLEVEL 0).
   */
  it('saves an intermediate as a level-1 PNG, never through the canvas encoder', async () => {
    if (!(await canvasAvailable())) return;
    const host = await installHeadlessCanvas();
    disposers.push(() => host.dispose());
    const project = scratchProject();
    disposers.push(installIoBridge(createIoBridge(project)));

    const canvas = new OffscreenCanvas(1024, 1024);
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, 1024, 1024);
    gradient.addColorStop(0, '#203040');
    gradient.addColorStop(1, '#f0e0d0');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1024, 1024);
    let encodes = 0;
    for (const name of ['convertToBlob', 'encode', 'encodeSync', 'toBuffer'] as const) {
      const original = (canvas as any)[name];
      (canvas as any)[name] = (...args: unknown[]) => { encodes += 1; return original.apply(canvas, args); };
    }

    const stored = await saveImage(canvas, '.cascade-cache/filter.png');
    expect(encodes).toBe(0);
    expect(zlibLevel(fs.readFileSync(project.resolve(stored)))).toBe(0);
    const bitmap = await loadBitmap(stored);
    const back = new OffscreenCanvas(1024, 1024).getContext('2d')!;
    back.drawImage(bitmap, 0, 0);
    expect(Buffer.from(back.getImageData(0, 0, 1024, 1024).data).equals(Buffer.from(ctx.getImageData(0, 0, 1024, 1024).data))).toBe(true);
  });

  /**
   * Move 1 M: in a run that keeps pixels, the next node gets them from memory
   * (no read, no decode), the PNG is written behind, and the path is a whole
   * file by the time anything reads it from disk.
   */
  it('hands an image on in memory and writes its file behind', async () => {
    if (!(await canvasAvailable())) return;
    const host = await installHeadlessCanvas();
    disposers.push(() => host.dispose());
    const project = scratchProject();
    disposers.push(installProjectIo(project, { resident: true }));
    const store = residentImages(project)!;
    expect(store).toBeDefined();

    const canvas = new OffscreenCanvas(64, 32);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#c04020';
    ctx.fillRect(0, 0, 64, 32);
    ctx.fillStyle = 'rgba(32, 64, 200, 0.5)';
    ctx.fillRect(8, 8, 24, 12);
    const expected = Buffer.from(ctx.getImageData(0, 0, 64, 32).data);

    const stored = await saveImage(canvas, '.cascade-cache/held.png');
    expect(stored).toMatch(/^\.cascade-cache\/held\.[0-9a-f]{12}\.png$/);
    expect(store.pixels(stored)?.width).toBe(64);

    // Read back from memory: a canvas holding the pixels, not a decoded file.
    const bitmap = await loadBitmap(stored);
    expect(typeof (bitmap as unknown as { getContext?: unknown }).getContext).toBe('function');
    const back = new OffscreenCanvas(64, 32).getContext('2d')!;
    back.drawImage(bitmap, 0, 0);
    expect(Buffer.from(back.getImageData(0, 0, 64, 32).data).equals(expected)).toBe(true);

    // Behind: a level-1 PNG with the same pixels, once settled.
    await settleProjectImages(project);
    const file = fs.readFileSync(project.resolve(stored));
    expect(zlibLevel(file)).toBe(0);
    expect(store.encodes).toBe(1);

    // The same pixels again are the same path, and not encoded twice.
    expect(await saveImage(canvas, '.cascade-cache/held.png')).toBe(stored);
    await settleProjectImages(project);
    expect(store.encodes).toBe(1);

    // A saved output is written from the pixels at full compression.
    const final = path.join(project.root, 'final.png');
    await copyImageFile(project, stored, final);
    expect(zlibLevel(fs.readFileSync(final))).toBe(2);
    const decoded = await createImageBitmap(new Blob([fs.readFileSync(final)]));
    const check = new OffscreenCanvas(64, 32).getContext('2d')!;
    check.drawImage(decoded, 0, 0);
    expect(Buffer.from(check.getImageData(0, 0, 64, 32).data).equals(expected)).toBe(true);
  });

  it('cascade/image writeImage and readImage hand on in memory through the assets capability', async () => {
    if (!(await canvasAvailable())) return;
    const host = await installHeadlessCanvas();
    disposers.push(() => host.dispose());
    const project = scratchProject();
    disposers.push(installProjectIo(project, { resident: true }));
    const context = { capabilities: { assets: createNodeAssetCapability(project) } };
    const { canvas, context: g } = surface(16, 8);
    g.fillStyle = '#10a0f0';
    g.fillRect(0, 0, 16, 8);
    const ref = await writeImage(context, canvas, 'swatch.png');
    expect(ref.path).toMatch(/^\.cascade-cache\/swatch\.[0-9a-f]{12}\.png$/);
    const image = await readImage(context, ref);
    expect(typeof (image as unknown as { getContext?: unknown }).getContext).toBe('function');
    await settleProjectImages(project);
    expect(fs.existsSync(project.resolve(ref.path))).toBe(true);
  });

  it('reading a held image as a file waits for the write behind', async () => {
    if (!(await canvasAvailable())) return;
    const host = await installHeadlessCanvas();
    disposers.push(() => host.dispose());
    const project = scratchProject();
    disposers.push(installProjectIo(project, { resident: true }));
    const canvas = new OffscreenCanvas(32, 32);
    canvas.getContext('2d')!.fillRect(0, 0, 32, 32);
    const stored = await saveImage(canvas, '.cascade-cache/wait.png');
    // No settle: `read` is the door a Python-bound or byte reader uses.
    const bytes = await createIoBridge(project).read(stored);
    expect([...bytes.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
  });

  it('lets old written images go past the budget, never one still being written', async () => {
    const project = scratchProject();
    const store = new ResidentImages(project, 100);
    const pixels = (value: number) => ({ width: 4, height: 4, data: new Uint8ClampedArray(64).fill(value) });
    const first = store.keep('.cascade-cache/a.png', pixels(1));
    const second = store.keep('.cascade-cache/b.png', pixels(2));
    // Both pending: over budget, both held.
    expect(store.pixels(first)).toBeDefined();
    await store.settle();
    store.keep('.cascade-cache/c.png', pixels(3));
    expect(store.pixels(first)).toBeUndefined();
    expect(fs.existsSync(project.resolve(first))).toBe(true);
    expect(fs.existsSync(project.resolve(second))).toBe(true);
  });

  it('writes bytes through the bridge and returns the stored path', async () => {
    const project = scratchProject();
    disposers.push(installIoBridge(createIoBridge(project)));
    const stored = await saveBytes(new Uint8Array([1, 2, 3, 4]), '.cascade-cache/data.bin');
    expect(fs.readFileSync(project.resolve(stored)).length).toBe(4);
  });
});

describe('--frames', () => {
  it('reads a range', () => {
    expect(parseFrameSpec('1-100')).toEqual({ start: 1, end: 100 });
  });

  it('reads a range with a step', () => {
    expect(parseFrameSpec('1-100x2')).toEqual({ start: 1, end: 100, step: 2 });
  });

  it('reads a single frame as a range of one', () => {
    expect(parseFrameSpec('42')).toEqual({ start: 42, end: 42 });
  });

  it('rejects a backwards range instead of rendering nothing', () => {
    expect(() => parseFrameSpec('100-1')).toThrow(/must not be before/);
  });

  it('rejects a step of zero instead of looping forever', () => {
    expect(() => parseFrameSpec('1-10x0')).toThrow(/greater than 0/);
  });

  it('rejects a typo rather than guessing at it', () => {
    expect(() => parseFrameSpec('one to ten')).toThrow(/expects a range/);
  });
});
