import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { getNodePathShort, nodeLibraries } from '@/editor/nodeTemplates';
import { Graph } from '@/nodes/Graph';
import { registerDefinitionNodes } from '@/nodes/definition/DefinitionNode';
import { initializeNodeLibraries } from '@/nodes/initializeLibraries';
import type { NodeDefinition, NodeExecutionContext } from '../packages/contracts/src/index.js';
import { createRuntime } from '../packages/runtime/src/index.js';
import { createNodeRuntimeHost } from '../packages/runtime/src/node.js';
import { classifyPreflight } from '@/cli/projectRuntime';
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

// A node's own id is the only thing that lets two instances of one module
// write different scratch files. Both hosts cast the context they build, so
// tsc cannot catch a host that forgets the field — only a test can.
const identityDefinition = {
  apiVersion: 1,
  runsOn: 'portable',
  outputs: {
    id: { kind: 'data', type: 'string' },
  },
} as const satisfies NodeDefinition;

function executeIdentity(context: NodeExecutionContext<typeof identityDefinition>) {
  context.outputs.id.set(context.nodeId);
}

// A ranged vector prop, which `NumericMetadata` typed as `never` until
// 2026-09-08. This declaration failing to compile is the regression test — the
// assertions below only check that the range then reaches the parameter.
const rangedVectorDefinition = {
  apiVersion: 1,
  runsOn: 'portable',
  props: {
    offset: { type: 'vec2', default: [0, 0], min: -1, max: 1, step: 0.005 },
    size: { type: 'vec2i', default: [1024, 1024], min: 16, max: 4096, step: 64 },
  },
  outputs: {
    offset: { kind: 'data', type: 'vec2' },
  },
} as const satisfies NodeDefinition;

function executeRangedVector(context: NodeExecutionContext<typeof rangedVectorDefinition>) {
  context.outputs.offset.set(context.props.offset);
}

const rangedVectorRegistration = {
  kind: 'definition-v1',
  moduleId: 'cascade.test.RangedVector',
  definition: rangedVectorDefinition,
  loadExecute: async () => executeRangedVector,
} satisfies DefinitionNodeRegistration<typeof rangedVectorDefinition>;

// A prop that arrives already moving. `$F` rather than `$T` so a frame number
// reads straight out of the output and a wrong value is obvious.
const selfAnimatingDefinition = {
  apiVersion: 1,
  runsOn: 'portable',
  props: {
    time: { type: 'float', default: 0, expression: '$F' },
  },
  outputs: {
    time: { kind: 'data', type: 'float' },
  },
} as const satisfies NodeDefinition;

function executeSelfAnimating(context: NodeExecutionContext<typeof selfAnimatingDefinition>) {
  context.outputs.time.set(context.props.time);
}

const selfAnimatingRegistration = {
  kind: 'definition-v1',
  moduleId: 'cascade.test.SelfAnimating',
  definition: selfAnimatingDefinition,
  loadExecute: async () => executeSelfAnimating,
} satisfies DefinitionNodeRegistration<typeof selfAnimatingDefinition>;

const identityRegistration = {
  kind: 'definition-v1',
  moduleId: 'cascade.test.Identity',
  definition: identityDefinition,
  loadExecute: async () => executeIdentity,
} satisfies DefinitionNodeRegistration<typeof identityDefinition>;

