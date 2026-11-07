/**
 * Golden images for `cascade.image.*`.
 *
 * Marcus decided on 2026-11-07 to port the eleven class image nodes to
 * definition-v1. The port is only a port if every fixture renders the same
 * pixels afterwards, so each fixture in `fixtures/image-golden/fixtures.ts`
 * was rendered on the class nodes first and the result kept beside it as a
 * PNG. Here the definition-v1 nodes render the same graphs through the
 * deterministic runtime, the way `cascade run` does, and must match exactly.
 *
 * Exactly, not within a tolerance: the ported loops are the class loops on the
 * same Float32 planes, and every input is an 8-bit PNG that both engines decode
 * with the same canvas. The text fixtures depend on the faces Skia finds for
 * `sans-serif` on the machine that renders them; on another machine they are
 * re-captured (delete the PNG and run the class capture from git history), not
 * loosened.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { AssetCapability, ImagePixels, ImageRef } from '../packages/contracts/src/index.js';
import { createBrowserRuntimeHost } from '../packages/runtime/src/browser.js';
import { createRuntime } from '../packages/runtime/src/index.js';
import { Graph } from '@/nodes/Graph';
import { studioImagePixels } from '@/nodes/definition/studioImages';
import { canvasAvailable, installHeadlessCanvas, type CanvasHost } from '@/cli/headlessCanvas';
import { cookUntilSettled } from '@/cli/frames';
import { decodeImage } from '../packages/runtime/src/builtins/assert/checks.js';
import { fixtureDocument, fixtures, type GoldenFixture } from './fixtures/image-golden/fixtures';

const DIR = path.resolve('tests/fixtures/image-golden');

let host: CanvasHost | null = null;
const available = await canvasAvailable();

beforeAll(async () => {
  if (available) host = await installHeadlessCanvas();
});

afterAll(() => host?.dispose());

async function golden(fixture: GoldenFixture): Promise<ImagePixels> {
  const decoded = await decodeImage(new Uint8Array(fs.readFileSync(path.join(DIR, `${fixture.name}.png`))));
  if (!decoded || decoded.channels !== 4) throw new Error(`${fixture.name}: unreadable golden`);
  return { width: decoded.width, height: decoded.height, data: new Uint8ClampedArray(decoded.data) };
}

function expectSame(actual: ImagePixels, expected: ImagePixels): void {
  expect([actual.width, actual.height]).toEqual([expected.width, expected.height]);
  let worst = 0;
  let differing = 0;
  for (let index = 0; index < expected.data.length; index += 1) {
    const difference = Math.abs(actual.data[index]! - expected.data[index]!);
    if (difference) differing += 1;
    worst = Math.max(worst, difference);
  }
  expect({ worst, differing }).toEqual({ worst: 0, differing: 0 });
}

/**
 * The headless host's asset contract in miniature: project files read from
 * this directory, images kept as pixels in memory (`keepImage` /
 * `imagePixels`), or — with `keep: false` — encoded and stored as bytes, the
 * way an exported editor stores them.
 */
function memoryAssets(keep: boolean): AssetCapability & { pixelsOf(ref: ImageRef): Promise<ImagePixels> } {
  const kept = new Map<string, ImagePixels>();
  const written = new Map<string, Uint8Array>();
  let sequence = 0;
  return {
    async read(ref) {
      return written.get(ref.path) ?? new Uint8Array(fs.readFileSync(path.join(DIR, ref.path)));
    },
    async write(data, metadata) {
      const name = `.generated/${++sequence}-${metadata.suggestedName}`;
      written.set(name, data);
      return { path: name, mediaType: metadata.mediaType };
    },
    ...(keep ? {
      async keepImage(pixels: ImagePixels, metadata: { suggestedName?: string }) {
        const name = `.kept/${++sequence}-${metadata.suggestedName}`;
        kept.set(name, pixels);
        return { path: name, mediaType: 'image/png' };
      },
      imagePixels(ref: { path: string }) {
        return kept.get(ref.path);
      },
    } : {}),
    async pixelsOf(ref) {
      const pixels = kept.get(ref.path);
      if (pixels) return pixels;
      const decoded = await decodeImage(written.get(ref.path)!);
      if (!decoded || decoded.channels !== 4) throw new Error(`unreadable ${ref.path}`);
      return { width: decoded.width, height: decoded.height, data: new Uint8ClampedArray(decoded.data) };
    },
  };
}

