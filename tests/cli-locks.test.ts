/**
 * Locks and replay: "this exact render, from this code and this seed".
 *
 * The case behind it is cloud-plots' October delivery, where proving each
 * approved piece was the one approved took sixteen git worktrees. The tests
 * here pin the promises a lock makes: it replays from its own stored code
 * after the project's code has moved on, it says precisely what moved, it
 * refuses loudly when an input changed, and it is never rewritten.
 */
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createLock, graphParams, graphSeeds, publishedParams, listLocks, lockId, readLock, replayLock } from '@/cli/locks/lock';
import { collectSources, diffTrees, hashSources, materialize, storeSources } from '@/cli/locks/snapshot';
import { getObject, stableJson } from '@/cli/locks/store';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/** A node whose output depends on its seed, a prop, and a constant in a sibling module. */
const stampSource = `
import { SALT } from './salt';
export const definition = {
  apiVersion: 1,
  runsOn: 'portable',
  capabilities: ['assets'],
  inputs: {},
  outputs: {
    label: { kind: 'data', type: 'string' },
    image: { kind: 'data', type: 'image' },
  },
  props: {
    seed: { type: 'int', default: 1 },
    photo: { type: 'string', default: '' },
  }
} as const;
export async function execute(context) {
  const level = (SALT * 31 + context.props.seed * 7) % 256;
  const header = 'P6\\n2 2\\n255\\n';
  const bytes = new Uint8Array(header.length + 12);
  for (let i = 0; i < header.length; i++) bytes[i] = header.charCodeAt(i);
  bytes.fill(level, header.length);
  context.outputs.image.set(await context.capabilities.assets.write(bytes, { suggestedName: 'stamp.ppm' }, { signal: context.signal }));
  context.outputs.label.set('stamp ' + level);
}
`;

function project() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-locks-')));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'nodes', 'Stamp'), { recursive: true });
  fs.writeFileSync(path.join(root, 'nodes', 'Stamp', 'index.ts'), stampSource);
  fs.writeFileSync(path.join(root, 'nodes', 'Stamp', 'salt.ts'), 'export const SALT = 3;\n');
  fs.mkdirSync(path.join(root, 'assets'));
  fs.writeFileSync(path.join(root, 'assets', 'photo.txt'), 'the sky on Sunday');
  const document = {
    version: '0.2',
    nodes: [{ id: 'stamp', module: 'project.Stamp', props: { seed: 5, photo: 'assets/photo.txt' } }],
    connections: [],
  };
  const file = path.join(root, 'piece.cascade');
  fs.writeFileSync(file, JSON.stringify(document, null, 2));
  return { root, file };
}

describe('cascade lock', () => {
  it('records the graph, seeds, inputs, code and output fingerprint in a readable file', async () => {
    const { root, file } = project();
    const { lock, file: written } = await createLock({ graph: file, node: 'stamp', name: 'Canary v1', note: 'approved Sunday' });

    expect(path.relative(root, written)).toBe(path.join('locks', 'canary-v1.json'));
    const text = fs.readFileSync(written, 'utf8');
    // Opens on what it is, then alphabetical: diffs between locks stay small.
    expect(Object.keys(JSON.parse(text)).slice(0, 4)).toEqual(['format', 'version', 'id', 'name']);
    expect(lock.seeds).toEqual({ 'stamp.seed': 5 });
    expect(lock.params).toEqual({ 'stamp.photo': 'assets/photo.txt', 'stamp.seed': 5 });
    expect(Object.keys(lock.inputs)).toEqual(['assets/photo.txt']);
    expect(lock.graph).toMatchObject({ file: 'piece.cascade', node: 'stamp' });
    expect(lock.code.modules['project.Stamp']).toMatch(/^sha256:/);
    expect(lock.code.files).toBe(2);
    expect(lock.output.ports.label).toMatchObject({ kind: 'value', value: 'stamp 128' });
    expect(lock.output.ports.image).toMatchObject({ kind: 'file' });
    expect(lock.host.cooked).toBe('snapshot');

    // The graph is in the store, byte for byte.
    expect((await getObject(root, lock.graph.object)).toString()).toBe(fs.readFileSync(file, 'utf8'));
  }, 60_000);

  it('is never rewritten: a second lock with the same name is refused', async () => {
    const { file } = project();
    await createLock({ graph: file, node: 'stamp', name: 'C48 v1', live: true });
    await expect(createLock({ graph: file, node: 'stamp', name: 'C48 v1', live: true })).rejects.toThrow(/never rewritten/);
    const second = await createLock({ graph: file, node: 'stamp', name: 'C48 v2', supersedes: 'c48-v1', live: true });
    expect(second.lock.supersedes).toBe('c48-v1');
  }, 60_000);

  it('keeps a preview beside the lock when one is given', async () => {
    const { root, file } = project();
    const approved = path.join(root, 'approved.png');
    await sharp({ create: { width: 40, height: 20, channels: 3, background: '#808080' } }).png().toFile(approved);
    const { lock } = await createLock({ graph: file, node: 'stamp', name: 'with preview', preview: approved, live: true });
    expect(lock.preview?.file).toBe('locks/with-preview.preview.png');
    expect(fs.existsSync(path.join(root, lock.preview!.file))).toBe(true);
  }, 60_000);
});

