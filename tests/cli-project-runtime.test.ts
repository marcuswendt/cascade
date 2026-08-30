import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkProjectGraph, inspectProjectGraph, runDeterministicProjectGraph, validateProjectGraph } from '@/cli/projectRuntime';

const roots: string[] = [];

afterEach(() => {
  delete (globalThis as any).__cascadeModuleEvaluated;
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function project(source: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-cli-runtime-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'nodes', 'Multiply'), { recursive: true });
  fs.writeFileSync(path.join(root, 'nodes', 'Multiply', 'index.ts'), source);
  const file = path.join(root, 'index.cascade');
  const document = { version: '0.2', nodes: [{ id: 'multiply', module: 'project.Multiply' }], connections: [] };
  fs.writeFileSync(file, JSON.stringify(document));
  return { root, file, document };
}

const validSource = `
globalThis.__cascadeModuleEvaluated = true;
export const definition = {
  apiVersion: 1,
  runsOn: 'portable',
  inputs: { value: { kind: 'data', type: 'float', default: 2 } },
  outputs: { result: { kind: 'data', type: 'float' } }
} as const;
export function execute(context) {
  context.outputs.result.set(context.inputs.value * 2);
}
`;

describe('deterministic CLI runtime', () => {
  it('validates definitions and graph structure without evaluating modules', async () => {
    const fixture = project(validSource);
    await validateProjectGraph(fixture.file, fixture.document);
    expect((globalThis as any).__cascadeModuleEvaluated).toBeUndefined();
  });

  it('runs a fully deterministic graph through the headless runtime', async () => {
    const fixture = project(validSource);
    await expect(runDeterministicProjectGraph(fixture.file, fixture.document)).resolves.toBe(true);
  });

  it('recognizes reserved core nodes without project modules', async () => {
    const fixture = project(validSource);
    fixture.document = {
      version: '0.2',
      nodes: [
        { id: 'input', module: 'cascade.core.Input', inputs: { value: 0.25 } },
        { id: 'remap', module: 'cascade.core.Remap', inputs: { inMin: 0, inMax: 1, outMin: 0, outMax: 100 } },
        { id: 'output', module: 'cascade.core.Output' },
      ],
      connections: [
        [['input', 0, 'output'], ['remap', 0, 'value']],
        [['remap', 0, 'result'], ['output', 0, 'input']],
      ],
    } as any;

    await expect(checkProjectGraph(fixture.file, fixture.document)).resolves.toBeUndefined();
    await expect(runDeterministicProjectGraph(fixture.file, fixture.document)).resolves.toBe(true);
    await expect(inspectProjectGraph(fixture.file, fixture.document)).resolves.toMatchObject({
      deterministic: true,
      nodes: [
        { classification: 'definition-v1' },
        { classification: 'definition-v1' },
        { classification: 'definition-v1' },
      ],
    });
  });

  it('never falls back when a declared deterministic definition is malformed', async () => {
    const fixture = project(`
      export const definition = makeDefinition();
      export function execute() {}
    `);
    await expect(validateProjectGraph(fixture.file, fixture.document)).rejects.toThrow('definition/non-literal');
  });

  it('rejects mixed deterministic and dynamic execution explicitly', async () => {
    const fixture = project(validSource);
    fixture.document.nodes.push({ id: 'legacy', module: 'cascade.core.Value' });
    await expect(runDeterministicProjectGraph(fixture.file, fixture.document)).rejects.toThrow(/Mixed deterministic and dynamic/);
  });

  it('keeps document validation compatible but rejects dynamic modules during static check', async () => {
    const fixture = project(validSource);
    fixture.document.nodes.push({ id: 'legacy', module: 'cascade.core.Value' });

    await expect(validateProjectGraph(fixture.file, fixture.document)).resolves.toBeUndefined();
    await expect(checkProjectGraph(fixture.file, fixture.document)).rejects.toThrow(/dynamic modules: cascade\.core\.Value/);
  });

  it('validates legacy tuple connections when nodes do not persist port metadata', async () => {
    const fixture = project(validSource);
    fixture.document = {
      version: '0.2',
      nodes: [
        { id: 'source', module: 'cascade.core.Value' },
        { id: 'target', module: 'cascade.core.Value' },
      ],
      connections: [[['source', 0, 'value'], ['target', 0, 'value']]],
    } as any;

    await expect(validateProjectGraph(fixture.file, fixture.document)).resolves.toBeUndefined();
    fixture.document.connections[0][1][0] = 'missing';
    await expect(validateProjectGraph(fixture.file, fixture.document)).rejects.toThrow(/unknown node/);
  });

  it('inspects definitions without evaluating modules', async () => {
    const fixture = project(validSource);
    const inspection = await inspectProjectGraph(fixture.file, fixture.document);
    expect(inspection).toMatchObject({ deterministic: true, connections: 0 });
    expect(inspection.nodes[0]).toMatchObject({ id: 'multiply', module: 'project.Multiply', classification: 'definition-v1' });
    expect((globalThis as any).__cascadeModuleEvaluated).toBeUndefined();
  });
});
