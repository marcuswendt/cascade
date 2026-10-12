/**
 * The graph editing API, the CLI commands built on it, `--json`, and the MCP
 * server: behaviour, readability, and diff stability.
 *
 * Diff stability is the contract that matters most here. An agent's edit must
 * be the edit and nothing else, so every operation is tested against its
 * inverse: apply both and the file must be byte-identical to where it started.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GraphEditor, readGraph, type EditableDocument, type GraphEditOperation } from '../packages/runtime/src/edit/index.js';
import { builtinNodeRegistration } from '../packages/runtime/src/builtins/index.js';
import { GraphFile, serializeGraph } from '../src/cli/graphFile.js';
import { applyEdits, runGraphCommand } from '../src/cli/graphCommands.js';
import { captureEnvelope } from '../src/cli/jsonEnvelope.js';
import { matchLines } from '../src/cli/lineMerge.js';
import { createMcpContext, handle } from '../src/cli/mcp.js';

const STUDIO = { name: 'studio', asciiOnly: false, trailingNewline: true } as const;

/** A small downward-flowing graph: circle -> transform -> render <- camera. */
function fixture(): EditableDocument {
  return {
    version: '0.2',
    metadata: { name: 'Fixture' },
    nodes: [
      { id: 'circle', module: 'cascade.geo.Circle', position: [40, 40], source: 'stdlib' },
      { id: 'transform', module: 'cascade.geo.Transform', position: [40, 230], source: 'stdlib', inputs: [{ name: 'rotate', defaultValue: 0.25, dataType: 'float' }] },
      { id: 'camera', module: 'cascade.core.Camera', position: [300, 230], source: 'stdlib' },
      { id: 'render', module: 'cascade.geo.Render', position: [40, 420], source: 'stdlib', props: { strokeWidth: 2 } },
    ],
    connections: [
      [['circle', 0, 'geometry'], ['transform', 0, 'geometry']],
      [['transform', 0, 'geometry'], ['render', 0, 'scene']],
      [['camera', 0, 'camera'], ['render', 1, 'camera']],
    ],
  };
}

const definitionOf = (id: string) => builtinNodeRegistration(id)?.definition;
const editorFor = (document: EditableDocument) => new GraphEditor(document, { definitionOf });

let directory: string;
let file: string;

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cascade-edit-'));
  file = path.join(directory, 'index.cascade');
  await fs.writeFile(file, serializeGraph(fixture(), STUDIO));
});

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

async function edit(...operations: GraphEditOperation[]) {
  return applyEdits(file, operations, { json: true });
}

async function expectRoundTrip(forward: GraphEditOperation[], inverse: GraphEditOperation[]) {
  const before = await fs.readFile(file, 'utf8');
  const changed = await edit(...forward);
  expect(changed.changed).toBe(true);
  expect(await fs.readFile(file, 'utf8')).not.toBe(before);
  await edit(...inverse);
  expect(await fs.readFile(file, 'utf8')).toBe(before);
}

