/**
 * The compatibility engine's drawing seam must work without DOM-only
 * assumptions. (The image library it used to serve is definition-v1 since
 * 2026-11-07 and is covered by `image-golden.test.ts`; Freeze still snapshots
 * canvases through this seam.)
 */
import { describe, it, expect, afterEach, type TestContext } from 'vitest';
import { Graph } from '@/nodes/Graph';
import { FreezeNode } from '@/nodes/core/nodes/FreezeNode';
import { canvasAvailable, installHeadlessCanvas } from '@/cli/headlessCanvas';
import {
  MissingRenderSurfaceError,
  createSurface,
  decodeImage,
  hasPixels,
  surfaceAvailable,
  surfaceProviderName,
} from '@/nodes/image/surface';

const disposers: (() => void)[] = [];
afterEach(() => {
  while (disposers.length) disposers.pop()!();
});

async function headless(context: TestContext): Promise<void> {
  if (!(await canvasAvailable())) {
    context.skip();
    return;
  }
  const host = await installHeadlessCanvas();
  disposers.push(() => host.dispose());
}

describe('the drawing seam', () => {
  it('reports which renderer is answering', async (testContext) => {
    await headless(testContext);
    expect(surfaceProviderName()).toBe('OffscreenCanvas');
  });

  it('prefers the DOM where a host has both, so Studio keeps handing the editor a real canvas', async (testContext) => {
    await headless(testContext);
    const fake = { createElement: () => ({ getContext: () => null }) };
    const globals = globalThis as Record<string, unknown>;
    globals.document = fake;
    disposers.push(() => { delete globals.document; });
    expect(surfaceProviderName()).toBe('DOM canvas');
  });

  it('names the missing renderer rather than throwing "document is not defined"', () => {
    const globals = globalThis as Record<string, unknown>;
    const previous = globals.OffscreenCanvas;
    delete globals.OffscreenCanvas;
    disposers.push(() => { if (previous !== undefined) globals.OffscreenCanvas = previous; });

    expect(surfaceAvailable()).toBe(false);
    expect(() => createSurface(4, 4)).toThrow(MissingRenderSurfaceError);
    expect(() => createSurface(4, 4)).toThrow(/@napi-rs\/canvas/);
  });

  it('waits for the decode, so a decoded image actually carries its pixels', async (testContext) => {
    await headless(testContext);
    const source = createSurface(8, 8);
    const context = source.getContext('2d') as CanvasRenderingContext2D;
    context.fillStyle = '#ff8000';
    context.fillRect(0, 0, 8, 8);
    const bytes = new Uint8Array(await (source as unknown as { encode(f: string): Promise<Uint8Array> }).encode('png'));

    const decoded = await decodeImage(bytes);
    expect([decoded.width, decoded.height]).toEqual([8, 8]);
    expect(hasPixels(decoded)).toBe(true);
    const target = createSurface(8, 8);
    const drawing = target.getContext('2d') as CanvasRenderingContext2D;
    drawing.drawImage(decoded as CanvasImageSource, 0, 0);
    expect(Array.from(drawing.getImageData(4, 4, 1, 1).data)).toEqual([255, 128, 0, 255]);
  });
});

describe('a compatibility node with no document anywhere', () => {
  it('freezes ordinary data without evaluating missing DOM constructors', () => {
    expect(typeof document).toBe('undefined');
    expect(typeof HTMLCanvasElement).toBe('undefined');

    const node = new FreezeNode('freeze', new Graph());
    node.inputs[0].value = { values: [1, 2, 3] };

    expect(() => node.capture()).not.toThrow();
    expect(node.outputs[0].value).toEqual({ values: [1, 2, 3] });
  });
});
