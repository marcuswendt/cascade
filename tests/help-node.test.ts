/**
 * `cascade help node`: a node's declaration from the package itself, so an
 * agent outside the repository can read what a node takes and makes.
 */
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { findNode, formatNode } from '@/cli/helpCommand';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const cli = (args: string[]) => {
  try {
    return { status: 0, stdout: execFileSync(process.execPath, ['--import', 'tsx', path.resolve('src/cli/index.ts'), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (error) {
    const failed = error as { status: number; stdout: string };
    return { status: failed.status, stdout: failed.stdout };
  }
};

describe('cascade help node', () => {
  it('prints a built-in by short name with its ports', async () => {
    const found = await findNode('Circle', os.tmpdir());
    expect(found?.module).toBe('cascade.geo.Circle');
    const text = formatNode(found!);
    expect(text).toMatch(/^cascade\.geo\.Circle/);
    expect(text).toMatch(/Outputs:\n {2}geometry {2}geometry/);
    expect(text).toContain('cascade node add <graph> cascade.geo.Circle');
  });

  it('reads a project node statically', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-help-'));
    roots.push(root);
    fs.mkdirSync(path.join(root, 'nodes', 'Ink'), { recursive: true });
    fs.writeFileSync(path.join(root, 'nodes', 'Ink', 'index.ts'), `
export const definition = {
  apiVersion: 1, runsOn: 'portable', label: 'Ink', description: 'Lays ink',
  inputs: { amount: { kind: 'data', type: 'float', default: 0.5, min: 0, max: 1, description: 'how much' } },
  outputs: { image: { kind: 'data', type: 'image' } }
} as const;
export function execute() {}
`);
    const found = await findNode('Ink', root);
    expect(found).toMatchObject({ module: 'project.Ink', source: 'project' });
    expect(formatNode(found!)).toContain('amount  float, default 0.5, range 0…1  — how much');
  });

  it('answers --json in the envelope, lists everything, and suggests on a typo', () => {
    const range = JSON.parse(cli(['help', 'node', 'cascade.assert.Range', '--json']).stdout);
    expect(range).toMatchObject({ ok: true, data: { module: 'cascade.assert.Range', definition: { props: { min: { type: 'float' } } } } });
    const all = JSON.parse(cli(['help', 'node', '--json']).stdout);
    expect(all.data.nodes.map((node: { module: string }) => node.module)).toContain('cascade.core.Null');
    const typo = cli(['help', 'node', 'Circel', '--json']);
    expect(typo.status).toBe(1);
    expect(JSON.parse(typo.stdout).error.message).toMatch(/No node type "Circel"/);
    const studio = JSON.parse(cli(['help', 'node', 'cascade.image.Blur', '--json']).stdout);
    expect(studio.data.message).toMatch(/class-based Studio node/);
  }, 60_000);

  it('ships what it reads in the package', () => {
    const files = JSON.parse(fs.readFileSync('package.json', 'utf8')).files as string[];
    expect(files).toContain('doc/NODE_REFERENCE.md');
    expect(files).toContain('dist');
  });
});