describe('cascade replay', () => {
  it('reproduces the lock from its stored code after the project code changed', async () => {
    const { root, file } = project();
    const { lock } = await createLock({ graph: file, node: 'stamp', name: 'piece' });

    // The project moves on: a constant changes and the graph file is edited.
    fs.writeFileSync(path.join(root, 'nodes', 'Stamp', 'salt.ts'), 'export const SALT = 4;\n');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"seed": 5', '"seed": 6'));

    const replayed = await replayLock(root, lock);
    expect(replayed.status).toBe('match');
    expect(replayed.cooked).toBe('snapshot');
    expect(replayed.codeSinceLock.changed).toEqual(['nodes/Stamp/salt.ts']);

    // With the project's current code the same graph renders differently, and says where.
    const live = await replayLock(root, lock, { live: true });
    expect(live.status).toBe('mismatch');
    expect(live.differences.map((difference) => difference.port).sort()).toEqual(['image', 'label']);
    expect(live.differences.find((difference) => difference.port === 'label')?.actual).toContain('stamp 159');
  }, 60_000);

  it('writes the replayed outputs to --out', async () => {
    const { root, file } = project();
    const { lock } = await createLock({ graph: file, node: 'stamp', name: 'piece', live: true });
    const out = path.join(root, 'delivery');
    const replayed = await replayLock(root, lock, { out });
    expect(replayed.status).toBe('match');
    expect(replayed.files.map((written) => path.basename(written))).toEqual(['piece.image.ppm']);
  }, 60_000);

  it('refuses loudly, naming the file, when an input changed since the lock', async () => {
    const { root, file } = project();
    const { lock } = await createLock({ graph: file, node: 'stamp', name: 'piece', live: true });
    fs.writeFileSync(path.join(root, 'assets', 'photo.txt'), 'a different sky');
    await expect(replayLock(root, lock)).rejects.toThrow(/assets\/photo\.txt: locked [0-9a-f]{12}, now [0-9a-f]{12}/);
    const anyway = await replayLock(root, lock, { allowInputChange: true });
    expect(anyway.inputsChanged.map((change) => change.path)).toEqual(['assets/photo.txt']);
  }, 60_000);

  it('finds locks by id and lists them oldest first', async () => {
    const { root, file } = project();
    await createLock({ graph: file, node: 'stamp', name: 'b', live: true });
    await createLock({ graph: file, node: 'stamp', name: 'a', live: true });
    expect((await listLocks(root)).map((lock) => lock.id)).toEqual(['b', 'a']);
    expect((await readLock(root, 'a')).lock.id).toBe('a');
    expect((await readLock(os.tmpdir(), path.join(root, 'locks', 'b.json'))).root).toBe(root);
    await expect(readLock(root, 'missing')).rejects.toThrow(/No lock "missing"/);
  }, 60_000);
});

describe('the snapshot', () => {
  it('rebuilds a copy whose code is exactly the stored tree, without touching the project', async () => {
    const { root } = project();
    const { tree } = await storeSources(root, await collectSources(root));
    fs.writeFileSync(path.join(root, 'nodes', 'Stamp', 'salt.ts'), 'export const SALT = 9;\n');
    fs.writeFileSync(path.join(root, 'nodes', 'Stamp', 'extra.ts'), 'export const LATER = 1;\n');

    const copy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-locks-copy-')), 'project');
    roots.push(path.dirname(copy));
    await materialize(root, tree, copy);

    expect(fs.readFileSync(path.join(copy, 'nodes', 'Stamp', 'salt.ts'), 'utf8')).toContain('SALT = 3');
    expect(fs.existsSync(path.join(copy, 'nodes', 'Stamp', 'extra.ts'))).toBe(false);
    expect(fs.readFileSync(path.join(copy, 'assets', 'photo.txt'), 'utf8')).toBe('the sky on Sunday');
    // The live project is as it was.
    expect(fs.readFileSync(path.join(root, 'nodes', 'Stamp', 'salt.ts'), 'utf8')).toContain('SALT = 9');
    expect(fs.existsSync(path.join(root, 'nodes', 'Stamp', 'extra.ts'))).toBe(true);

    const diff = diffTrees(tree, await hashSources(await collectSources(root)));
    expect(diff).toEqual({ changed: ['nodes/Stamp/salt.ts'], added: ['nodes/Stamp/extra.ts'], removed: [] });
  }, 30_000);
});

describe('what a lock records', () => {
  it('writes the same bytes for the same content', () => {
    expect(stableJson({ b: 1, a: { d: 2, c: 3 } })).toBe(stableJson({ a: { c: 3, d: 2 }, b: 1 }));
    expect(stableJson({ b: 1, format: 'x', a: 2 }, ['format'])).toBe('{\n  "format": "x",\n  "a": 2,\n  "b": 1\n}\n');
  });

  it('turns a name into a file-safe id', () => {
    expect(lockId('C48 v1')).toBe('c48-v1');
    expect(lockId('11D')).toBe('11d');
    expect(() => lockId('  ')).toThrow();
  });

  it('records every prop, the published parameters by id, and seeds wherever they are', () => {
    const document = {
      nodes: [
        { id: 'ink', props: { expressivity: 0.5, mass_seed: 7 } },
        { id: 'dots', props: { density: 2, seed: 0 } },
      ],
      editor: { id: 'e', parameters: [{ id: 'expressivity', node: 'ink', prop: 'expressivity' }, { id: 'seed', node: 'dots', prop: 'seed', control: 'seed' }] },
    };
    expect(graphParams(document)).toEqual({ 'ink.expressivity': 0.5, 'ink.mass_seed': 7, 'dots.density': 2, 'dots.seed': 0 });
    expect(publishedParams(document)).toEqual({ expressivity: 0.5, seed: 0 });
    expect(publishedParams({ nodes: [] })).toBeUndefined();
    expect(graphSeeds(document)).toEqual({ 'ink.mass_seed': 7, 'dots.seed': 0 });
  });
});