describe('diff stability: an edit then its inverse leaves the file byte-identical', () => {
  it('node add, node remove', async () => {
    await expectRoundTrip(
      [{ op: 'node.add', module: 'cascade.geo.Rectangle', id: 'frame', set: { size: [2, 1] } }],
      [{ op: 'node.remove', id: 'frame' }],
    );
  });

  it('connect, disconnect', async () => {
    await edit({ op: 'node.add', module: 'cascade.geo.Transform', id: 'shift' });
    await edit({ op: 'connect', from: 'circle.geometry', to: 'shift.geometry' });
    await expectRoundTrip(
      [{ op: 'connect', from: 'shift.geometry', to: 'transform.geometry' }],
      [{ op: 'connect', from: 'circle.geometry', to: 'transform.geometry' }],
    );
    await expectRoundTrip(
      [{ op: 'node.add', module: 'cascade.geo.Transform', id: 'twin', position: { x: 600, y: 600 } }, { op: 'connect', from: 'circle', to: 'twin.geometry', layout: false }],
      [{ op: 'disconnect', from: 'circle.geometry', to: 'twin.geometry' }, { op: 'node.remove', id: 'twin' }],
    );
  });

  it('set a value, then set it back', async () => {
    await expectRoundTrip(
      [{ op: 'set', target: 'render.strokeWidth', value: 5 }],
      [{ op: 'set', target: 'render.strokeWidth', value: 2 }],
    );
  });

  it('set a default parameter, then unset it', async () => {
    await expectRoundTrip(
      [{ op: 'set', target: 'render.opacity', value: 0.5 }, { op: 'set', target: 'circle.divisions', value: 12 }],
      [{ op: 'set', target: 'render.opacity', unset: true }, { op: 'set', target: 'circle.divisions', unset: true }],
    );
  });

  it('bind an expression, then clear it', async () => {
    await expectRoundTrip(
      [{ op: 'set', target: 'render.strokeWidth', expression: '1 + $T * 0.1' }],
      [{ op: 'set', target: 'render.strokeWidth', expression: null }],
    );
  });

  it('set keyframes, then remove them', async () => {
    await expectRoundTrip(
      [{ op: 'set', target: 'render.opacity', keys: [{ frame: 0, value: 0 }, { frame: 48, value: 1 }], interpolation: 'linear' }],
      [{ op: 'set', target: 'render.opacity', removeKeys: [0, 48] }],
    );
  });

  it('subnet create, subnet dissolve', async () => {
    await expectRoundTrip(
      [{ op: 'subnet.create', nodes: ['transform'], label: 'Shape' }],
      [{ op: 'subnet.dissolve', id: 'shape' }],
    );
  });

  it('subnet move in, subnet move out', async () => {
    await edit(
      { op: 'subnet.create', nodes: ['circle', 'transform'], id: 'shapes' },
      { op: 'node.add', module: 'cascade.geo.Rectangle', id: 'frame', position: { x: 600, y: 40 } },
      { op: 'node.add', module: 'cascade.geo.Transform', id: 'lift', position: { x: 600, y: 230 } },
      { op: 'connect', from: 'frame.geometry', to: 'lift.geometry', layout: false },
      { op: 'connect', from: 'lift.geometry', to: 'render.scene', layout: false },
    );
    await expectRoundTrip(
      [{ op: 'subnet.move', nodes: ['lift'], to: 'shapes' }],
      [{ op: 'subnet.move', nodes: ['lift'], to: 'root' }],
    );
  });

  it('subnet move keeps the graph equivalent even when ports are reused', async () => {
    await edit(
      { op: 'subnet.create', nodes: ['circle', 'transform'], id: 'shapes' },
      { op: 'node.add', module: 'cascade.geo.Transform', id: 'lift', position: { x: 600, y: 600 } },
      { op: 'connect', from: 'shapes.output_0', to: 'lift.geometry' },
      { op: 'connect', from: 'lift.geometry', to: 'render.scene' },
    );
    const flatten = async () => {
      // Follow each wire through subnet boundaries to the real producer.
      const document = JSON.parse(await fs.readFile(file, 'utf8'));
      const read = readGraph(document);
      return read.wires.filter((wire) => !/shapes|-out-|-in-/.test(wire)).sort();
    };
    const before = await flatten();
    await edit({ op: 'subnet.move', nodes: ['lift'], to: 'shapes' });
    const inside = readGraph(JSON.parse(await fs.readFile(file, 'utf8')), { in: 'shapes' }).wires;
    expect(inside).toContain('transform.geometry -> lift.geometry');
    await edit({ op: 'subnet.move', nodes: ['lift'], to: 'root' });
    expect(await flatten()).toEqual(before);
  });
});

