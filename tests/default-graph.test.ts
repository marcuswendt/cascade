/**
 * The graph Studio opens with when there is no project graph, and the one
 * "New graph" loads. It shipped for several releases naming
 * `cascade.lens.Color` — a library that does not exist in any registry — so a
 * fresh Studio threw on startup while every other gate stayed green. Nothing
 * covered this file, because it is data rather than code.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import '@/nodes/core/index';
import '@/nodes/image/index';
import '@/nodes/geo/index';
import { getNodeClass } from '@/utils/nodeTypeUtils';

const graphFile = path.resolve(__dirname, '../public/graphs/default.cascade');

describe('the shipped default graph', () => {
  const document = JSON.parse(fs.readFileSync(graphFile, 'utf-8'));

  it('has at least one node, so Studio opens with something on screen', () => {
    expect(Array.isArray(document.nodes)).toBe(true);
    expect(document.nodes.length).toBeGreaterThan(0);
  });

  it('names only node types a registry can resolve', () => {
    const unresolved = document.nodes
      .map((node: { module?: string; type?: string }) => node.module ?? node.type)
      .filter((module: string) => !getNodeClass(module));
    expect(unresolved).toEqual([]);
  });
});
