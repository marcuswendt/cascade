/**
 * A definition-v1 module living in the *project* (`project.<Folder>`), cooked
 * through the Studio path.
 *
 * `cascade node <Name>` scaffolds exactly this shape, so the node the generator
 * produces is the node this file covers. Before the project-module dispatch
 * existed, Studio wired the module as `execute(node, graph)` — the v1 execute
 * then received Studio's `Node`, whose `outputs` is an array, and the cook threw
 * on `context.outputs.result`. Nothing here mocks the wiring: the compiler is
 * injected the way the CLI injects it, and the graph is deserialized and cooked.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { Graph } from '@/nodes/Graph';
import { setProjectModuleCompiler } from '@/engine/nodeModuleLoader';

const doublerModule = `
export const definition = {
  apiVersion: 1,
  label: 'Doubler',
  icon: 'Circle',
  runsOn: 'portable',
  inputs: {
    value: { kind: 'data', type: 'float', default: 3 },
  },
  outputs: {
    result: { kind: 'data', type: 'float' },
  },
  props: {
    factor: { type: 'float', default: 2, min: 0, max: 10 },
  },
};

export function execute(context) {
  context.outputs.result.set(context.inputs.value * context.props.factor);
}
`;

const legacyModule = `
export async function execute(node) {
  const input = node.in('value', 5, { type: 'float' }).value;
  const out = node.out('result', 'param', { type: 'float' });
  out.setValue(input + 1);
}
`;

function projectGraph(module: string, extra: Record<string, unknown> = {}) {
  return Graph.fromJSON({
    version: '0.2',
    nodes: [{
      id: 'subject',
      module,
      source: 'project',
      position: [0, 0],
      ...extra,
    }],
    connections: [],
  });
}

describe('definition-v1 project modules in Studio', () => {
  afterEach(() => setProjectModuleCompiler(null));

  it('builds ports from the definition literal and cooks with a real context', async () => {
    setProjectModuleCompiler(async () => doublerModule);

    const graph = projectGraph('project.Doubler');
    const node = graph.getNode('subject')!;
    await graph.execute(node);

    expect(node.error).toBeFalsy();
    expect(node.inputs.map(port => [port.name, port.dataType])).toEqual([['value', 'float']]);
    expect(node.outputs.map(port => [port.name, port.dataType])).toEqual([['result', 'float']]);
    expect(node.parameters.map(parameter => [parameter.name, parameter.value])).toEqual([['factor', 2]]);
    expect(node.inputs[0].value).toBe(3);
    expect(node.outputs[0].value).toBe(6);
  });

  it('carries a stored prop into the definition context', async () => {
    setProjectModuleCompiler(async () => doublerModule);

    const graph = projectGraph('project.Doubler', { inputs: { value: 4 }, props: { factor: 3 } });
    const node = graph.getNode('subject')!;
    await graph.execute(node);

    expect(node.error).toBeFalsy();
    expect(node.outputs[0].value).toBe(12);
    expect(graph.toJSON().nodes[0]).toMatchObject({
      module: 'project.Doubler',
      props: { factor: 3 },
    });
  });

  it('still cooks a legacy dynamic project module unchanged', async () => {
    setProjectModuleCompiler(async () => legacyModule);

    const graph = projectGraph('project.Legacy');
    const node = graph.getNode('subject')!;
    await graph.execute(node);

    expect(node.error).toBeFalsy();
    expect(node.outputs.find(port => port.name === 'result')?.value).toBe(6);
  });
});