describe('definition-v1 nodes in Studio', () => {
  afterEach(() => vi.restoreAllMocks());

  beforeAll(async () => {
    await initializeNodeLibraries();
    registerDefinitionNodes([interactionRegistration, identityRegistration, rangedVectorRegistration, selfAnimatingRegistration]);
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
  it('hands each instance its own id in Studio', async () => {
    const graph = new Graph();
    const first = graph.addNode('cascade.test.Identity', { x: 0, y: 0 });
    const second = graph.addNode('cascade.test.Identity', { x: 0, y: 100 });

    await graph.execute();

    const idOf = (node: typeof first) => node.outputs.find(port => port.name === 'id')?.value;
    expect(idOf(first)).toBe(first.id);
    expect(idOf(second)).toBe(second.id);
    expect(idOf(first)).not.toBe(idOf(second));
  });

  it('hands each instance its own id in the headless runtime', async () => {
    const runtime = createRuntime({
      host: createNodeRuntimeHost({}),
      nodes: [identityRegistration],
    });
    const graph = await runtime.load({
      version: '0.2',
      nodes: [
        { id: 'logo-1024', module: 'cascade.test.Identity' },
        { id: 'logo-32', module: 'cascade.test.Identity' },
      ],
      connections: [],
    });

    await graph.run();

    expect(graph.getOutput('logo-1024', 'id')).toBe('logo-1024');
    expect(graph.getOutput('logo-32', 'id')).toBe('logo-32');
    await graph.dispose();
    await runtime.dispose();
  });
  it('reports a prop still stored under params, and runs anyway', async () => {
    const runtime = createRuntime({ host: createNodeRuntimeHost({}) });
    const graph = await runtime.load({
      version: '0.2',
      nodes: [{
        id: 'circle',
        module: 'cascade.geo.Circle',
        inputs: { divisions: 5 },
        params: [{ name: 'type', value: 'poly' }],
      }],
      connections: [],
    });

    // The value is lost — that is the fault, not the warning.
    expect(graph.inspect().nodes.find(node => node.id === 'circle')?.props.type)
      .toMatchObject({ value: 'bezier' });
    expect(graph.preflight()).toEqual([expect.objectContaining({
      code: 'runtime/stray-params',
      path: 'circle',
    })]);

    // A warning, so the run still happens. A graph on its defaults runs fine,
    // which is exactly why this needed saying out loud.
    const result = await graph.run();
    expect(result.status).toBe('completed');
    expect(classifyPreflight(graph.preflight())).toMatchObject({ errors: [] });
    await graph.dispose();
    await runtime.dispose();
  });

  it('stays quiet about a params key naming nothing the definition declares', async () => {
    const runtime = createRuntime({ host: createNodeRuntimeHost({}) });
    const graph = await runtime.load({
      version: '0.2',
      nodes: [{
        id: 'circle',
        module: 'cascade.geo.Circle',
        params: [{ name: 'nodeColor', value: '#fff' }],
      }],
      connections: [],
    });

    expect(graph.preflight()).toEqual([]);
    await graph.dispose();
    await runtime.dispose();
  });
  it('carries a vector prop\'s range through to the parameter', async () => {
    // Marcus's rule is one `vec2` rather than two floats, and two floats could
    // carry a range where the vec2 could not — so following the convention
    // silently cost the Inspector its clamp and its drag step.
    const graph = new Graph();
    const node = graph.addNode('cascade.test.RangedVector', { x: 0, y: 0 });

    expect(node.parameters.find(parameter => parameter.name === 'offset')?.options)
      .toMatchObject({ min: -1, max: 1, step: 0.005 });
    expect(node.parameters.find(parameter => parameter.name === 'size')?.options)
      .toMatchObject({ min: 16, max: 4096, step: 64 });
  });

  it('reports a value stranded under params on an input, not just on a prop', async () => {
    // The first version of this warning checked props alone, which missed the
    // case the conversions produce most: a parameter another node drives must
    // be an `inputs` entry, because a v1 prop cannot be promoted to a pin.
    const runtime = createRuntime({ host: createNodeRuntimeHost({}) });
    const graph = await runtime.load({
      version: '0.2',
      nodes: [{
        id: 'circle',
        module: 'cascade.geo.Circle',
        params: [{ name: 'divisions', value: 5 }],
      }],
      connections: [],
    });

    expect(graph.preflight()).toEqual([expect.objectContaining({
      code: 'runtime/stray-params',
      path: 'circle',
    })]);
    expect(graph.preflight()[0].message).toContain('divisions');
    await graph.dispose();
    await runtime.dispose();
  });
  it('starts a declared default expression running in the headless runtime', async () => {
    const runtime = createRuntime({
      host: createNodeRuntimeHost({}),
      nodes: [selfAnimatingRegistration],
    });
    const graph = await runtime.load({
      version: '0.2',
      nodes: [{ id: 'clock', module: 'cascade.test.SelfAnimating' }],
      connections: [],
    });

    graph.setFrame(1);
    await graph.run();
    expect(graph.getOutput('clock', 'time')).toBe(1);

    graph.setFrame(42);
    await graph.run();
    expect(graph.getOutput('clock', 'time')).toBe(42);
    await graph.dispose();
    await runtime.dispose();
  });

  it('lets a stored plain value beat the default expression', async () => {
    // The losing case is the one worth asserting. A default expression is a
    // default: a document that saved a number keeps that number and must not
    // quietly start animating on load, which is the mirror of the dropped-
    // `params` fault.
    const runtime = createRuntime({
      host: createNodeRuntimeHost({}),
      nodes: [selfAnimatingRegistration],
    });
    const graph = await runtime.load({
      version: '0.2',
      nodes: [{ id: 'clock', module: 'cascade.test.SelfAnimating', props: { time: 7 } }],
      connections: [],
    });

    graph.setFrame(1);
    await graph.run();
    expect(graph.getOutput('clock', 'time')).toBe(7);

    graph.setFrame(42);
    await graph.run();
    expect(graph.getOutput('clock', 'time')).toBe(7);
    await graph.dispose();
    await runtime.dispose();
  });

  it('lets a stored expression beat the default expression', async () => {
    const runtime = createRuntime({
      host: createNodeRuntimeHost({}),
      nodes: [selfAnimatingRegistration],
    });
    const graph = await runtime.load({
      version: '0.2',
      nodes: [{
        id: 'clock',
        module: 'cascade.test.SelfAnimating',
        props: { time: { value: 0, expression: '$F * 2' } },
      }],
      connections: [],
    });

    graph.setFrame(21);
    await graph.run();
    expect(graph.getOutput('clock', 'time')).toBe(42);
    await graph.dispose();
    await runtime.dispose();
  });

  it('gives a freshly dropped Studio node the expression, and a restored one its saved value', async () => {
    const dropped = new Graph();
    const node = dropped.addNode('cascade.test.SelfAnimating', { x: 0, y: 0 });
    await dropped.execute(node);

    // A real expression rather than a hidden fallback: it is on the prop, so
    // the Inspector shows it and it can be deleted like any other.
    expect(node.parm('time')!.expression()).toBe('$F');
    expect(node.isTimeDependent).toBe(true);

    const restored = Graph.fromJSON({
      version: '0.2',
      nodes: [{ id: 'clock', module: 'cascade.test.SelfAnimating', props: { time: 7 } }],
    });
    const saved = restored.getNode('clock')!;
    await restored.execute(saved);

    expect(saved.parm('time')!.expression()).toBeNull();
    expect(saved.rawParameterValue('time')).toBe(7);
    expect(saved.isTimeDependent).toBe(false);
  });
  it('does not reinstate a default expression the author deleted', async () => {
    // Re-declaration is the case that makes the application have to be
    // tracked rather than merely conditional. A definition-v1 node declares
    // its parameters once, in setup — but setup runs again when a module is
    // retargeted or its code is edited, and an author's deletion has to
    // survive that. Declared directly here rather than through a cook,
    // because a cook does not re-declare and a test that went through one
    // passed with the tracking removed, which is how I found it was not
    // testing this at all.
    const graph = new Graph();
    const node = graph.addNode('cascade.test.SelfAnimating', { x: 0, y: 0 });
    await graph.execute(node);
    expect(node.parm('time')!.expression()).toBe('$F');

    node.parm('time')!.deleteExpression();
    expect(node.parm('time')!.expression()).toBeNull();

    // What a retarget or a code edit does.
    node.param('time', 0, { type: 'float', defaultExpression: '$F' });

    expect(node.parm('time')!.expression()).toBeNull();
    expect(node.isTimeDependent).toBe(false);
  });
});
