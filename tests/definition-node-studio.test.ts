import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { getNodePathShort, nodeLibraries } from '@/editor/nodeTemplates';
import { Graph } from '@/nodes/Graph';
import { registerDefinitionNodes } from '@/nodes/definition/DefinitionNode';
import { initializeNodeLibraries } from '@/nodes/initializeLibraries';
import type { NodeDefinition, NodeExecutionContext } from '../packages/contracts/src/index.js';
import { createRuntime } from '../packages/runtime/src/index.js';
import { createNodeRuntimeHost } from '../packages/runtime/src/node.js';
import type { DefinitionNodeRegistration } from '../packages/runtime/src/types.js';

const interactionDefinition = {
  apiVersion: 1,
  runsOn: 'portable',
  inputs: {
    fire: { kind: 'trigger', description: 'Run with the selected mode.' },
    mode: {
      kind: 'data',
      type: 'string',
      default: 'first',
      control: 'select',
      options: ['first', 'second'],
    },
  },
  outputs: {
    selected: { kind: 'data', type: 'string' },
  },
} as const satisfies NodeDefinition;

function executeInteraction(context: NodeExecutionContext<typeof interactionDefinition>) {
  context.outputs.selected.set(`${context.inputs.mode}:${context.inputs.fire?.payload ?? ''}`);
}

const interactionRegistration = {
  kind: 'definition-v1',
  moduleId: 'cascade.test.Interaction',
  definition: interactionDefinition,
  loadExecute: async () => executeInteraction,
} satisfies DefinitionNodeRegistration<typeof interactionDefinition>;