describe('minimal diffs', () => {
  it('touches only the edited keys and writes new keys where Studio would', async () => {
    const before = await fs.readFile(file, 'utf8');
    await edit({ op: 'set', target: 'camera.aspect', value: 1.5 });
    const after = await fs.readFile(file, 'utf8');
    const match = matchLines(before.split('\n'), after.split('\n'))!;
    // The props block: three new lines and a comma on the line above it.
    expect(match.filter((index) => index === -1)).toHaveLength(4);
    const camera = (JSON.parse(after).nodes as Record<string, unknown>[]).find((node) => node.id === 'camera')!;
    expect(Object.keys(camera)).toEqual(['id', 'module', 'position', 'source', 'props']);
  });

  it('keeps the formatting of a file written by Python, including 1.0 and escaped non-ASCII', async () => {
    const python = JSON.stringify(fixture(), null, 2)
      .replace('"strokeWidth": 2', '"strokeWidth": 2.0')
      .replace('"Fixture"', '"Fixture \\u2014 Python"');
    await fs.writeFile(file, python);
    await edit({ op: 'set', target: 'camera.aspect', value: 1.5 });
    const after = await fs.readFile(file, 'utf8');
    expect(after).toContain('"strokeWidth": 2.0');
    expect(after).toContain('"Fixture \\u2014 Python"');
    await edit({ op: 'set', target: 'camera.aspect', unset: true });
    expect(await fs.readFile(file, 'utf8')).toBe(python);
  });

  it('uses the stable kebab-case id of the type, and numbers a second one', async () => {
    const first = await edit({ op: 'node.add', module: 'cascade.geo.CopyToPoints' });
    const second = await edit({ op: 'node.add', module: 'CopyToPoints' });
    expect((first.results[0]!.node as { id: string }).id).toBe('copy-to-points');
    expect((second.results[0]!.node as { id: string }).id).toBe('copy-to-points-2');
  });

  it('routes a wire across a subnet boundary through Output and Input nodes', async () => {
    await edit(
      { op: 'subnet.create', nodes: ['circle'], id: 'source' },
      { op: 'node.add', module: 'cascade.core.Subnet', id: 'sink' },
      { op: 'node.add', module: 'cascade.geo.Transform', id: 'inner', in: 'sink' },
    );
    await edit({ op: 'connect', from: 'circle.geometry', to: 'inner.geometry' });
    const read = readGraph(JSON.parse(await fs.readFile(file, 'utf8')));
    expect(read.wires).toEqual(expect.arrayContaining([
      'circle.geometry -> source-out-geometry.input',
      'source.output_0 -> sink.input_0',
      'sink-in-geometry.output -> inner.geometry',
    ]));
    // A second consumer of the same value reuses the ports.
    await edit({ op: 'node.add', module: 'cascade.geo.Transform', id: 'inner-2', in: 'sink' }, { op: 'connect', from: 'circle.geometry', to: 'inner-2.geometry' });
    const again = readGraph(JSON.parse(await fs.readFile(file, 'utf8')));
    expect(again.nodes.filter((node) => node.module === 'cascade.core.Input')).toHaveLength(1);
    expect(again.wires).toContain('sink-in-geometry.output -> inner-2.geometry');
  });

  it('names subnet boundaries after what they carry', async () => {
    const result = await edit({ op: 'subnet.create', nodes: ['circle', 'transform'], id: 'shapes' });
    expect(result.results[0]).toMatchObject({ outputs: ['shapes-out-geometry'], inputs: [] });
    const read = readGraph(JSON.parse(await fs.readFile(file, 'utf8')));
    expect(read.nodes.find((node) => node.id === 'shapes')!.ports).toEqual({ inputs: [], outputs: ['output_0 (geometry)'] });
    expect(read.wires).toContain('shapes.output_0 -> render.scene');
  });
});

describe('auto-layout for agent-created nodes', () => {
  it('places a node one step down the flow from what feeds it, beside anything already there', () => {
    const editor = editorFor(fixture());
    editor.addNode({ module: 'cascade.geo.Transform', id: 'more' });
    const { moved } = editor.connect('transform.geometry', 'more.geometry');
    // One step (190) below transform is render's spot, so it moves one column over.
    expect(moved!.position).toEqual({ x: 300, y: 420 });
  });

  it('lands a new consumer below its source, and a second one beside it rather than on top', () => {
    const editor = editorFor(fixture());
    editor.addNode({ module: 'cascade.geo.Transform', id: 'a' });
    editor.addNode({ module: 'cascade.geo.Transform', id: 'b' });
    const first = editor.connect('circle.geometry', 'a.geometry').moved!;
    const second = editor.connect('circle.geometry', 'b.geometry').moved!;
    expect(first.position.y).toBeGreaterThan(40);
    expect(second.position.y).toBe(first.position.y);
    expect(Math.abs(second.position.x - first.position.x)).toBeGreaterThanOrEqual(210);
  });

  it('follows a sideways flow when the graph runs left to right', () => {
    const document = fixture();
    document.nodes[0]!.position = [0, 0];
    document.nodes[1]!.position = [300, 0];
    document.nodes[3]!.position = [600, 0];
    document.nodes[2]!.position = [300, 200];
    const editor = editorFor(document);
    // Unwired, it waits in a lane beside the graph, clear of the flow...
    const added = editor.addNode({ module: 'cascade.geo.Transform', id: 'after' }).node;
    expect(added.position).toEqual({ x: 0, y: 390 });
    // ...and wired, it lands one step to the right of its source.
    const { moved } = editor.connect('transform.geometry', 'after.geometry');
    expect(moved!.position.x).toBe(600);
  });
});

