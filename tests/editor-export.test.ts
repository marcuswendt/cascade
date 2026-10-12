import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CascadeDocument, DefinitionNodeRegistration } from '../packages/runtime/src/index';
import { createRuntime } from '../packages/runtime/src/runtime';
import { createNodeRuntimeHost } from '../packages/runtime/src/node';
import {
  applyScene,
  createScene,
  editorGraphVersion,
  resolveScene,
  sceneFile,
  selectEditorSubgraph,
  validateEditor,
} from '../packages/runtime/src/editor/index';
import { exportEditor, prepareExport, publicVerdict, scanForLeaks } from '@/cli/editorExport';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function graph(): CascadeDocument {
  return {
    version: '0.2',
    nodes: [
      { id: 'source', module: 'project.Source' },
      { id: 'group', module: 'cascade.core.Subnet' },
      { id: 'inner', module: 'project.Shape', parent: 'group', props: { radius: 3, colour: '#111111' } },
      { id: 'out', module: 'project.Render', props: { dpi: 300 } },
      { id: 'unused', module: 'project.Shape' },
    ],
    connections: [
      [['source', 0, 'value'], ['inner', 0, 'label']],
      [['inner', 0, 'shape'], ['out', 0, 'shape']],
    ],
    editor: {
      id: 'shapes',
      parameters: [
        { id: 'radius', node: 'inner', prop: 'radius', control: 'slider', min: 0, max: 10 },
        { id: 'colour', node: 'inner', prop: 'colour', control: 'color' },
        { id: 'mode', node: 'out', prop: 'mode', control: 'select', options: ['a', { value: 'b', label: 'B' }] },
        { id: 'font', node: 'inner', prop: 'font', control: 'file', embed: 'never' },
        { id: 'image', node: 'inner', prop: 'image', control: 'file' },
      ],
      outputs: [{ id: 'png', node: 'out', port: 'image', format: 'png', view: true }],
    },
  } as unknown as CascadeDocument;
}

describe('editor subgraph and version', () => {
  it('ships what the outputs need, with subnet ancestors, and nothing else', () => {
    expect([...selectEditorSubgraph(graph())].sort()).toEqual(['group', 'inner', 'out', 'source']);
  });

  it('stops at a frozen source', () => {
    const document = graph();
    const frozen = { ...document, nodes: [{ id: 'upstream', module: 'project.Live' }, ...document.nodes],
      connections: [...(document.connections ?? []), [['upstream', 0, 'x'], ['source', 0, 'y']]],
      editor: { ...document.editor!, freeze: [{ node: 'source', output: 'value', snapshot: 'frozen/source.json' }] } } as CascadeDocument;
    expect(selectEditorSubgraph(frozen).has('upstream')).toBe(false);
    expect(selectEditorSubgraph(frozen).has('source')).toBe(true);
  });

  it('keeps the version across value edits and changes it on rewiring', () => {
    const base = editorGraphVersion(graph());
    const tuned = applyScene(graph(), createScene(graph(), { values: { radius: 9 } })).document;
    expect(editorGraphVersion(tuned)).toBe(base);
    const rewired = { ...graph(), connections: [graph().connections![1]] } as CascadeDocument;
    expect(editorGraphVersion(rewired)).not.toBe(base);
  });

  it('reports declarations that point nowhere', () => {
    const document = graph();
    const broken = { ...document, editor: { ...document.editor!, outputs: [{ id: 'x', node: 'missing', port: 'p', format: 'png' }] } } as CascadeDocument;
    expect(validateEditor(broken).map((item) => item.code)).toContain('editor/output-node');
  });
});