describe('definition-v1 nodes in Studio', () => {
  afterEach(() => vi.restoreAllMocks());

  beforeAll(async () => {
    await initializeNodeLibraries();
    registerDefinitionNodes([interactionRegistration]);
  });

  it('lists the runtime geometry library in the node picker', () => {
    const geometry = nodeLibraries.find(library => library.id === 'geo');
    expect(geometry?.categories.flatMap(category => category.nodes).map(node => node.type)).toEqual([
      'cascade.geo.Rectangle',
      'cascade.geo.Circle',
      'cascade.geo.Transform',
      'cascade.geo.Merge',
      'cascade.geo.CopyToPoints',
      'cascade.geo.SvgExport',
    ]);
    expect(getNodePathShort('cascade.geo.Transform')).toBe('geo.Transform');
  });

  it('runs capability-backed SVG export through the Studio host', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ path: './assets/images/studio.svg' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    const graph = new Graph();
    const exporter = graph.addNode('cascade.geo.SvgExport', { x: 0, y: 0 });

    await graph.execute(exporter);

    expect(fetchMock).toHaveBeenCalledWith('/api/assets', expect.objectContaining({ method: 'POST' }));
    expect(exporter.outputs.find(port => port.name === 'svg')?.value).toContain('<svg');
    expect(exporter.outputs.find(port => port.name === 'asset')?.value).toEqual({
      path: './assets/images/studio.svg',
      mediaType: 'image/svg+xml',
    });
  });

  it('keeps generated variadic ports typed and cooks all connected geometry', async () => {
    const graph = new Graph();
    const first = graph.addNode('cascade.geo.Rectangle', { x: 0, y: 0 });
    const second = graph.addNode('cascade.geo.Rectangle', { x: 0, y: 100 });
    const merge = graph.addNode('cascade.geo.Merge', { x: 200, y: 50 });

    graph.connect(first.outputs[0], merge.inputs[0]);
    expect(merge.inputs[1]).toMatchObject({ name: 'input_1', dataType: 'geometry' });
    graph.connect(second.outputs[0], merge.inputs[1]);
    await graph.execute();

    expect(merge.outputs[0].value).toMatchObject({ kind: 'geometry', pointCount: 8 });
    expect(merge.inputs[2]).toMatchObject({ name: 'input_2', dataType: 'geometry' });
  });

  it('creates and cooks a runtime-native geometry node', async () => {
    const graph = new Graph();
    const rectangle = graph.addNode('cascade.geo.Rectangle', { x: 10, y: 20 });

    expect(rectangle.inputs.map(port => [port.name, port.dataType])).toEqual([
      ['size', 'vec2'],
      ['center', 'vec2'],
    ]);
    expect(rectangle.outputs.map(port => [port.name, port.dataType])).toEqual([
      ['geometry', 'geometry'],
    ]);

    rectangle.inputs[0].value = [4, 2];
    await graph.execute(rectangle);

    const geometry = rectangle.outputs[0].value;
    expect(geometry).toMatchObject({ kind: 'geometry', pointCount: 4 });
    expect(Array.from(geometry.point.P.data)).toEqual([
      -2, -1,
      2, -1,
      2, 1,
      -2, 1,
    ]);
  });

  it('restores definition inputs and props without duplicating their schema', async () => {
    const graph = Graph.fromJSON({
      version: '0.2',
      nodes: [{
        id: 'circle1',
        module: 'cascade.geo.Circle',
        source: 'stdlib',
        position: [0, 0],
        inputs: [
          { name: 'radius', defaultValue: [3, 2], dataType: 'vec2' },
          { name: 'divisions', defaultValue: 12, dataType: 'int' },
        ],
        params: [{ name: 'type', value: 'poly' }],
      }],
      connections: [],
    });

    const circle = graph.getNode('circle1');
    expect(circle?.inputs.find(port => port.name === 'radius')?.value).toEqual([3, 2]);
    expect(circle?.parameters).toHaveLength(1);
    expect(circle?.parameters[0]).toMatchObject({
      name: 'type',
      value: 'poly',
      defaultValue: 'bezier',
      dataType: 'string',
    });

    await graph.execute(circle!);
    expect(circle?.outputs[0].value).toMatchObject({ kind: 'geometry', pointCount: 12 });
    expect(graph.toJSON().nodes[0]).toMatchObject({
      module: 'cascade.geo.Circle',
      props: { type: 'poly' },
    });
    expect(graph.toJSON().nodes[0]).not.toHaveProperty('params');
  });

  it('accepts both authored input shapes without replacing definition defaults or types', () => {
    const arrayGraph = Graph.fromJSON({
      version: '0.2',
      nodes: [{
        id: 'array-circle',
        module: 'cascade.geo.Circle',
        inputs: [
          { name: 'center' },
          { name: 'radius', value: [4, 2], dataType: 'string' },
          { name: 'divisions', defaultValue: 9 },
        ],
      }],
    });
    const recordGraph = Graph.fromJSON({
      version: '0.2',
      nodes: [{
        id: 'record-circle',
        module: 'cascade.geo.Circle',
        inputs: { radius: [6, 3], divisions: 7 },
      }],
    });

    expect(arrayGraph.getNode('array-circle')?.inputs.map(port => ({
      name: port.name,
      value: port.value,
      defaultValue: port.defaultValue,
      dataType: port.dataType,
    }))).toEqual([
      { name: 'center', value: [0, 0], defaultValue: [0, 0], dataType: 'vec2' },
      { name: 'radius', value: [4, 2], defaultValue: [1, 1], dataType: 'vec2' },
      { name: 'divisions', value: 9, defaultValue: 32, dataType: 'int' },
    ]);
    expect(recordGraph.getNode('record-circle')?.inputs.map(port => [port.name, port.value])).toEqual([
      ['center', [0, 0]],
      ['radius', [6, 3]],
      ['divisions', 7],
    ]);
  });

  it('adapts selectable inputs and named triggers to Studio ports', async () => {
    const graph = new Graph();
    const node = graph.addNode('cascade.test.Interaction', { x: 0, y: 0 });
    const trigger = node.inputs.find(port => port.name === 'fire');
    const mode = node.inputs.find(port => port.name === 'mode');

    expect(trigger?.portType).toBe('trigger');
    expect(mode?.options.choices).toEqual([
      { value: 'first', label: 'first' },
      { value: 'second', label: 'second' },
    ]);
    await graph.execute();
    expect(node.outputs.find(port => port.name === 'selected')?.value).toBeUndefined();

    mode!.value = 'second';
    await trigger?.onTrigger?.('manual');
    expect(node.outputs.find(port => port.name === 'selected')?.value).toBe('second:manual');
  });

  it('round-trips definition props from Studio into the headless runtime', async () => {
    const studio = Graph.fromJSON({
      version: '0.2',
      nodes: [{
        id: 'circle',
        module: 'cascade.geo.Circle',
        inputs: { divisions: 5 },
        props: { type: 'poly' },
      }],
    });
    const document = studio.toJSON();
    expect(document.nodes[0]).toMatchObject({ props: { type: 'poly' } });

    const runtime = createRuntime({ host: createNodeRuntimeHost({}) });
    const graph = await runtime.load(document);
    await graph.run();
    expect(graph.getOutput('circle', 'geometry')).toMatchObject({
      kind: 'geometry',
      pointCount: 5,
    });
    await graph.dispose();
    await runtime.dispose();
  });
});