async function renderOnRuntime(fixture: GoldenFixture, keep = true): Promise<ImagePixels> {
  const assets = memoryAssets(keep);
  const runtime = createRuntime({
    host: createBrowserRuntimeHost({ modules: { resolve: async () => null }, assets }),
  });
  const graph = await runtime.load(fixtureDocument(fixture, { input: 'input.png', input2: 'input2.png' }) as never);
  const result = await graph.run();
  expect(result.status, JSON.stringify(result)).toBe('completed');
  const ref = graph.getOutput('out', 'image') as ImageRef;
  await graph.dispose();
  await runtime.dispose();
  const pixels = await assets.pixelsOf(ref);
  expect(ref.size).toEqual([pixels.width, pixels.height]);
  return pixels;
}

/**
 * Studio's path: the compatibility `Graph`, the definition adapter and the
 * page's asset capability, which keeps images in memory
 * (`src/nodes/definition/studioImages.ts`). Project files arrive over
 * the media route, stubbed here with the fixture files.
 */
async function renderInStudio(fixture: GoldenFixture): Promise<ImagePixels> {
  const graph = Graph.fromJSON(fixtureDocument(fixture, { input: 'input.png', input2: 'input2.png' }));
  graph.restoreConnections();
  // Not to a fixpoint: every cook keeps a fresh image under a fresh path, so
  // re-cooking a clean graph would never read as settled.
  await cookUntilSettled(graph, undefined);
  graph.scheduler?.dispose?.();
  const failed = graph.nodes.filter((node) => node.error !== null);
  expect(failed.map((node) => `${node.id}: ${node.error?.message}`)).toEqual([]);
  const ref = graph.getNode('out')?.outputs.find((port) => port.name === 'image')?.value as ImageRef | undefined;
  const pixels = ref && studioImagePixels(ref.path);
  if (!pixels) throw new Error(`${fixture.name}: no kept image (${JSON.stringify(ref)})`);
  return pixels;
}

describe.skipIf(!available)('cascade.image.* golden images (definition-v1, Studio)', () => {
  beforeAll(async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      const name = decodeURIComponent(String(url).replace(/^\/api\/media\//, '').replace(/\?.*$/, ''));
      return new Response(new Uint8Array(fs.readFileSync(path.join(DIR, name))));
    });
    await import('@/nodes/image/index');
  });
  afterAll(() => vi.unstubAllGlobals());

  for (const fixture of fixtures) {
    it(fixture.name, async () => {
      expectSame(await renderInStudio(fixture), await golden(fixture));
    });
  }
});

describe.skipIf(!available)('cascade.image.* golden images (definition-v1, deterministic runtime)', () => {
  for (const fixture of fixtures) {
    it(fixture.name, async () => {
      expectSame(await renderOnRuntime(fixture), await golden(fixture));
    });
  }

  // A font file the project does not have falls back to sans-serif, as
  // cascade/image's rule says, rather than failing the cook.
  it('text with a missing font file draws in sans-serif', async () => {
    const fixture = fixtures.find((candidate) => candidate.name === 'text')!;
    const missing = {
      ...fixture,
      nodes: fixture.nodes.map((node) => ({ ...node, props: { ...node.props, font: 'assets/fonts/Missing.otf' } })),
    };
    expectSame(await renderOnRuntime(missing), await golden(fixture));
  });

  // A host without keepImage (an exported editor, the web player) encodes a
  // PNG through `write` instead. Opaque images survive that exactly; a
  // translucent one goes through the canvas's premultiplied store and may not.
  it.each(['color', 'checkers-size', 'blur-box', 'transform-bilinear', 'text'])('%s through a host that stores PNG bytes', async (name) => {
    const fixture = fixtures.find((candidate) => candidate.name === name)!;
    expectSame(await renderOnRuntime(fixture, false), await golden(fixture));
  });
});
