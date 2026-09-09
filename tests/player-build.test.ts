import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildPlayer } from '../src/cli/webBuild';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function fixture(source?: string, props: Record<string, unknown> = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cascade-player-build-'));
  roots.push(root);
  if (source) {
    await fs.mkdir(path.join(root, 'nodes', 'Example'), { recursive: true });
    await fs.writeFile(path.join(root, 'nodes', 'Example', 'index.ts'), source);
  }
  const file = path.join(root, 'index.cascade');
  await fs.writeFile(file, JSON.stringify({ version: '0.2', nodes: [
    { id: 'example', module: source ? 'project.Example' : 'cascade.geo.Rectangle', props },
  ], connections: [] }));
  return { root, file, out: path.join(root, 'web') };
}
const definition = `export const definition = {
  apiVersion: 1, runsOn: 'portable',
  outputs: { value: { kind: 'data', type: 'float' } }
} as const;
export function execute(context) { context.outputs.value.set(3); }`;

describe('static player build', () => {
  it('bundles a builtin graph without Studio or API transports', async () => {
    const item = await fixture();
    const result = await buildPlayer(item.file, { out: item.out });
    expect(result.directory).toBe(item.out);
    for (const name of ['index.html', 'player.html', 'app.js', 'embed.js']) {
      expect((await fs.stat(path.join(item.out, name))).size).toBeGreaterThan(0);
    }
    const app = await fs.readFile(path.join(item.out, 'app.js'), 'utf8');
    expect(app).not.toMatch(/dockview|monaco-editor|\/api\/shell/);
    expect(await fs.readFile(path.join(item.out, 'embed.js'), 'utf8')).toContain('player.html');
  });

  it('compiles custom definitions without executing their code at build time', async () => {
    const item = await fixture(definition.replace('context.outputs.value.set(3)', "throw new Error('must not execute')"));
    await expect(buildPlayer(item.file, { out: item.out })).resolves.toBeDefined();
  });

  it('allows a project-local computation helper', async () => {
    const item = await fixture(`import { value } from '../../helper.ts';\n${definition.replace('context.outputs.value.set(3)', 'context.outputs.value.set(value)')}`);
    await fs.writeFile(path.join(item.root, 'helper.ts'), 'export const value = 3;');

    await expect(buildPlayer(item.file, { out: item.out })).resolves.toEqual({ directory: item.out });
  });

  it.each([
    ['server node', definition.replace("runsOn: 'portable'", "runsOn: 'server'")],
    ['shell import', "import { run } from 'cascade/shell';\n" + definition.replace('context.outputs.value.set(3)', "await run('x', [])").replace('function execute', 'async function execute')],
    ['stage import', "import { runStage } from 'cascade/stage';\n" + definition.replace('context.outputs.value.set(3)', "await runStage('x')").replace('function execute', 'async function execute')],
    ['Node import', "import { readFileSync } from 'node:fs';\n" + definition.replace('context.outputs.value.set(3)', "context.outputs.value.set(readFileSync('x').length)")],
    ['dynamic node', 'export function execute(node) { node.out("x").setValue(3); }'],
  ])('rejects %s without leaving a final bundle', async (_, source) => {
    const item = await fixture(source);
    await expect(buildPlayer(item.file, { out: item.out })).rejects.toThrow();
    await expect(fs.stat(item.out)).rejects.toThrow();
    expect((await fs.readdir(item.root)).filter(name => name.startsWith('.cascade-player-'))).toEqual([]);
  });

  it('includes only explicitly requested assets, not neighbouring secrets', async () => {
    const item = await fixture();
    await fs.mkdir(path.join(item.root, 'assets'));
    await fs.writeFile(path.join(item.root, 'assets', 'picture.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await fs.writeFile(path.join(item.root, 'private-key'), 'do-not-export');
    await buildPlayer(item.file, { out: item.out, assets: ['assets/picture.svg'] });
    expect(await fs.readFile(path.join(item.out, 'assets', 'assets', 'picture.svg'), 'utf8')).toContain('<svg');
    await expect(fs.stat(path.join(item.out, 'private-key'))).rejects.toThrow();
  });

  it('refuses an existing output directory without altering it', async () => {
    const item = await fixture();
    await fs.mkdir(item.out);
    await fs.writeFile(path.join(item.out, 'keep'), 'keep');
    await expect(buildPlayer(item.file, { out: item.out })).rejects.toThrow(/exist/i);
    expect(await fs.readFile(path.join(item.out, 'keep'), 'utf8')).toBe('keep');
  });

  it('includes a literal typed asset default without an explicit asset flag', async () => {
    const source = definition.replace('outputs:', "inputs: { source: { kind: 'data', type: 'asset', default: { path: 'assets/picture.svg', mediaType: 'image/svg+xml' } } }, outputs:");
    const item = await fixture(source);
    await fs.mkdir(path.join(item.root, 'assets'));
    await fs.writeFile(path.join(item.root, 'assets', 'picture.svg'), '<svg/>');
    await buildPlayer(item.file, { out: item.out });
    expect(await fs.readFile(path.join(item.out, 'assets', 'assets', 'picture.svg'), 'utf8')).toBe('<svg/>');
  });

  it.each(['../outside.png', '.env', 'assets'])('rejects unsafe or non-file asset %s', async (asset) => {
    const item = await fixture();
    await fs.mkdir(path.join(item.root, 'assets'));
    await fs.writeFile(path.join(item.root, '.env'), 'secret');
    await expect(buildPlayer(item.file, { out: item.out, assets: [asset] })).rejects.toThrow();
    await expect(fs.stat(item.out)).rejects.toThrow();
  });

  it('rejects a source asset symlink escaping the project', async () => {
    const item = await fixture();
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'cascade-player-outside-'));
    roots.push(outside);
    await fs.writeFile(path.join(outside, 'image.svg'), '<svg/>');
    await fs.symlink(path.join(outside, 'image.svg'), path.join(item.root, 'image.svg'));
    await expect(buildPlayer(item.file, { out: item.out, assets: ['image.svg'] })).rejects.toThrow();
  });

  it.each([
    ['helper', 'outside.ts', 'export default 7;'],
    ['JSON', 'outside.json', '{"secret":"must-not-ship"}'],
  ])('rejects a project import of an %s outside the project', async (_, name, contents) => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'cascade-player-import-outside-'));
    roots.push(outside);
    const imported = path.join(outside, name);
    await fs.writeFile(imported, contents);
    const source = `import value from ${JSON.stringify(imported)};\n${definition.replace('context.outputs.value.set(3)', 'context.outputs.value.set(Number(value))')}`;
    const item = await fixture(source);

    await expect(buildPlayer(item.file, { out: item.out })).rejects.toThrow(/escapes the project/i);
    await expect(fs.stat(item.out)).rejects.toThrow();
  });

  it('rejects a project helper symlink that resolves outside the project', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'cascade-player-helper-outside-'));
    roots.push(outside);
    await fs.writeFile(path.join(outside, 'helper.ts'), 'export default 7;');
    const item = await fixture(`import value from '../../helper.ts';\n${definition.replace('context.outputs.value.set(3)', 'context.outputs.value.set(value)')}`);
    await fs.symlink(path.join(outside, 'helper.ts'), path.join(item.root, 'helper.ts'));

    await expect(buildPlayer(item.file, { out: item.out })).rejects.toThrow(/escapes the project/i);
    await expect(fs.stat(item.out)).rejects.toThrow();
  });

  it('confines imports made by a local helper as well as the entry node', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'cascade-player-transitive-'));
    roots.push(outside);
    await fs.writeFile(path.join(outside, 'private.json'), '{"value":7}');
    const item = await fixture(`import value from '../../helper.ts';\n${definition.replace('context.outputs.value.set(3)', 'context.outputs.value.set(value)')}`);
    await fs.writeFile(path.join(item.root, 'helper.ts'), `import data from ${JSON.stringify(path.join(outside, 'private.json'))}; export default data.value;`);
    await expect(buildPlayer(item.file, { out: item.out })).rejects.toThrow(/escapes the project/i);
    await expect(fs.stat(item.out)).rejects.toThrow();
  });

  it('rejects an output whose symlinked parent resolves inside source assets', async () => {
    const item = await fixture();
    await fs.mkdir(path.join(item.root, 'assets'));
    await fs.symlink(path.join(item.root, 'assets'), path.join(item.root, 'published'));
    const escapedOut = path.join(item.root, 'published', 'player');

    await expect(buildPlayer(item.file, { out: escapedOut })).rejects.toThrow(/assets directory/i);
    await expect(fs.stat(path.join(item.root, 'assets', 'player'))).rejects.toThrow();
  });
});
