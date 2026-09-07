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
import { contentAddressed, createIoBridge } from '@/cli/headlessIo';
import { parseFrameSpec } from '@/cli/frames';
import { installIoBridge, saveImage, loadBitmap, saveBytes } from '../server/src/runtime/io';
import { ProjectRoot } from '../server/src/project';

const disposers: (() => void)[] = [];
afterEach(() => {
  while (disposers.length) disposers.pop()!();
});

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