describe('scenes', () => {
  it('round-trips published values only', () => {
    const scene = createScene(graph(), { name: 'Derya', values: { radius: 7, mode: 'b' } });
    expect(scene.graph.id).toBe('shapes');
    expect(scene.values).toEqual({ radius: 7, colour: '#111111', mode: 'b' });
    const applied = applyScene(graph(), JSON.parse(JSON.stringify(scene)));
    expect(applied.warnings).toEqual([]);
    const inner = applied.document.nodes.find((node) => node.id === 'inner')!;
    expect(inner.props).toMatchObject({ radius: 7, colour: '#111111' });
    expect(createScene(applied.document).values).toEqual(scene.values);
  });

  it('degrades on a version mismatch: unknown ignored, wrong kinds skipped, missing keep defaults', () => {
    const resolved = resolveScene(graph(), {
      format: 'cascade.scene', version: 1, graph: { id: 'shapes', version: 'hold' },
      values: { radius: 'big', mode: 'z', gone: 1, colour: '#ff0000' },
    });
    expect(resolved.values).toEqual({ colour: '#ff0000' });
    expect(resolved.warnings.join('\n')).toMatch(/another version/);
    expect(resolved.warnings.join('\n')).toMatch(/Unknown parameter "gone"/);
    expect(resolved.warnings.join('\n')).toMatch(/expected a number/);
    expect(resolved.warnings.join('\n')).toMatch(/not one of its options/);
    const applied = applyScene(graph(), { format: 'cascade.scene', version: 1, graph: { id: 'shapes', version: '' }, values: {} });
    expect(applied.document.nodes.find((node) => node.id === 'inner')!.props).toMatchObject({ radius: 3 });
  });

  it('warns when the scene was made for another editor', () => {
    const resolved = resolveScene(graph(), { format: 'cascade.scene', version: 1, graph: { id: 'other', version: '' }, values: { radius: 2 } });
    expect(resolved.values).toEqual({ radius: 2 });
    expect(resolved.warnings[0]).toMatch(/made for "other"/);
  });

  it('never embeds a file the parameter marks embed: never, and embeds small others', async () => {
    const parameters = graph().editor!.parameters!;
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const font = await sceneFile(parameters.find((item) => item.id === 'font')!, bytes, 'Licensed.otf');
    const image = await sceneFile(parameters.find((item) => item.id === 'image')!, bytes, 'mine.png', 'image/png');
    expect(font.data).toBeUndefined();
    expect(font.sha256).toHaveLength(64);
    expect(image.data).toBe('AQIDBA==');
    const scene = createScene(graph(), { files: { font: { ...font, data: 'AQIDBA==' }, image } });
    expect(scene.files?.font.data).toBeUndefined();
    const applied = applyScene(graph(), scene, { resolveFile: (parameter) => (parameter.id === 'image' ? { path: 'assets/scenes/mine.png' } : undefined) });
    expect(applied.warnings.join('\n')).toMatch(/Licensed\.otf" is not available/);
    expect(applied.document.nodes.find((node) => node.id === 'inner')!.props).toMatchObject({ image: { path: 'assets/scenes/mine.png' } });
  });

  it('refuses things that are not scenes', () => {
    expect(() => resolveScene(graph(), { values: {} })).toThrow(/Not a Cascade scene/);
  });
});

describe('runtime reuse', () => {
  it('skips nodes whose inputs and props did not change', async () => {
    const counts: Record<string, number> = { a: 0, b: 0 };
    const registration = (id: 'a' | 'b'): DefinitionNodeRegistration => ({
      kind: 'definition-v1', moduleId: `project.${id}`,
      definition: { apiVersion: 1, runsOn: 'portable', inputs: { x: { kind: 'data', type: 'float', default: 0 } }, outputs: { y: { kind: 'data', type: 'float' } }, props: { k: { type: 'float', default: 1 } } },
      loadExecute: async () => (context: any) => { counts[id]++; context.outputs.y.set(context.inputs.x + context.props.k); },
    });
    const nodes = [registration('a'), registration('b')];
    const runtime = createRuntime({ host: createNodeRuntimeHost({ modules: { resolve: async (id) => nodes.find((item) => item.moduleId === id) ?? null } }), nodes });
    const loaded = await runtime.load({ nodes: [{ id: 'a', module: 'project.a' }, { id: 'b', module: 'project.b' }], connections: [[['a', 0, 'y'], ['b', 0, 'x']]] });
    await loaded.run({ reuse: true });
    await loaded.run({ reuse: true });
    expect(counts).toEqual({ a: 1, b: 1 });
    await loaded.setProp('b', 'k', 5);
    await loaded.run({ reuse: true });
    expect(counts).toEqual({ a: 1, b: 2 });
    expect(loaded.getOutput('b', 'y')).toBe(6);
    await loaded.run();
    expect(counts).toEqual({ a: 2, b: 3 });
    await runtime.dispose();
  });

  it('refreshes a subnet whose inside changed although its own inputs did not', async () => {
    const node: DefinitionNodeRegistration = {
      kind: 'definition-v1', moduleId: 'project.k',
      definition: { apiVersion: 1, runsOn: 'portable', outputs: { y: { kind: 'data', type: 'float' } }, props: { k: { type: 'float', default: 1 } } },
      loadExecute: async () => (context: any) => context.outputs.y.set(context.props.k),
    };
    const runtime = createRuntime({ host: createNodeRuntimeHost({ modules: { resolve: async (id) => (id === 'project.k' ? node : null) } }), nodes: [node] });
    const loaded = await runtime.load({
      nodes: [
        { id: 'group', module: 'cascade.core.Subnet' },
        { id: 'k', module: 'project.k', parent: 'group' },
        { id: 'out', module: 'cascade.core.Output', parent: 'group', props: { outputIndex: 0, outputName: 'value' } },
        { id: 'after', module: 'cascade.core.Null' },
      ],
      connections: [[['k', 0, 'y'], ['out', 0, 'input']], [['group', 0, 'output_0'], ['after', 0, 'input']]],
    });
    await loaded.run({ reuse: true });
    expect(loaded.getOutput('after', 'output')).toBe(1);
    await loaded.setProp('k', 'k', 4);
    await loaded.run({ reuse: true });
    expect(loaded.getOutput('after', 'output')).toBe(4);
    await runtime.dispose();
  });
});

function project(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-export-'));
  roots.push(root);
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
}

const shape = (extra = '') => `
export const definition = {
  apiVersion: 1, runsOn: 'portable'${extra},
  inputs: { label: { kind: 'data', type: 'string', default: '' } },
  outputs: { svg: { kind: 'data', type: 'string' } },
  props: { radius: { type: 'float', default: 2 } },
} as const;
export function execute(context) { context.outputs.svg.set('<svg/>'); }
`;

function exportGraph(extra: Partial<CascadeDocument> & { editor?: object } = {}) {
  return JSON.stringify({
    version: '0.2',
    nodes: [{ id: 'live', module: 'project.Live' }, { id: 'shape', module: 'project.Shape' }, { id: 'other', module: 'project.Shape' }],
    connections: [[['live', 0, 'svg'], ['shape', 0, 'label']]],
    annotations: [{ id: 'a', type: 'note', content: 'private' }],
    editor: { id: 'shape', parameters: [{ id: 'radius', node: 'shape', prop: 'radius' }], outputs: [{ id: 'svg', node: 'shape', port: 'svg', format: 'svg', view: true }], ...extra.editor },
  });
}

describe('cascade export boundary', () => {
  it('refuses a live source that is still wired in, naming it', async () => {
    const root = project({ 'nodes/Live/index.ts': shape(", source: 'live'"), 'nodes/Shape/index.ts': shape(), 'g.cascade': exportGraph() });
    await expect(prepareExport(path.join(root, 'g.cascade'))).rejects.toThrow(/Live data sources[\s\S]*live \(project.Live, live source\)/);
  });

  it('lists Python nodes as not exportable rather than dropping them', async () => {
    const python = shape().replace("runsOn: 'portable'", "runsOn: 'server', capabilities: ['python']");
    const root = project({ 'nodes/Live/index.ts': python, 'nodes/Shape/index.ts': shape(), 'g.cascade': exportGraph() });
    await expect(prepareExport(path.join(root, 'g.cascade'))).rejects.toThrow(/Not exportable[\s\S]*live \(project.Live: Python\/shell node\)/);
  });

  it('replaces a frozen source with its snapshot and ships only the subgraph', async () => {
    const snapshot = { format: 'cascade.frozen', version: 1, node: 'live', output: 'svg', fields: ['title', 'notes'], value: { title: 'x' }, frozenAt: '2026-10-11T00:00:00Z' };
    const root = project({
      'nodes/Live/index.ts': shape(", source: 'live'"), 'nodes/Shape/index.ts': shape(),
      'frozen/live.json': JSON.stringify(snapshot),
      'g.cascade': exportGraph({ editor: { freeze: [{ node: 'live', output: 'svg', snapshot: 'frozen/live.json' }] } }),
    });
    const prepared = await prepareExport(path.join(root, 'g.cascade'));
    expect(prepared.document.nodes.map((node) => [node.id, node.module])).toEqual([['live', 'cascade.core.Frozen'], ['shape', 'project.Shape']]);
    expect((prepared.document as { annotations?: unknown }).annotations).toBeUndefined();
    expect(prepared.plan.excluded).toEqual(['other']);
    expect(prepared.plan.personal).toEqual(['live: notes']);
    expect(prepared.document.connections).toEqual([[['live', 0, 'value'], ['shape', 0, 'label']]]);
    expect(editorGraphVersion(prepared.document)).toBe(prepared.plan.editor.graphVersion);
  });

  it('refuses licensed and hidden assets', async () => {
    for (const asset of ['assets/fonts/licensed/Helvetica.otf', '.env']) {
      const root = project({ 'nodes/Live/index.ts': shape(), 'nodes/Shape/index.ts': shape(), [asset]: 'x', 'g.cascade': exportGraph({ editor: { assets: [asset] } }) });
      await expect(prepareExport(path.join(root, 'g.cascade'))).rejects.toThrow(/licensed|visible project-relative/);
    }
  });

  it('ships declared OFL fonts and loads them in the page and the worker', async () => {
    // Cloud Volumes (08b9e53): the exported editor drew "DM Mono" with the
    // system monospace, because nothing shipped the project's font.
    const font = { family: 'DM Mono', file: 'assets/fonts/DMMono-Regular.woff2', license: 'OFL-1.1' };
    const root = project({ 'nodes/Live/index.ts': shape(), 'nodes/Shape/index.ts': shape(), [font.file]: 'woff2', 'g.cascade': exportGraph({ editor: { fonts: [font] } }) });
    const prepared = await prepareExport(path.join(root, 'g.cascade'));
    expect(prepared.plan.files.map((file) => file.path)).toContain('assets/assets/fonts/DMMono-Regular.woff2');
    const out = path.join(root, '..', `${path.basename(root)}-site`);
    roots.push(out);
    await exportEditor(path.join(root, 'g.cascade'), { out, log: () => {} });
    expect(fs.readFileSync(path.join(out, 'assets', 'assets', 'fonts', 'DMMono-Regular.woff2'), 'utf8')).toBe('woff2');
    expect(fs.readFileSync(path.join(out, 'index.html'), 'utf8')).toContain('@font-face{font-family:"DM Mono";src:url("./assets/assets/fonts/DMMono-Regular.woff2")');
    // A phone lays the page out at its width and never scales it; only the preview zooms.
    expect(fs.readFileSync(path.join(out, 'index.html'), 'utf8')).toContain('content="width=device-width,initial-scale=1,viewport-fit=cover,maximum-scale=1"');
    for (const bundle of ['editor.js', 'editor-worker.js']) expect(fs.readFileSync(path.join(out, bundle), 'utf8')).toContain('FontFace');
  }, 60_000);

  it('refuses a font that is not OFL or sits under licensed/', async () => {
    const cases = [
      { family: 'Helvetica Now', file: 'assets/fonts/HelveticaNow.otf', license: 'commercial' },
      { family: 'Helvetica Now', file: 'assets/fonts/licensed/HelveticaNow.otf', license: 'OFL-1.1' },
    ];
    for (const font of cases) {
      const root = project({ 'nodes/Live/index.ts': shape(), 'nodes/Shape/index.ts': shape(), [font.file]: 'x', 'g.cascade': exportGraph({ editor: { fonts: [font] } }) });
      await expect(prepareExport(path.join(root, 'g.cascade'))).rejects.toThrow(/only OFL-1.1|licensed/);
    }
  });

  it('treats a public deploy as a failure unless --public says it is intended', () => {
    expect(publicVerdict(401, false)).toBe('protected');
    expect(publicVerdict(200, false)).toBe('public-by-accident');
    expect(publicVerdict(200, true)).toBe('public-as-intended');
  });

  it('stops a site that would publish a local path or a secret value', async () => {
    const root = project({ 'site/a.js': 'const p="/Users/marcus/x"', '.env.local': 'TURSO_TOKEN=abcdefghijklmnop' });
    await expect(scanForLeaks(path.join(root, 'site'), root)).rejects.toThrow(/local path/);
    fs.writeFileSync(path.join(root, 'site', 'a.js'), 'const t="abcdefghijklmnop"');
    await expect(scanForLeaks(path.join(root, 'site'), root)).rejects.toThrow(/TURSO_TOKEN/);
    fs.writeFileSync(path.join(root, 'site', 'a.js'), 'const ok=1');
    await expect(scanForLeaks(path.join(root, 'site'), root)).resolves.toBeUndefined();
  });
});

describe('Studio keeps the editor section', () => {
  it('round-trips editor through Graph.fromJSON and toJSON', async () => {
    const { Graph } = await import('@/nodes/Graph');
    const editor = { id: 'kept', parameters: [{ id: 'a', node: 'n', prop: 'p' }], outputs: [] };
    const graph = Graph.fromJSON({ version: '0.2', nodes: [], editor });
    expect(graph.toJSON().editor).toEqual(editor);
  });
});

describe('Studio scenes', () => {
  it('finds a licensed font by name and hash, and stores embedded files as assets', async () => {
    const { applySceneInStudio, sceneFromStudio } = await import('@/editor/studioScenes');
    const font = new Uint8Array([9, 9, 9]);
    const files: Record<string, Uint8Array> = { 'assets/fonts/licensed/Helvetica.otf': font, 'assets/fonts/Inter.otf': new Uint8Array([1]) };
    const uploads: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (url === '/api/assets') { uploads.push('x'); return new Response(JSON.stringify({ path: './assets/images/mine.png' })); }
      const path = decodeURIComponent(url.replace(/^\/api\/media\//, '').replace(/\?raw=1$/, ''));
      return files[path] ? new Response(files[path]) : new Response('missing', { status: 404 });
    }) as typeof fetch;
    try {
      const document = graph();
      const withFont = { ...document, nodes: document.nodes.map((node) => node.id === 'inner' ? { ...node, props: { ...node.props, font: { path: 'assets/fonts/Inter.otf' } } } : node) } as CascadeDocument;
      const parameters = withFont.editor!.parameters!;
      const fontFile = await sceneFile(parameters.find((item) => item.id === 'font')!, font, 'Helvetica.otf');
      const imageFile = await sceneFile(parameters.find((item) => item.id === 'image')!, new Uint8Array([7]), 'mine.png', 'image/png');
      const scene = createScene(withFont, { values: { radius: 5 }, files: { font: fontFile, image: imageFile } });
      const { document: applied, warnings } = await applySceneInStudio(withFont, scene);
      expect(warnings).toEqual([]);
      expect(uploads).toHaveLength(1);
      expect(applied.nodes.find((node) => node.id === 'inner')!.props).toMatchObject({
        radius: 5, font: { path: 'assets/fonts/licensed/Helvetica.otf' }, image: { path: 'assets/images/mine.png' },
      });
      const saved = await sceneFromStudio(applied, 'back');
      expect(saved.files?.font.sha256).toBe(fontFile.sha256);
      expect(saved.files?.font.data).toBeUndefined();
      expect(saved.values.radius).toBe(5);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('editor engine', () => {
  it('cooks, reuses, writes and reads assets behind the async interface', async () => {
    const { LocalEngine } = await import('@/player/editorEngine');
    let cooks = 0;
    const node: DefinitionNodeRegistration = {
      kind: 'definition-v1', moduleId: 'project.Text',
      definition: { apiVersion: 1, runsOn: 'portable', outputs: { svg: { kind: 'data', type: 'string' } }, props: { r: { type: 'float', default: 1 } } },
      loadExecute: async () => (context: any) => { cooks++; context.outputs.svg.set(`<svg r="${context.props.r}"/>`); },
    };
    const engine = await LocalEngine.create({ document: { nodes: [{ id: 't', module: 'project.Text' }] }, registrations: [node], assets: {} });
    expect((await engine.nodes())[0].props.r).toEqual({ type: 'float', value: 1 });
    await engine.run({ reuse: true });
    await engine.run({ reuse: true });
    expect(cooks).toBe(1);
    await engine.setProps([['t', 'r', 4]]);
    expect(await engine.run({ reuse: true })).toEqual({ status: 'completed', messages: [] });
    expect(await engine.output('t', 'svg')).toBe('<svg r="4"/>');
    expect((await engine.outputs()).get('t')?.get('svg')).toBe('<svg r="4"/>');
    const ref = await engine.writeAsset(new Uint8Array([1, 2]), { suggestedName: 'a.bin' });
    expect([...(await engine.readAsset(ref))]).toEqual([1, 2]);
    await engine.dispose();
  });
});

describe('publishing from the Inspector', () => {
  it('creates the section, toggles, picks a free id and edits fields', async () => {
    const { togglePublished, updatePublished, findPublished, publishedGroups } = await import('@/editor/publishedParameters');
    let editor = togglePublished(undefined, 'Cloud Type.cascade', 'spec', 'seed', { label: 'Seed', min: 0, max: 99 });
    expect(editor.id).toBe('cloud-type');
    expect(findPublished(editor, 'spec', 'seed')).toMatchObject({ id: 'seed', label: 'Seed', min: 0, max: 99, order: 1 });
    editor = togglePublished(editor, 'x', 'other', 'seed');
    expect(findPublished(editor, 'other', 'seed')?.id).toBe('other.seed');
    editor = updatePublished(editor, 'spec', 'seed', { group: ' Input ', max: Number.NaN, step: 1, label: '' });
    expect(findPublished(editor, 'spec', 'seed')).toEqual({ id: 'seed', node: 'spec', prop: 'seed', min: 0, step: 1, order: 1, group: 'Input' });
    expect(publishedGroups(editor)).toEqual(['Input']);
    editor = togglePublished(editor, 'x', 'spec', 'seed');
    expect(findPublished(editor, 'spec', 'seed')).toBeUndefined();
    expect(editor.id).toBe('cloud-type');
  });
});
