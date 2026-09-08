import { describe, expect, it } from 'vitest';

import type {
  NodeDefinition,
  NodeExecutionContext,
} from '../../packages/contracts/src/index.js';
import { createRuntime } from '../../packages/runtime/src/index.js';
import { createNodeRuntimeHost } from '../../packages/runtime/src/node.js';
import type { DefinitionNodeRegistration } from '../../packages/runtime/src/types.js';

const incrementDefinition = {
  apiVersion: 1,
  runsOn: 'portable',
  inputs: {
    value: { kind: 'data', type: 'float', default: 0 },
  },
  outputs: {
    result: { kind: 'data', type: 'float' },
  },
} as const satisfies NodeDefinition;

function executeIncrement(
  context: NodeExecutionContext<typeof incrementDefinition>,
): void {
  context.outputs.result.set(context.inputs.value + 1);
}

const incrementRegistration = {
  kind: 'definition-v1',
  moduleId: 'cascade.perf.Increment',
  definition: incrementDefinition,
  loadExecute: async () => executeIncrement,
} satisfies DefinitionNodeRegistration<typeof incrementDefinition>;

describe('deterministic runtime graph lookup performance', () => {
  it('does not rescan unrelated connections for every node input', async () => {
    const nodeCount = 300;
    const nodes = Array.from({ length: nodeCount }, (_, index) => ({
      id: `node-${index}`,
      module: incrementRegistration.moduleId,
    }));
    const connections = Array.from({ length: nodeCount - 1 }, (_, index) => ({
      source: { nodeId: `node-${index}`, outputName: 'result' },
      target: { nodeId: `node-${index + 1}`, inputName: 'value' },
    }));
    const runtime = createRuntime({
      host: createNodeRuntimeHost({}),
      nodes: [incrementRegistration],
    });
    const graph = await runtime.load({
      version: '0.2',
      nodes,
      connections,
    });

    const internalGraph = graph as unknown as {
      connections: typeof connections;
      nodes: typeof nodes;
    };
    const isIndex = (key: PropertyKey) =>
      typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key);
    let connectionReads = 0;
    let nodeReads = 0;
    internalGraph.connections = new Proxy(internalGraph.connections, {
      get(target, key, receiver) {
        if (isIndex(key)) connectionReads++;
        return Reflect.get(target, key, receiver);
      },
    });
    internalGraph.nodes = new Proxy(internalGraph.nodes, {
      get(target, key, receiver) {
        if (isIndex(key)) nodeReads++;
        return Reflect.get(target, key, receiver);
      },
    });

    try {
      const result = await graph.run();

      expect(result.status).toBe('completed');
      expect(graph.getOutput(`node-${nodeCount - 1}`, 'result')).toBe(nodeCount);
      expect(connectionReads).toBeLessThan(nodeCount * 20);
      expect(nodeReads).toBeLessThan(nodeCount * 20);

      const readsBeforeInspection = connectionReads;
      const inspection = graph.inspect();
      expect(inspection.nodes[0].inputs.value.connected).toBe(false);
      expect(inspection.nodes[0].outputs.result.connected).toBe(true);
      expect(inspection.nodes[nodeCount - 1].inputs.value.connected).toBe(true);
      expect(inspection.nodes[nodeCount - 1].outputs.result.connected).toBe(false);
      expect(connectionReads - readsBeforeInspection).toBeLessThan(nodeCount * 2);
    } finally {
      await graph.dispose();
      await runtime.dispose();
    }
  });
});
