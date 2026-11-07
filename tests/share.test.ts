/**
 * `cascade share`: export or copy, deploy through a stubbed Deployer (no
 * network here), record the link in the project's shares.json.
 */
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Deployer, DeployOptions } from '@/cli/editorExport';
import { productionAlias } from '@/cli/editorExport';
import { readShares, share, shareSlug } from '@/cli/share';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-share-test-'));
  roots.push(root);
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
}

const shape = `
export const definition = {
  apiVersion: 1, runsOn: 'portable',
  outputs: { svg: { kind: 'data', type: 'string' } },
  props: { radius: { type: 'float', default: 2 } },
} as const;
export function execute(context) { context.outputs.svg.set('<svg/>'); }
`;

const graph = JSON.stringify({
  version: '0.2',
  nodes: [{ id: 'shape', module: 'project.Shape' }],
  connections: [],
  editor: { id: 'plotter_social', parameters: [{ id: 'radius', node: 'shape', prop: 'radius' }], outputs: [{ id: 'svg', node: 'shape', port: 'svg', format: 'svg', view: true }] },
});

/** Records each deploy and what the site held at that moment. */
function stub() {
  const calls: { options: DeployOptions; files: string[] }[] = [];
  const deploy: Deployer = async (directory, options) => {
    calls.push({ options, files: fs.readdirSync(directory, { recursive: true }).map(String).sort() });
    return { deployment: `https://${options.project}-abc123-field-io.vercel.app`, url: `https://${options.project}.vercel.app` };
  };
  return { calls, deploy };
}

describe('cascade share', () => {
  it('exports a graph, deploys it as cascade-<editor id>, and records the link', async () => {
    const root = project({ 'nodes/Shape/index.ts': shape, 'g.cascade': graph });
    const { calls, deploy } = stub();
    const result = await share(path.join(root, 'g.cascade'), { deploy, log: () => {}, now: () => new Date('2026-11-07T10:00:00Z') });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.options).toMatchObject({ project: 'cascade-plotter-social', public: true });
    expect(calls[0]!.files).toEqual(expect.arrayContaining(['index.html', 'editor.js', 'export-manifest.json', 'vercel.json']));
    expect(result).toMatchObject({ url: 'https://cascade-plotter-social.vercel.app', source: 'g.cascade', name: 'plotter-social' });
    expect((await readShares(root)).shares).toEqual([{
      source: 'g.cascade', name: 'plotter-social', project: 'cascade-plotter-social',
      url: 'https://cascade-plotter-social.vercel.app', deployment: 'https://cascade-plotter-social-abc123-field-io.vercel.app',
      sharedAt: '2026-11-07T10:00:00.000Z',
    }]);
    // Sharing again replaces the entry rather than adding one.
    await share(path.join(root, 'g.cascade'), { deploy, log: () => {}, name: 'social', protected: true });
    expect(calls[1]!.options).toMatchObject({ project: 'cascade-social', public: false });
    expect((await readShares(root)).shares.map((item) => item.name)).toEqual(['social']);
  }, 60_000);

  it('shares a static directory without its dotfiles, records it in the enclosing project', async () => {
    const root = project({
      'cascade.json': '{}',
      'renders/shelf/index.html': '<!doctype html><title>Shelf</title>',
      'renders/shelf/thumbs/a.png': 'png',
      'renders/shelf/.vercel/project.json': '{}',
    });
    const { calls, deploy } = stub();
    const result = await share(path.join(root, 'renders', 'shelf'), { deploy, log: () => {}, name: 'commons-shelf' });
    expect(calls[0]!.options.project).toBe('cascade-commons-shelf');
    expect(calls[0]!.files).toEqual(['index.html', 'thumbs', path.join('thumbs', 'a.png'), 'vercel.json']);
    expect(result.source).toBe('renders/shelf');
    expect(result.shares).toBe(path.join(root, 'shares.json'));
  });

  it('refuses a directory that would publish a local path', async () => {
    const root = project({ 'cascade.json': '{}', 'site/index.html': '<img src="/Users/someone/x.png">' });
    const { calls, deploy } = stub();
    await expect(share(path.join(root, 'site'), { deploy, log: () => {} })).rejects.toThrow(/local path/);
    expect(calls).toHaveLength(0);
  });

  it('makes Vercel project names and reads the production alias', () => {
    expect(shareSlug('Plotter Social')).toBe('plotter-social');
    expect(shareSlug('cascade-commons-shelf')).toBe('commons-shelf');
    expect(() => shareSlug('***')).toThrow(/--name/);
    expect(productionAlias('Production: https://x-abc.vercel.app [3s]\nAliased: https://cascade-x.vercel.app [3s]')).toBe('https://cascade-x.vercel.app');
    expect(productionAlias('nothing')).toBeUndefined();
  });
});
