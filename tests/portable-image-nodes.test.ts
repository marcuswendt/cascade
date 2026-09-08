/** Compatibility image nodes must cook without DOM-only assumptions. */
import { describe, it, expect, afterEach, type TestContext } from 'vitest';
import { Graph } from '@/nodes/Graph';
import { ImageBuffer } from '@/nodes/image/ImageBuffer';
import { CheckersNode } from '@/nodes/image/nodes/CheckersNode';
import { ColorNode } from '@/nodes/image/nodes/ColorNode';
import { TextNode } from '@/nodes/image/nodes/TextNode';
import { ImageNode } from '@/nodes/image/nodes/ImageNode';
import { FreezeNode } from '@/nodes/core/nodes/FreezeNode';
import { canvasAvailable, installHeadlessCanvas } from '@/cli/headlessCanvas';
import {
  MissingRenderSurfaceError,
  createSurface,
  decodeImage,
  surfaceAvailable,
  surfaceProviderName,
  type RenderSurface,
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

// The first pass discovers ports; the second commits the cooked value.
async function cook(node: { execute(): Promise<void>; error: Error | null; outputs: { value: unknown }[] }): Promise<ImageBuffer> {
  await node.execute();
  await node.execute();
  if (node.error) throw node.error;
  const value = node.outputs[0]?.value;
  if (!(value instanceof ImageBuffer)) {
    throw new Error(`node produced ${value === undefined ? 'no output' : String(value)} rather than an ImageBuffer`);
  }
  return value;
}

function maxChannelDifference(a: ImageBuffer, b: ImageBuffer): number {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`size mismatch: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  const left = a.toImageData().data;
  const right = b.toImageData().data;
  let worst = 0;
  for (let i = 0; i < left.length; i++) {
    const difference = Math.abs(left[i] - right[i]);
    if (difference > worst) worst = difference;
  }
  return worst;
}

function inkFraction(buffer: ImageBuffer): number {
  const red = buffer.r();
  let lit = 0;
  for (let i = 0; i < red.length; i++) if (red[i] > 0.5) lit++;
  return lit / red.length;
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
    const buffer = ImageBuffer.fromCanvas(decoded);
    expect(Math.round(buffer.getValue(4, 4, 0) * 255)).toBe(255);
    expect(Math.round(buffer.getValue(4, 4, 1) * 255)).toBe(128);
    expect(Math.round(buffer.getValue(4, 4, 2) * 255)).toBe(0);
  });
});

describe('an image node with no document anywhere', () => {
  it('cooks a checkerboard — arithmetic that used to die on its own preview', async () => {
    expect(typeof document).toBe('undefined');
    expect(typeof OffscreenCanvas).toBe('undefined');

    const node = new CheckersNode('checkers', new Graph());
    const buffer = await cook(node);

    expect([buffer.width, buffer.height]).toEqual([512, 512]);
    expect(buffer.getValue(0, 0, 0)).toBe(1);
    expect(buffer.getValue(32, 0, 0)).toBe(0);
    expect(node.preview).toBeNull();
  });

  it('freezes ordinary data without evaluating missing DOM constructors', () => {
    expect(typeof document).toBe('undefined');
    expect(typeof HTMLCanvasElement).toBe('undefined');

    const node = new FreezeNode('freeze', new Graph());
    node.inputs[0].value = { values: [1, 2, 3] };

    expect(() => node.capture()).not.toThrow();
    expect(node.outputs[0].value).toEqual({ values: [1, 2, 3] });
  });

  it('cooks text through the host surface, letter metrics included', async (testContext) => {
    await headless(testContext);

    const node = new TextNode('text', new Graph());
    node.setParm('text', 'HI');
    node.setParm('fontSize', 96);
    node.setParm('color', { r: 1, g: 1, b: 1, a: 1 });
    node.setParm('letterSpacing', 4);
    const buffer = await cook(node);

    expect(inkFraction(buffer)).toBeGreaterThan(0.002);
  });

  it('decodes a file into a buffer, with no Image events to wait on', async (testContext) => {
    await headless(testContext);

    const source = createSurface(16, 16);
    const context = source.getContext('2d') as CanvasRenderingContext2D;
    context.fillStyle = '#00ff00';
    context.fillRect(0, 0, 16, 16);
    const encoded = await (source as unknown as { encode(f: string): Promise<Uint8Array> }).encode('png');
    const dataUri = `data:image/png;base64,${Buffer.from(encoded).toString('base64')}`;

    const node = new ImageNode('file', new Graph());
    node.setParm('file', dataUri);
    const buffer = await cook(node);

    expect([buffer.width, buffer.height]).toEqual([16, 16]);
    expect(Math.round(buffer.getValue(8, 8, 1) * 255)).toBe(255);
    expect(Math.round(buffer.getValue(8, 8, 0) * 255)).toBe(0);
  });
});

describe('arithmetic and raster surfaces', () => {
  it('a solid colour: Float32 arithmetic against a Skia fill', async (testContext) => {
    await headless(testContext);

    const node = new ColorNode('color', new Graph());
    node.setParm('color', { r: 0.2, g: 0.5, b: 0.8, a: 1 });
    const viaArithmetic = await cook(node);

    const surface = createSurface(viaArithmetic.width, viaArithmetic.height);
    const context = surface.getContext('2d') as CanvasRenderingContext2D;
    context.fillStyle = `rgb(${Math.round(0.2 * 255)}, ${Math.round(0.5 * 255)}, ${Math.round(0.8 * 255)})`;
    context.fillRect(0, 0, surface.width, surface.height);
    const viaRasteriser = ImageBuffer.fromCanvas(surface);

    const difference = maxChannelDifference(viaArithmetic, viaRasteriser);
    expect(difference).toBeLessThanOrEqual(1);
  });
});
