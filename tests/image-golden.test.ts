/**
 * Golden images for `cascade.image.*`, captured on the class-based nodes.
 *
 * Marcus decided on 2026-11-07 to port the eleven class image nodes to
 * definition-v1. The port is only a port if every fixture renders the same
 * pixels afterwards, so this file renders each fixture in
 * `fixtures/image-golden/fixtures.ts` on the class nodes and holds the result
 * as a PNG beside it. A missing golden is written (that is the capture); an
 * existing one must match exactly.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Graph } from '@/nodes/Graph';
import { ImageBuffer } from '@/nodes/image/ImageBuffer';
import { registerStandardNodes } from '@/nodes/registerStandardNodes';
import { canvasAvailable, installHeadlessCanvas, type CanvasHost } from '@/cli/headlessCanvas';
import { cookUntilSettled } from '@/cli/frames';
import { encodePixelsPng, FINAL_PNG } from '@/cli/headlessIo';
import { decodeImage } from '@/cli/assertNodes';
import { fixtureDocument, fixtures, inputPixels, INPUT_SIZE, INPUT2_SIZE } from './fixtures/image-golden/fixtures';

const DIR = path.resolve('tests/fixtures/image-golden');
const INPUT = path.join(DIR, 'input.png');
const INPUT2 = path.join(DIR, 'input2.png');
// The class Noise node loads simplex-noise from esm.sh through the graph's
// package manager; the capture used the same release (4.0.3) from disk, and
// without it on disk the noise fixtures are skipped rather than fetched.
const SIMPLEX_FILE = '/Users/marcus/.field-io/cairn/agents/C-CASCADE-EVOLUTION-BUILD/work/image-port/simplex/node_modules/simplex-noise/dist/esm/simplex-noise.js';
const SIMPLEX = fs.existsSync(SIMPLEX_FILE) ? SIMPLEX_FILE : null;

let host: CanvasHost | null = null;
const available = await canvasAvailable();

async function writeInput(file: string, [width, height]: readonly [number, number], salt: number): Promise<void> {
  if (fs.existsSync(file)) return;
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(file, await encodePixelsPng({ width, height, data: inputPixels(width, height, salt) }, FINAL_PNG));
}

beforeAll(async () => {
  if (!available) return;
  host = await installHeadlessCanvas();
  registerStandardNodes();
  await writeInput(INPUT, INPUT_SIZE, 1);
  await writeInput(INPUT2, INPUT2_SIZE, 2);
});

afterAll(() => host?.dispose());

async function renderOnClasses(fixture: (typeof fixtures)[number]): Promise<ImageBuffer> {
  const graph = Graph.fromJSON(fixtureDocument(fixture, { input: INPUT, input2: INPUT2 }));
  if (SIMPLEX) {
    const simplex = await import(pathToFileURL(SIMPLEX).href);
    (graph.packageManager as unknown as { load: () => Promise<unknown> }).load = async () => simplex;
  }
  graph.restoreConnections();
  await cookUntilSettled(graph, undefined, { fixpoint: true });
  graph.scheduler?.dispose?.();
  const failed = graph.nodes.filter((node) => node.error !== null);
  expect(failed.map((node) => `${node.id}: ${node.error?.message}`)).toEqual([]);
  const value = graph.getNode('out')?.outputs.find((port) => port.name === 'image')?.value;
  if (!(value instanceof ImageBuffer)) throw new Error(`${fixture.name}: no image (${String(value)})`);
  return value;
}

describe.skipIf(!available)('cascade.image.* golden images (class nodes)', () => {
  for (const fixture of fixtures) {
    it.skipIf(!SIMPLEX && fixture.nodes.some((node) => node.module === 'cascade.image.Noise'))(fixture.name, async () => {
      const buffer = await renderOnClasses(fixture);
      const rgba = new Uint8ClampedArray(buffer.toImageData().data);
      const file = path.join(DIR, `${fixture.name}.png`);
      if (!fs.existsSync(file)) {
        fs.writeFileSync(file, await encodePixelsPng({ width: buffer.width, height: buffer.height, data: rgba }, FINAL_PNG));
      }
      const golden = decodeImage(new Uint8Array(fs.readFileSync(file)));
      expect(golden && [golden.width, golden.height, golden.channels]).toEqual([buffer.width, buffer.height, 4]);
      expect(Buffer.from(golden!.data).equals(Buffer.from(rgba))).toBe(true);
    });
  }
});