describe('validation', () => {
  it('refuses a wire between incompatible ports', () => {
    expect(() => editorFor(fixture()).connect('camera.camera', 'transform.geometry')).toThrow(/cannot feed/);
  });

  it('names the real parameters when one is misspelt', () => {
    expect(() => editorFor(fixture()).setParameter('render.strokewidth', { value: 1 })).toThrow(/strokeWidth/);
  });

  it('reads command-line text by the declared type and rejects the wrong one', async () => {
    await edit({ op: 'set', target: 'render.size', value: '640,480', fromText: true });
    expect(JSON.parse(await fs.readFile(file, 'utf8')).nodes[3].props.size).toEqual([640, 480]);
    await expect(edit({ op: 'set', target: 'render.strokeWidth', value: 'wide', fromText: true })).rejects.toThrow(/expects a number/);
  });

  it('refuses an edit cascade check would reject, and leaves the file alone', async () => {
    const before = await fs.readFile(file, 'utf8');
    await expect(edit(
      { op: 'node.add', module: 'cascade.geo.Transform', id: 'loop' },
      { op: 'connect', from: 'transform.geometry', to: 'loop.geometry' },
      { op: 'connect', from: 'loop.geometry', to: 'transform.geometry' },
    )).rejects.toThrow(/cascade check[\s\S]*cycle/);
    expect(await fs.readFile(file, 'utf8')).toBe(before);
  });

  it('is all or nothing for a batch', async () => {
    const before = await fs.readFile(file, 'utf8');
    await expect(edit(
      { op: 'node.add', module: 'cascade.geo.Rectangle', id: 'ok' },
      { op: 'connect', from: 'ok.geometry', to: 'missing.geometry' },
    )).rejects.toThrow(/Operation 2/);
    expect(await fs.readFile(file, 'utf8')).toBe(before);
  });

  it('refuses to write over a file that changed on disk since it was read', async () => {
    const graph = await GraphFile.open(file);
    await graph.apply({ op: 'set', target: 'render.strokeWidth', value: 4 });
    await fs.appendFile(file, ' ');
    await expect(graph.save()).rejects.toThrow(/changed on disk/);
  });

  it('removes a subnet only when asked to remove what is in it', async () => {
    await edit({ op: 'subnet.create', nodes: ['circle'], id: 'source' });
    await expect(edit({ op: 'node.remove', id: 'source' })).rejects.toThrow(/--recursive/);
  });
});

describe('--json and the MCP server', () => {
  it('wraps a command in one envelope', async () => {
    const ok = await captureEnvelope(() => runGraphCommand(['set', file, 'render.strokeWidth', '3'], { json: true }));
    expect(ok).toMatchObject({ ok: true, data: { changed: true, results: [{ op: 'set', before: 2, after: 3 }] }, warnings: [] });
    const failed = await captureEnvelope(() => runGraphCommand(['set', file, 'render.nothing', '3'], { json: true }));
    expect(failed).toMatchObject({ ok: false, error: { message: expect.stringContaining('has no parameter "nothing"') } });
  });

  it('collects printed output as data when a command returns none', async () => {
    const envelope = await captureEnvelope(async () => {
      console.log('{"status":"completed","frames":[1]}');
      console.warn('slow stage');
    });
    expect(envelope).toEqual({ ok: true, data: { status: 'completed', frames: [1] }, warnings: ['slow stage'] });
  });

  it('serves the same operations as tools, with the same envelope', async () => {
    const context = createMcpContext(directory);
    const list = await handle({ method: 'tools/list' }, context, 'test') as { result: { tools: { name: string }[] } };
    expect(list.result.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'graph_read', 'graph_list', 'node_add', 'node_remove', 'connect', 'disconnect', 'set',
      'subnet_create', 'subnet_move', 'check', 'cook', 'render', 'export', 'lock', 'replay',
    ]));

    const call = async (name: string, args: Record<string, unknown>) => {
      const response = await handle({ method: 'tools/call', params: { name, arguments: args } }, context, 'test') as { result: { content: { text: string }[]; isError: boolean } };
      return { ...JSON.parse(response.result.content[0]!.text), isError: response.result.isError };
    };
    expect(await call('node_add', { graph: 'index.cascade', type: 'Rectangle', id: 'frame' })).toMatchObject({ ok: true, isError: false });
    expect(await call('connect', { graph: 'index.cascade', from: 'frame', to: 'transform.geometry' })).toMatchObject({
      ok: true, data: { results: [{ wire: 'frame.geometry -> transform.geometry', replaced: 'circle.geometry -> transform.geometry' }] },
    });
    expect(await call('graph_read', { graph: 'index.cascade' })).toMatchObject({ ok: true, data: { wires: expect.arrayContaining(['frame.geometry -> transform.geometry']) } });
    expect(await call('set', { graph: '../elsewhere.cascade', target: 'a.b', value: 1 })).toMatchObject({ ok: false, isError: true });
  });
});
