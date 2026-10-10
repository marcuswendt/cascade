/**
 * Bundle ports: one port carrying named fields, so a node with a dozen outputs
 * can export one `format` instead of twelve wires.
 *
 * Covers both hosts (the neutral runtime and Studio's compatibility graph),
 * field access from node code and from expressions, the Python stage bridge,
 * per-field early cutoff, and the static check's unknown-field errors.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';
import { expressionEngine } from '@/engine/expressions/index';
import { attachDefinition } from '@/nodes/definition/DefinitionNode';
import { classifyPreflight } from '@/cli/projectRuntime';
import type { NodeDefinition, NodeExecutionContext } from '../packages/contracts/src/index.js';
import { validateNodeDefinition } from '../packages/contracts/src/index.js';
import { suggestName } from '../packages/contracts/src/bundle.js';
import { createRuntime } from '../packages/runtime/src/index.js';
import { createNodeRuntimeHost } from '../packages/runtime/src/node.js';
import type { DefinitionNodeRegistration } from '../packages/runtime/src/types.js';
import { bundleFieldReferences } from '../packages/runtime/src/expressions/bundlePaths.js';
import { ProjectRoot } from '../server/src/project.js';
import { runProjectStage } from '../server/src/stageRunner.js';

// ---------------------------------------------------------------- fixtures

const formatDefinition = {
  apiVersion: 1,
  runsOn: 'portable',
  props: {
    dpi: { type: 'float', default: 100 },
    paper: { type: 'string', default: 'white' },
  },
  outputs: {
    format: {
      kind: 'data',
      type: 'bundle',
      schema: 'format',
      fields: {
        size_mm: 'vec2',
        dpi: { type: 'float', description: 'dots per inch' },
        paper: 'string',
        preview: 'image',
      },
    },
  },
} as const satisfies NodeDefinition;

function executeFormat(context: NodeExecutionContext<typeof formatDefinition>) {
  context.outputs.format.set({
    size_mm: [382, 256],
    dpi: context.props.dpi,
    paper: context.props.paper,
    // An image travels as its reference, never its pixels.
    preview: { path: '.cascade-cache/preview.png', size: [64, 32], channels: 'rgba', depth: 'u8', space: 'srgb' },
  });
}

const readerDefinition = {
  apiVersion: 1,
  runsOn: 'portable',
  inputs: {
    format: { kind: 'data', type: 'bundle', schema: 'format', fields: ['dpi'] },
  },
  props: {
    scale: { type: 'float', default: 1 },
  },
  outputs: {
    seen: { kind: 'data', type: 'string' },
    scaled: { kind: 'data', type: 'float' },
  },
} as const satisfies NodeDefinition;

function executeReader(context: NodeExecutionContext<typeof readerDefinition>) {
  const format = context.inputs.format ?? {};
  context.outputs.seen.set(Object.keys(format).sort().join(','));
  context.outputs.scaled.set(Number(format.dpi ?? 0) * context.props.scale);
}

const registrations: DefinitionNodeRegistration[] = [
  {
    kind: 'definition-v1',
    moduleId: 'cascade.test.Format',
    definition: formatDefinition,
    loadExecute: async () => executeFormat as never,
  },
  {
    kind: 'definition-v1',
    moduleId: 'cascade.test.Reader',
    definition: readerDefinition,
    loadExecute: async () => executeReader as never,
  },
];

function documentWith(readerProps: Record<string, unknown> = {}, extraNodes: unknown[] = [], extraConnections: unknown[] = []) {
  return {
    version: '0.2',
    nodes: [
      { id: 'format', module: 'cascade.test.Format' },
      { id: 'reader', module: 'cascade.test.Reader', props: readerProps },
      ...extraNodes,
    ],
    connections: [
      { source: { nodeId: 'format', outputName: 'format' }, target: { nodeId: 'reader', inputName: 'format' } },
      ...extraConnections,
    ],
  };
}

async function load(document: unknown) {
  const runtime = createRuntime({ host: createNodeRuntimeHost({}), nodes: registrations });
  const graph = await runtime.load(document as never);
  return { runtime, graph };
}

// ---------------------------------------------------------------- contract

describe('bundle definitions', () => {
  it('accepts a producer and a consumer declaration', () => {
    expect(validateNodeDefinition(formatDefinition)).toEqual([]);
    expect(validateNodeDefinition(readerDefinition)).toEqual([]);
  });

  it('rejects schema and fields on a port that is not a bundle, and malformed fields', () => {
    const codes = validateNodeDefinition({
      apiVersion: 1,
      runsOn: 'portable',
      inputs: {
        a: { kind: 'data', type: 'float', fields: ['x'] },
        b: { kind: 'data', type: 'bundle', fields: { x: 'float' } },
      },
      outputs: {
        c: { kind: 'data', type: 'bundle', fields: { x: 'nonsense' } },
        d: { kind: 'data', type: 'bundle', schema: 'not a name' },
      },
    }).map(item => item.code);
    expect(codes).toEqual(expect.arrayContaining([
      'definition/bundle-metadata',
      'definition/invalid-fields',
      'definition/invalid-type',
      'definition/invalid-schema',
    ]));
  });

  it('suggests the nearest field name and nothing for a stranger', () => {
    expect(suggestName('dpu', ['size_mm', 'dpi', 'paper'])).toBe('dpi');
    expect(suggestName('colour', ['size_mm', 'dpi', 'paper'])).toBeUndefined();
  });

  it('finds the relative bundle reads in an expression', () => {
    expect(bundleFieldReferences('ch("format.dpi") * chv("./format.size_mm")[0] + ch("../x/y")'))
      .toEqual([
        { port: 'format', field: 'dpi', path: 'format.dpi' },
        { port: 'format', field: 'size_mm', path: './format.size_mm' },
      ]);
  });
});

// ---------------------------------------------------------------- runtime

describe('bundles in the neutral runtime', () => {
  it('hands a consumer only the fields it declared', async () => {
    const { runtime, graph } = await load(documentWith());
    const result = await graph.run();
    expect(result.status).toBe('completed');
    expect(graph.getOutput('reader', 'seen')).toBe('dpi');
    expect(graph.getOutput('reader', 'scaled')).toBe(100);
    expect(graph.getOutput('format', 'format')).toMatchObject({ preview: { path: '.cascade-cache/preview.png' } });
    await runtime.dispose();
  });

  it('resolves an expression that reads a wired bundle field, after the producer cooked', async () => {
    const { runtime, graph } = await load(documentWith({ scale: { value: 1, expression: 'chv("format.size_mm")[0] / 100' } }));
    const result = await graph.run();
    expect(result.diagnostics).toEqual([]);
    expect(graph.getOutput('reader', 'scaled')).toBeCloseTo(100 * 3.82);
    await runtime.dispose();
  });

  it('picks one field and packs loose values', async () => {
    const { runtime, graph } = await load(documentWith({}, [
      { id: 'pick', module: 'cascade.core.Pick', props: { field: 'paper' } },
      { id: 'pack', module: 'cascade.core.Pack', props: { names: 'paper, again' } },
    ], [
      { source: { nodeId: 'format', outputName: 'format' }, target: { nodeId: 'pick', inputName: 'bundle' } },
      { source: { nodeId: 'pick', outputName: 'value' }, target: { nodeId: 'pack', inputName: 'input_0' } },
      { source: { nodeId: 'pick', outputName: 'value' }, target: { nodeId: 'pack', inputName: 'input_1' } },
    ]));
    await graph.run();
    expect(graph.getOutput('pick', 'value')).toBe('white');
    expect(graph.getOutput('pack', 'bundle')).toEqual({ paper: 'white', again: 'white' });
    await runtime.dispose();
  });

  it('refuses a producer that sets an undeclared field, naming the near miss', async () => {
    const runtime = createRuntime({
      host: createNodeRuntimeHost({}),
      nodes: [{
        ...registrations[0],
        loadExecute: async () => ((context: NodeExecutionContext<typeof formatDefinition>) => {
          context.outputs.format.set({ dpu: 1 } as never);
        }) as never,
      }],
    });
    const graph = await runtime.load({ version: '0.2', nodes: [{ id: 'format', module: 'cascade.test.Format' }], connections: [] } as never);
    const result = await graph.run();
    expect(result.status).toBe('failed');
    expect(result.diagnostics.map(item => item.message).join('\n')).toMatch(/undeclared bundle field "dpu" — did you mean "dpi"/);
    await runtime.dispose();
  });

  it('refuses to wire two different schemas together', async () => {
    const signals = {
      kind: 'definition-v1' as const,
      moduleId: 'cascade.test.Signals',
      definition: {
        apiVersion: 1,
        runsOn: 'portable',
        outputs: { signals: { kind: 'data', type: 'bundle', schema: 'signals' } },
      } as const satisfies NodeDefinition,
      loadExecute: async () => (() => {}) as never,
    };
    const runtime = createRuntime({ host: createNodeRuntimeHost({}), nodes: [...registrations, signals] });
    await expect(runtime.load({
      version: '0.2',
      nodes: [{ id: 's', module: 'cascade.test.Signals' }, { id: 'reader', module: 'cascade.test.Reader' }],
      connections: [{ source: { nodeId: 's', outputName: 'signals' }, target: { nodeId: 'reader', inputName: 'format' } }],
    } as never)).rejects.toThrow(/signals bundle into an input that takes format/);
    await runtime.dispose();
  });
});

// ---------------------------------------------------------------- check

describe('cascade check on bundle fields', () => {
  async function errors(document: unknown) {
    const { runtime, graph } = await load(document);
    const found = classifyPreflight(graph.preflight()).errors.map(item => `${item.code}: ${item.message}`);
    await runtime.dispose();
    return found;
  }

  it('passes a graph that reads declared fields', async () => {
    expect(await errors(documentWith({ scale: { value: 1, expression: 'ch("format.dpi")' } }))).toEqual([]);
  });

  it('names an unknown field in an expression and suggests the right one', async () => {
    const found = await errors(documentWith({ scale: { value: 1, expression: 'ch("format.dpu")' } }));
    expect(found).toEqual([expect.stringMatching(/runtime\/bundle-unknown-field: .*unknown bundle field "dpu" — did you mean "dpi"\?/)]);
  });

  it('names an unknown input port in a bundle path', async () => {
    const found = await errors(documentWith({ scale: { value: 1, expression: 'ch("fromat.dpi")' } }));
    expect(found).toEqual([expect.stringMatching(/bundle-unknown-port: .*did you mean "format.dpi"/)]);
  });

  it('names an unknown field on a Pick', async () => {
    const found = await errors(documentWith({}, [
      { id: 'pick', module: 'cascade.core.Pick', props: { field: 'papr' } },
    ], [
      { source: { nodeId: 'format', outputName: 'format' }, target: { nodeId: 'pick', inputName: 'bundle' } },
    ]));
    expect(found).toEqual([expect.stringMatching(/pick\.field reads unknown bundle field "papr" — did you mean "paper"/)]);
  });

  it('refuses an absolute read of another node\'s bundle and says to wire it', async () => {
    const found = await errors(documentWith({ scale: { value: 1, expression: 'ch("/format/format.dpi")' } }));
    expect(found).toEqual([expect.stringMatching(/bundle-remote-read: .*Wire format\.format into a bundle input/)]);
  });
});

// ---------------------------------------------------------------- Studio

describe('bundles in Studio', () => {
  function studioPair() {
    const graph = new Graph();
    const format = new Node('format', 'Test', graph);
    graph.addElement(format);
    const formatCook = attachDefinition(format, registrations[0] as never, {});
    format.setFunction(formatCook);
    return { graph, format };
  }

  it('gives a definition consumer only its declared fields, and reads fields in expressions', async () => {
    const { graph, format } = studioPair();
    const reader = new Node('reader', 'Test', graph);
    graph.addElement(reader);
    reader.setFunction(attachDefinition(reader, registrations[1] as never, {}));
    graph.connect(format.outputs.find(port => port.name === 'format')!, reader.inputs.find(port => port.name === 'format')!);
    reader.parm('scale')!.setExpression('ch("format.size_mm") + chv("format.size_mm")[1] / 256');
    expressionEngine.setGraph(graph);
    await graph.execute();
    expect(reader.outputs.find(port => port.name === 'seen')!.value).toBe('dpi');
    // ch() of a vector reads 0; chv()[1] is 256 / 256.
    expect(reader.outputs.find(port => port.name === 'scaled')!.value).toBe(100);
    expect(graph.validateExpressionPaths().warnings).toEqual([]);

    reader.parm('scale')!.setExpression('ch("format.dpu")');
    const warnings = graph.validateExpressionPaths().warnings;
    expect(warnings).toHaveLength(1);
    expect(warnings[0].suggestion).toMatch(/did you mean "dpi"/);
  });

  it('re-cooks only the consumers of the field that changed', async () => {
    const graph = new Graph();
    const cooks: string[] = [];
    const source = new Node('source', 'Test', graph);
    const onA = new Node('onA', 'Test', graph);
    const onB = new Node('onB', 'Test', graph);
    const onAll = new Node('onAll', 'Test', graph);
    const viaExpression = new Node('viaExpression', 'Test', graph);
    [source, onA, onB, onAll, viaExpression].forEach(node => graph.addElement(node));
    const out = source.out<unknown>('bundle', 'param', { type: 'bundle', bundleFields: { a: 'float', b: 'float' } });
    graph.connect(out, onA.in('bundle', undefined, { type: 'bundle', fieldSelection: ['a'] }));
    graph.connect(out, onB.in('bundle', undefined, { type: 'bundle', fieldSelection: ['b'] }));
    graph.connect(out, onAll.in('bundle', undefined, { type: 'bundle' }));
    graph.connect(out, viaExpression.in('bundle', undefined, { type: 'bundle', fieldSelection: [] }));
    viaExpression.param('k', 0, { type: 'float' });
    viaExpression.parm('k')!.setExpression('ch("bundle.b")');

    let b = 1;
    source.setFunction(() => { cooks.push('source'); out.setValue({ a: 1, b }); });
    for (const node of [onA, onB, onAll, viaExpression]) node.setFunction(() => { cooks.push(node.id); });
    await graph.execute();

    cooks.length = 0;
    source.markDirty(); // same values: everything below is cut off
    await graph.scheduler.flush();
    expect(cooks).toEqual(['source']);

    cooks.length = 0;
    b = 2; // only b changed
    source.markDirty();
    await graph.scheduler.flush();
    expect(cooks.sort()).toEqual(['onAll', 'onB', 'source', 'viaExpression']);
  });

  it('treats the same bundle object committed twice as changed in every field', async () => {
    const graph = new Graph();
    const cooks: string[] = [];
    const source = new Node('source', 'Test', graph);
    const onA = new Node('onA', 'Test', graph);
    graph.addElement(source);
    graph.addElement(onA);
    const shared: Record<string, number> = { a: 1 };
    const out = source.out<unknown>('bundle', 'param', { type: 'bundle' });
    graph.connect(out, onA.in('bundle', undefined, { type: 'bundle', fieldSelection: ['a'] }));
    source.setFunction(() => { cooks.push('source'); out.setValue(shared); });
    onA.setFunction(() => { cooks.push('onA'); });
    await graph.execute();
    cooks.length = 0;
    source.markDirty();
    await graph.scheduler.flush();
    expect(cooks).toEqual(['source', 'onA']);
  });

  it('warns when two bundle schemas are wired together', () => {
    const graph = new Graph();
    expect(graph.checkDataTypeCompatibility(
      { dataType: 'bundle', options: { schema: 'signals' } },
      { dataType: 'bundle', options: { schema: 'format' } },
    )).toMatch(/Schema mismatch/);
    expect(graph.checkDataTypeCompatibility(
      { dataType: 'bundle', options: {} },
      { dataType: 'bundle', options: { schema: 'format' } },
    )).toBeNull();
  });
});

// ---------------------------------------------------------------- Python

describe('bundles over the Python stage bridge', () => {
  const roots: string[] = [];
  afterAll(() => { for (const root of roots) fs.rmSync(root, { recursive: true, force: true }); });

  it('arrives as a dict, with images as references', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-bundle-stage-'));
    roots.push(root);
    fs.writeFileSync(path.join(root, 'stages.py'), [
      'import json, sys',
      'payload = json.load(sys.stdin)',
      'fmt = payload["format"]',
      'print(json.dumps({"type": type(fmt).__name__, "dpi": fmt["dpi"], "preview": fmt["preview"]["path"], "keys": sorted(fmt)}))',
    ].join('\n'));
    fs.writeFileSync(path.join(root, 'cascade.json'), JSON.stringify({ exec: { stages: { entrypoint: 'stages.py' } } }));
    const bundle = {
      size_mm: [382, 256],
      dpi: 300,
      preview: { path: '.cascade-cache/preview.png', size: [64, 32], channels: 'rgba', depth: 'u8', space: 'srgb' },
    };
    await expect(runProjectStage(new ProjectRoot(root), 'inspect', { format: bundle })).resolves.toEqual({
      type: 'dict',
      dpi: 300,
      preview: '.cascade-cache/preview.png',
      keys: ['dpi', 'preview', 'size_mm'],
    });
  });
});
