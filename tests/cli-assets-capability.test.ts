/**
 * `cascade.geo.SvgExport`, headlessly.
 *
 * It declares `capabilities: ["assets"]`, and `assets` was the browser's alone
 * — the CLI host supplied `shell` and nothing else. So an export graph passed
 * `cascade validate` and `cascade check` (neither of which executes anything)
 * and then failed at run time with a capability error: the one node whose whole
 * purpose is to write a file was the node that could not write one offline.
 *
 * The Node capability writes through `cascade/io`'s bridge, so an asset obeys
 * the same two rules as every other headless write — confined to
 * `.cascade-cache/`, content-addressed inside it — rather than gaining a second
 * file policy of its own.
 */
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runDeterministicProjectGraph } from '@/cli/projectRuntime';
import { assetFileName, createNodeAssetCapability } from '@/cli/nodeAssets';
import { ProjectRoot } from '../server/src/project';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function scratchProject(): { root: string; file: string; document: any } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-cli-assets-'));
  roots.push(root);
  const document = {
    version: '0.2',
    nodes: [
      { id: 'circle', module: 'cascade.geo.Circle', inputs: { radius: [10, 10] } },
      { id: 'export', module: 'cascade.geo.SvgExport', props: { filename: 'ring.svg' } },
    ],
    connections: [[['circle', 0, 'geometry'], ['export', 0, 'geometry']]],
  };
  const file = path.join(root, 'index.cascade');
  fs.writeFileSync(file, JSON.stringify(document));
  return { root, file, document };
}

function written(root: string): string[] {
  const cache = path.join(root, '.cascade-cache');
  return fs.existsSync(cache) ? fs.readdirSync(cache) : [];
}

describe('the headless assets capability', () => {
  it('lets an SvgExport graph run and leaves the SVG on disk', async () => {
    const fixture = scratchProject();
    await expect(runDeterministicProjectGraph(fixture.file, fixture.document)).resolves.toBe(true);

    const files = written(fixture.root);
    expect(files).toHaveLength(1);
    // Content-addressed, like every other headless write: ring.<hash>.svg
    expect(files[0]).toMatch(/^ring\.[0-9a-f]{12}\.svg$/);
    const svg = fs.readFileSync(path.join(fixture.root, '.cascade-cache', files[0]), 'utf8');
    expect(svg).toContain('<svg');
    expect(svg).toMatch(/<path|<circle|<polyline|<g/);
  });

  it('keeps the .cascade-cache guard rather than writing beside the source', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-cli-assets-'));
    roots.push(root);
    const assets = createNodeAssetCapability(new ProjectRoot(root));
    const ref = await assets.write(
      new TextEncoder().encode('<svg/>'),
      { mediaType: 'image/svg+xml', suggestedName: '../../escape.svg' },
      { signal: new AbortController().signal as never },
    );
    expect(ref.path.startsWith('.cascade-cache/')).toBe(true);
    expect(ref.path).not.toContain('..');
    expect(fs.readdirSync(root)).toEqual(['.cascade-cache']);
    // And it reads back through the same capability, which is the contract a
    // node depends on — not the shape of the path.
    expect(new TextDecoder().decode(await assets.read(ref, { signal: new AbortController().signal as never })))
      .toBe('<svg/>');
  });

  it('reduces a suggested name to one safe filename', () => {
    expect(assetFileName('ring.svg')).toBe('ring.svg');
    expect(assetFileName('nested/dir/ring.svg')).toBe('ring.svg');
    expect(assetFileName('../../etc/passwd')).toBe('passwd');
    expect(assetFileName('  ')).toBe('asset.bin');
    expect(assetFileName(undefined)).toBe('asset.bin');
  });
});
