import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { checkProjectGraph, validateProjectGraph } from '@/cli/projectRuntime';
import { LONG_EXECUTE_LINES, measureNodeShape, nodeShapeWarnings } from '@/cli/nodeShape';

// Marcus, 2026-11-06: agents write several single-job nodes; `cascade check`
// warns, warn-only, when a node grows long or mixes jobs. Never fatal.

const definition = `
export const definition = {
  apiVersion: 1,
  runsOn: 'portable',
  inputs: {},
  outputs: { result: { kind: 'data', type: 'float' } }
} as const;
`;

function longExecute(lines: number): string {
  const body = Array.from({ length: lines - 2 }, (_, index) => `  const v${index} = ${index};`).join('\n');
  return `${definition}export function execute(context) {\n${body}\n}\n`;
}

const pipeline = `${definition}
export async function execute(context) {
  const img = await loadImage('in.png');
  const n = fbm(1, 2);
  const c = oklch(0.7, 0.1, 200);
  const g = canvas.getContext('2d');
  g.beginPath(); g.arc(0, 0, n, 0, 6.28);
  savePng(canvas, 'out.png');
  context.outputs.result.set(1);
}
`;

const painter = `${definition}
export function execute(context) {
  const n = vnoise1(3);
  const c = oklch(0.7, 0.1, 200);
  g.beginPath(); g.lineTo(n, n); g.stroke();
  context.outputs.result.set(1);
}
`;

describe('node shape warnings', () => {
  it('counts the lines of execute, braces included', () => {
    expect(measureNodeShape(longExecute(20), 'a.ts', ts).executeLines).toBe(20);
  });

  it('warns past the line budget, not at it', () => {
    expect(nodeShapeWarnings(longExecute(LONG_EXECUTE_LINES), 'a.ts', ts)).toEqual([]);
    const over = nodeShapeWarnings(longExecute(LONG_EXECUTE_LINES + 1), 'a.ts', ts, 'project.Big');
    expect(over.map((item) => item.code)).toEqual(['shape/long-execute']);
    expect(over[0]!.message).toContain('project.Big');
  });

  it('names the jobs a pipeline node mixes', () => {
    const shape = measureNodeShape(pipeline, 'a.ts', ts);
    expect(shape.jobs).toEqual(['load', 'generate', 'colour', 'draw', 'export']);
    expect(nodeShapeWarnings(pipeline, 'a.ts', ts).map((item) => item.code)).toEqual(['shape/mixed-jobs']);
  });

  it('leaves a drawing node alone that uses noise and colour', () => {
    expect(measureNodeShape(painter, 'a.ts', ts).jobs).toEqual(['generate', 'colour', 'draw']);
    expect(nodeShapeWarnings(painter, 'a.ts', ts)).toEqual([]);
  });

  it('reads the files and assets capabilities as load and export', () => {
    const source = `${definition}
export async function execute(context) {
  const { files } = context.capabilities;
  const text = await files.read('a.txt');
  const r = Math.random();
  await context.capabilities.assets.write(text);
}
`;
    expect(measureNodeShape(source, 'a.ts', ts).jobs).toEqual(['load', 'generate', 'export']);
    expect(nodeShapeWarnings(source, 'a.ts', ts).map((item) => item.code)).toEqual(['shape/mixed-jobs']);
  });
});

describe('cascade check prints shape warnings and still passes', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  function project(source: string) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-node-shape-'));
    roots.push(root);
    fs.mkdirSync(path.join(root, 'nodes', 'Big'), { recursive: true });
    fs.writeFileSync(path.join(root, 'nodes', 'Big', 'index.ts'), source);
    const file = path.join(root, 'index.cascade');
    const document = { version: '0.2', nodes: [{ id: 'big', module: 'project.Big' }], connections: [] };
    fs.writeFileSync(file, JSON.stringify(document));
    return { file, document };
  }

  it('warns under check, resolves, and stays silent under validate', async () => {
    const fixture = project(longExecute(LONG_EXECUTE_LINES + 10).replace('export function execute(context) {', `export function execute(context) {\n  context.outputs.result.set(1);`));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(checkProjectGraph(fixture.file, fixture.document, true)).resolves.toBe(0);
      const printed = warn.mock.calls.flat().join('\n');
      expect(printed).toContain('shape/long-execute');
      expect(printed).toContain('the check still passes');
      warn.mockClear();
      await validateProjectGraph(fixture.file, fixture.document);
      expect(warn.mock.calls.flat().join('\n')).not.toContain('shape/');
    } finally {
      warn.mockRestore();
    }
  });
});
