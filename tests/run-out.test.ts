/**
 * `cascade run --out`: outputs addressable as files.
 *
 * One file per image output (a node with two no longer writes both to one
 * name), a Null passing an image counts as an output, `--out-node` saves a
 * mid-graph node, an absolute `--out` is accepted, and the names are the node
 * (and port) rather than a cache hash.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runGraph, type RunOptions } from '@/cli/runner';

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const ppm = (name: string, level: number) => `
  {
    const header = 'P6\\n1 1\\n255\\n';
    const bytes = new Uint8Array(header.length + 3).fill(${level});
    for (let i = 0; i < header.length; i++) bytes[i] = header.charCodeAt(i);
    outputs.push(await context.capabilities.assets.write(bytes, { mediaType: 'image/x-portable-pixmap', suggestedName: '${name}.ppm' }, { signal: context.signal }));
  }`;

const pairSource = `
export const definition = {
  apiVersion: 1,
  runsOn: 'portable',
  capabilities: ['assets'],
  inputs: {},
  outputs: { image: { kind: 'data', type: 'image' }, mask: { kind: 'data', type: 'image' } },
  props: { level: { type: 'float', default: 10 } }
} as const;
export async function execute(context) {
  const outputs = [];
  ${ppm('pair-image', 10)}
  ${ppm('pair-mask', 200)}
  context.outputs.image.set(outputs[0]);
  context.outputs.mask.set(outputs[1]);
}
`;

const rampSource = `
export const definition = {
  apiVersion: 1,
  runsOn: 'portable',
  capabilities: ['assets'],
  inputs: {},
  outputs: { image: { kind: 'data', type: 'image' } },
  props: {}
} as const;
export async function execute(context) {
  const outputs = [];
  ${ppm('ramp', 77)}
  context.outputs.image.set(outputs[0]);
}
`;

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-run-out-'));
  roots.push(root);
  for (const [name, source] of [['Pair', pairSource], ['Ramp', rampSource]]) {
    fs.mkdirSync(path.join(root, 'nodes', name!), { recursive: true });
    fs.writeFileSync(path.join(root, 'nodes', name!, 'index.ts'), source!);
  }
  const file = path.join(root, 'index.cascade');
  fs.writeFileSync(file, JSON.stringify({
    version: '0.2',
    nodes: [
      { id: 'pair', module: 'project.Pair' },
      { id: 'ramp', module: 'project.Ramp' },
      { id: 'final', module: 'cascade.core.Null' },
    ],
    connections: [{ source: { nodeId: 'ramp', outputName: 'image' }, target: { nodeId: 'final', inputName: 'input' } }],
  }));
  return { root, file };
}

async function runJson(options: RunOptions): Promise<any> {
  let written = '';
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
    written += String(chunk);
    return true;
  });
  try {
    await runGraph({ ...options, json: true });
  } finally {
    write.mockRestore();
  }
  return JSON.parse(written.trim().split('\n').pop()!);
}

const level = (file: string) => {
  const bytes = fs.readFileSync(file);
  return bytes[bytes.length - 1];
};

describe('run --out', () => {
  it('saves a still: one file per image output, a Null counts, names are node[.port]', async () => {
    const { root, file } = project();
    const result = await runJson({ file, out: 'stills' });
    expect([...result.files].sort()).toEqual(['stills/final.ppm', 'stills/pair.image.ppm', 'stills/pair.mask.ppm']);
    expect(level(path.join(root, 'stills', 'pair.image.ppm'))).toBe(10);
    expect(level(path.join(root, 'stills', 'pair.mask.ppm'))).toBe(200);
    expect(level(path.join(root, 'stills', 'final.ppm'))).toBe(77);
    expect(result.images.map((image: any) => `${image.node}.${image.port}`).sort()).toEqual(['final.output', 'pair.image', 'pair.mask']);
  }, 60_000);

  it('lists the image outputs without --out', async () => {
    const { file } = project();
    const result = await runJson({ file });
    expect(result.files).toBeUndefined();
    for (const image of result.images) expect(fs.existsSync(image.source)).toBe(true);
    expect(result.images).toHaveLength(3);
  }, 60_000);

  it('saves a mid-graph node with --out-node, into an absolute --out', async () => {
    const { file } = project();
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-run-out-abs-'));
    roots.push(elsewhere);
    const result = await runJson({ file, out: elsewhere, nodes: ['pair'], outNodes: ['ramp'] });
    expect([...result.files].sort()).toEqual([
      path.join(elsewhere, 'pair.image.ppm'), path.join(elsewhere, 'pair.mask.ppm'), path.join(elsewhere, 'ramp.ppm'),
    ]);
    expect(level(path.join(elsewhere, 'ramp.ppm'))).toBe(77);
  }, 60_000);

  it('names a frame sequence per port, and takes --out-node there too', async () => {
    const { root, file } = project();
    const result = await runJson({ file, frames: '1-2', out: 'seq', outNodes: ['ramp'] });
    expect([...result.files].sort()).toEqual([
      'seq/final.0001.ppm', 'seq/final.0002.ppm',
      'seq/pair.image.0001.ppm', 'seq/pair.image.0002.ppm',
      'seq/pair.mask.0001.ppm', 'seq/pair.mask.0002.ppm',
      'seq/ramp.0001.ppm', 'seq/ramp.0002.ppm',
    ]);
    expect(level(path.join(root, 'seq', 'pair.mask.0002.ppm'))).toBe(200);
  }, 60_000);

  it('is reached from the MCP cook tool, with out kept inside the project', async () => {
    const { handle, createMcpContext } = await import('@/cli/mcp');
    const calls: (readonly string[])[] = [];
    const context = { ...createMcpContext('/project'), cli: async (args: readonly string[]) => { calls.push(args); return { ok: true, data: {}, warnings: [] }; } };
    await handle({ method: 'tools/call', params: { name: 'cook', arguments: { graph: 'g.cascade', out: 'stills', outNodes: ['a', 'b'] } } }, context, 'test');
    expect(calls[0]).toEqual(['run', '/project/g.cascade', '--out', '/project/stills', '--out-node', 'a', '--out-node', 'b']);
    const escaped = await handle({ method: 'tools/call', params: { name: 'cook', arguments: { graph: 'g.cascade', out: '/elsewhere' } } }, context, 'test') as any;
    expect(escaped.result.isError).toBe(true);
  });

  it('refuses an --out-node the graph does not have', async () => {
    const { file } = project();
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code: number) => { throw new Error(`exit ${code}`); }) as never);
    await expect(runGraph({ file, out: 'stills', outNodes: ['nope'] })).rejects.toThrow(/No node "nope"/);
    exit.mockRestore();
  }, 60_000);
});
