import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { runDeterministicProjectGraph } from '@/cli/projectRuntime';

vi.mock('esbuild', async (importOriginal) => {
  const actual = await importOriginal<typeof import('esbuild')>();
  return { ...actual, build: vi.fn(actual.build) };
});

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  vi.clearAllMocks();
});

it('shares one compilation across instances, while a new run loads source edits', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-shared-module-'));
  roots.push(root);
  const directory = path.join(root, 'nodes', 'Note');
  fs.mkdirSync(directory, { recursive: true });
  const source = `
export const definition = {
  apiVersion: 1,
  runsOn: 'portable',
  outputs: { result: { kind: 'data', type: 'float' } }
} as const;
export function execute(context) { context.outputs.result.set(1); }
`;
  const moduleFile = path.join(directory, 'index.ts');
  fs.writeFileSync(moduleFile, source);
  const file = path.join(root, 'index.cascade');
  const document = {
    version: '0.2',
    nodes: Array.from({ length: 8 }, (_, i) => ({ id: `note-${i}`, module: 'project.Note' })),
    connections: [],
  };
  fs.writeFileSync(file, JSON.stringify(document));

  await expect(runDeterministicProjectGraph(file, document)).resolves.toBe(true);
  // Parallel builds truncate and rewrite the same .mjs while other instances import it.
  expect(build).toHaveBeenCalledTimes(1);

  fs.writeFileSync(moduleFile, source.replace('context.outputs.result.set(1);', 'throw new Error("edited source loaded");'));
  await expect(runDeterministicProjectGraph(file, document)).rejects.toThrow('edited source loaded');
  expect(build).toHaveBeenCalledTimes(2);
});
