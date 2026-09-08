/**
 * The standard library, under a Node host.
 *
 * `initializeNodeLibraries()` is Studio's entry point and it cannot be the
 * CLI's: `src/nodes/core/index.ts` and `src/nodes/image/index.ts` import their
 * own source text with Vite's `?raw`, for the in-Studio code viewer, and `?raw`
 * is not a thing outside Vite. So the CLI imported neither, the class registry
 * was empty in a Node process, and every `cascade.image.*` node in a graph died
 * at load with "Unknown Cascade node type: cascade.image.Color" — an artist's
 * image graph rendered in Studio and could not render headlessly at all.
 *
 * `registerStandardNodes()` is the Node-safe half: the classes, no source text.
 * These tests hold both ends of that — the registry is populated, a graph of
 * class-based nodes actually cooks pixels in a process with no `document`, and
 * the module stays free of the `?raw` imports that were the obstacle.
 */
import { describe, it, expect, afterEach, type TestContext } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { Graph } from '@/nodes/Graph';
import { ImageBuffer } from '@/nodes/image/ImageBuffer';
import { getNodeClass } from '@/utils/nodeTypeUtils';
import { registerStandardNodes } from '@/nodes/registerStandardNodes';
import { canvasAvailable, installHeadlessCanvas } from '@/cli/headlessCanvas';
import { cookUntilSettled } from '@/cli/frames';

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

const colorToBlur = {
  version: '0.2',
  nodes: [
    {
      id: 'Color1',
      module: 'cascade.image.Color',
      position: [0, 0],
      source: 'stdlib',
      props: { color: [0.9, 0.2, 0.1, 1], resolution: [32, 32] },
    },
    { id: 'Blur1', module: 'cascade.image.Blur', position: [0, 200], source: 'stdlib' },
  ],
  connections: [[['Color1', 0, 'image'], ['Blur1', 0, 'image']]],
};

describe('the Node-safe standard library registration', () => {
  it('registers the class-based image and core nodes', () => {
    registerStandardNodes();
    expect(getNodeClass('cascade.image.Color')).toBeTruthy();
    expect(getNodeClass('cascade.image.Blur')).toBeTruthy();
    expect(getNodeClass('cascade.core.Switch')).toBeTruthy();
  });

  it('lets a graph of class-based nodes load, which is what the CLI could not do', () => {
    registerStandardNodes();
    const graph = Graph.fromJSON(colorToBlur);
    expect(graph.nodes.map((node) => node.id).sort()).toEqual(['Blur1', 'Color1']);
  });

  it('cooks that graph to real pixels with no document in the process', async (context) => {
    expect(typeof (globalThis as { document?: unknown }).document).toBe('undefined');
    await headless(context);
    registerStandardNodes();

    const graph = Graph.fromJSON(colorToBlur);
    graph.restoreConnections();
    await cookUntilSettled(graph, undefined, { fixpoint: true });
    graph.scheduler?.dispose?.();

    const failed = graph.nodes.filter((node) => node.error !== null);
    expect(failed.map((node) => `${node.id}: ${node.error?.message}`)).toEqual([]);

    const blurred = graph.getNode('Blur1')?.outputs[0]?.value;
    expect(blurred).toBeInstanceOf(ImageBuffer);
    const buffer = blurred as ImageBuffer;
    expect([buffer.width, buffer.height]).toEqual([32, 32]);
    // The pixels themselves, not just an object: a solid red that survived a blur.
    const [r, g, b] = buffer.getPixel(16, 16);
    expect(r).toBeGreaterThan(0.8);
    expect(g).toBeLessThan(0.4);
    expect(b).toBeLessThan(0.4);
  });

  it('reaches for no Vite ?raw source, which is what kept the CLI out', () => {
    const files = [
      'src/nodes/registerStandardNodes.ts',
      'src/nodes/core/classes.ts',
      'src/nodes/image/classes.ts',
    ];
    for (const file of files) {
      const source = fs.readFileSync(path.resolve(file), 'utf8');
      // The prose in these files names `?raw`; an import of one is the fault.
      expect(source.match(/^\s*import[^\n]*\?raw/gm) ?? []).toEqual([]);
    }
  });

  it('leaves the CLI bundleable by esbuild, where ?raw does not resolve', async () => {
    const result = await build({
      entryPoints: [path.resolve('src/cli/index.ts')],
      bundle: true,
      write: false,
      packages: 'external',
      platform: 'node',
      target: 'node20',
      format: 'esm',
      logLevel: 'silent',
      tsconfig: path.resolve('tsconfig.json'),
    });
    expect(result.errors).toEqual([]);
    expect(result.outputFiles[0].text).toContain('cascade.image.Color');
  }, 60_000);
});
