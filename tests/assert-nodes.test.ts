/**
 * `cascade.assert.*`: a check in the graph that fails the run, with a message
 * an agent can read in the `--json` envelope.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { captureEnvelope } from '@/cli/jsonEnvelope';
import { runGraph } from '@/cli/runner';
import { blankness, decodeImage } from '../packages/runtime/src/builtins/assert/checks.js';
import { moduleDefinitions } from '@/cli/projectRuntime';

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/** A 2x2 RGBA PNG with the given pixels, filter type 1 on the second row to exercise unfiltering. */
function png(pixels: number[][]): Buffer {
  const chunk = (type: string, body: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, 'ascii');
    return Buffer.concat([head, body, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const row0 = [0, ...pixels[0]!, ...pixels[1]!];
  const second = [...pixels[2]!, ...pixels[3]!];
  const row1 = [1, ...second.map((value, index) => (value - (index >= 4 ? second[index - 4]! : 0) + 256) & 255)];
  const raw = Buffer.from([...row0, ...row1]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

describe('image blankness', () => {
  it('decodes a PNG and tells content from a flat colour and from transparency', async () => {
    const flat = (await decodeImage(png([[9, 9, 9, 255], [9, 9, 9, 255], [9, 9, 9, 255], [9, 9, 9, 255]])))!;
    expect(flat.width).toBe(2);
    expect(blankness(flat)).toMatch(/one flat colour \(rgb 9, 9, 9\)/);
    const clear = (await decodeImage(png([[1, 2, 3, 0], [4, 5, 6, 0], [7, 8, 9, 0], [0, 0, 0, 0]])))!;
    expect(blankness(clear)).toBe('fully transparent');
    const mark = (await decodeImage(png([[9, 9, 9, 255], [9, 9, 9, 255], [9, 9, 9, 255], [200, 9, 9, 255]])))!;
    expect(Array.from(mark.data).slice(12)).toEqual([200, 9, 9, 255]);
    expect(blankness(mark)).toBeNull();
    expect(blankness(mark, 255)).not.toBeNull();
  });
});

const imageSource = (level: number) => `
export const definition = {
  apiVersion: 1, runsOn: 'portable', capabilities: ['assets'], inputs: {},
  outputs: { image: { kind: 'data', type: 'image' } }, props: {}
} as const;
export async function execute(context) {
  const header = 'P6\\n2 1\\n255\\n';
  const bytes = new Uint8Array(header.length + 6).fill(${level});
  for (let i = 0; i < header.length; i++) bytes[i] = header.charCodeAt(i);
  bytes[bytes.length - 1] = ${level === 0 ? 0 : 255};
  context.outputs.image.set(await context.capabilities.assets.write(bytes, { mediaType: 'image/x-portable-pixmap', suggestedName: 'img.ppm' }, { signal: context.signal }));
}
`;

function project(nodes: unknown[], connections: unknown[], level = 10) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-assert-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'nodes', 'Img'), { recursive: true });
  fs.writeFileSync(path.join(root, 'nodes', 'Img', 'index.ts'), imageSource(level));
  const file = path.join(root, 'index.cascade');
  fs.writeFileSync(file, JSON.stringify({ version: '0.2', nodes, connections }));
  return file;
}

const wire = (from: string, output: string, to: string, input: string) => ({ source: { nodeId: from, outputName: output }, target: { nodeId: to, inputName: input } });

async function run(file: string, out?: string) {
  return captureEnvelope(() => runGraph({ file, json: true, ...(out ? { out } : {}) }));
}

describe('assertion nodes in a run', () => {
  it('reports an equality failure with both values', async () => {
    const file = project([{ id: 'same', module: 'cascade.assert.Equals', props: { expected: [1, 2] } }], []);
    const envelope = await run(file);
    expect(envelope.ok).toBe(false);
    expect(envelope.error!.message).toMatch(/Assertion failed in "same" \(cascade.assert.Equals\): got null, expected \[1,2\]/);
  }, 60_000);

  it('fails the run with the assertion message in the envelope', async () => {
    const file = project([
      { id: 'img', module: 'project.Img' },
      { id: 'seen', module: 'cascade.assert.NotBlank', props: { message: 'the poster rendered empty' } },
    ], [wire('img', 'image', 'seen', 'image')], 0);
    const envelope = await run(file);
    expect(envelope.ok).toBe(false);
    expect(envelope.error!.message).toMatch(/Assertion failed in "seen" \(cascade.assert.NotBlank\): .*img\..*ppm \(2x1\) is one flat colour \(rgb 0, 0, 0\)\. the poster rendered empty/);
  }, 60_000);

  it('passes, and the image is saved from its producer, not the assertion', async () => {
    const file = project([
      { id: 'img', module: 'project.Img' },
      { id: 'seen', module: 'cascade.assert.NotBlank' },
      { id: 'in-range', module: 'cascade.assert.Range', inputs: { value: 0.5 } },
      { id: 'is', module: 'cascade.assert.True', inputs: { value: true } },
    ], [wire('img', 'image', 'seen', 'image')]);
    const envelope = await run(file, 'stills');
    expect(envelope, JSON.stringify(envelope)).toMatchObject({ ok: true });
    expect((envelope.data as any).files).toEqual(['stills/img.ppm']);
  }, 60_000);

  it('reports a range failure', async () => {
    const file = project([{ id: 'r', module: 'cascade.assert.Range', inputs: { value: 3 }, props: { min: 0, max: 1 } }], []);
    const envelope = await run(file);
    expect(envelope.error!.message).toMatch(/Assertion failed in "r" \(cascade.assert.Range\): value 3 is outside \[0, 1\]/);
  }, 60_000);

  it('is known to the graph editor', async () => {
    const file = project([], []);
    const definitions = await moduleDefinitions(file, ['cascade.assert.Range']);
    expect(definitions.get('cascade.assert.Range')?.props).toHaveProperty('min');
    const { runGraphCommand } = await import('@/cli/graphCommands');
    await runGraphCommand(['node', 'add', file, 'NotBlank', '--set', 'tolerance=3'], { json: true });
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).nodes[0]).toMatchObject({ id: 'not-blank', module: 'cascade.assert.NotBlank' });
  }, 60_000);
});
