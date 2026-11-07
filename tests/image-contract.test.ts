/**
 * `cascade/image`: one node body, the same pixels in the CLI and in an
 * exported editor's engine.
 *
 * The browser half runs here with the headless canvas standing in for the
 * worker's globals, so what is pinned is the contract — which capability the
 * bytes travel through, where they land, what a refusal says — and that the
 * same compiled module produces identical PNG bytes behind both hosts'
 * `assets`. The real-browser check is the exported editor itself
 * (doc/PROJECT_AUTHORING.md, "Draw an image in any host").
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  canvasAvailable,
  createCanvas,
  decodeImage,
  encodeImage,
  installImageHost,
  readImage,
  registerFont,
  surface,
  writeImage,
} from '../server/src/runtime/image';
import { installHeadlessCanvas } from '../src/cli/headlessCanvas';
import { runDeterministicProjectGraph } from '../src/cli/projectRuntime';
import { prepareExport } from '../src/cli/editorExport';
import { runEditorCommand } from '../src/cli/editorCommands';

const dispose: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (dispose.length) await dispose.pop()!();
  vi.unstubAllGlobals();
});

async function headless() {
  const host = await installHeadlessCanvas();
  dispose.push(() => host.dispose());
  return host;
}

/** An in-memory `assets` capability, the shape both hosts implement. */
function memoryAssets() {
  const files = new Map<string, Uint8Array>();
  let sequence = 0;
  return {
    files,
    async read(ref: { path: string }) {
      const bytes = files.get(ref.path);
      if (!bytes) throw new Error(`no ${ref.path}`);
      return bytes;
    },
    async write(data: Uint8Array, metadata: { mediaType?: string; suggestedName?: string }) {
      const stored = `generated/${++sequence}-${metadata.suggestedName}`;
      files.set(stored, data);
      return { path: stored, ...(metadata.mediaType ? { mediaType: metadata.mediaType } : {}) };
    },
  };
}

describe('cascade/image in the headless host', () => {
  it('draws, writes through assets, and reads the same pixels back', async () => {
    await headless();
    expect(canvasAvailable()).toBe(true);
    const assets = memoryAssets();
    const context = { capabilities: { assets }, signal: undefined };
    const { canvas, context: g } = surface(5.4, 3);
    expect([canvas.width, canvas.height]).toEqual([5, 3]);
    g.fillStyle = '#ff8000';
    g.fillRect(0, 0, 5, 3);
    const ref = await writeImage(context, canvas, 'swatch.png');
    expect(ref).toEqual({ path: 'generated/1-swatch.png', size: [5, 3], channels: 'rgba', depth: 'u8', space: 'srgb' });
    expect([...assets.files.get(ref.path)!.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]); // PNG

    const image = await readImage(context, ref);
    expect([image.width, image.height]).toEqual([5, 3]);
    const back = surface(5, 3);
    back.context.drawImage(image, 0, 0);
    expect([...back.context.getImageData(2, 1, 1, 1).data]).toEqual([255, 128, 0, 255]);
  });

  it('round-trips encode and decode without the assets capability', async () => {
    await headless();
    const canvas = createCanvas(2, 2);
    canvas.getContext('2d')!.fillRect(0, 0, 1, 1);
    const decoded = await decodeImage(await encodeImage(canvas));
    expect([decoded.width, decoded.height]).toEqual([2, 2]);
  });

  it('registers a font with Skia once per family and bytes', async () => {
    await headless();
    const register = vi.fn();
    const restore = installImageHost({ renderer: 'test-skia', registerFont: register });
    const bytes = new Uint8Array(fs.readFileSync(path.resolve('node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.ttf')));
    await registerFont('Test Icons', bytes);
    await registerFont('Test Icons', bytes);
    expect(register).toHaveBeenCalledOnce();
    expect(register).toHaveBeenCalledWith('Test Icons', bytes, {});
    restore();

    // And the real door the CLI installs reaches Skia's registry.
    const { GlobalFonts } = await import('@napi-rs/canvas');
    await registerFont('Cascade Test Codicon', bytes.slice());
    expect(GlobalFonts.has('Cascade Test Codicon')).toBe(true);
  });

  it('refuses rather than drawing nothing', async () => {
    await headless();
    const canvas = createCanvas(1, 1);
    await expect(writeImage({ capabilities: {} }, canvas, 'x.png')).rejects.toThrow("must declare capabilities: ['assets']");
    await expect(readImage({ capabilities: { assets: memoryAssets() } }, '')).rejects.toThrow('no image to read');
    await expect(registerFont('', new Uint8Array([1]))).rejects.toThrow('needs a family name');
  });
});

describe('cascade/image in a browser realm', () => {
  it('adds a FontFace to the realm font set, once', async () => {
    dispose.push(installImageHost(null));
    const added: unknown[] = [];
    const created: string[] = [];
    vi.stubGlobal('fonts', { add: (face: unknown) => added.push(face) });
    vi.stubGlobal('FontFace', class {
      constructor(readonly family: string, readonly source: ArrayBuffer) { created.push(family); }
      async load() { return this; }
    });
    await registerFont('Reenie', new Uint8Array([1, 2, 3]), { weight: '400' });
    await registerFont('Reenie', new Uint8Array([1, 2, 3]), { weight: '400' });
    await registerFont('Reenie', new Uint8Array([1, 2, 4]), { weight: '400' });
    expect(created).toEqual(['Reenie', 'Reenie']);
    expect(added).toHaveLength(2);
  });

  it('says what is missing when the realm has no canvas', () => {
    vi.stubGlobal('OffscreenCanvas', undefined);
    expect(canvasAvailable()).toBe(false);
    expect(() => createCanvas(1, 1)).toThrow('this host has no canvas');
  });
});

const PORTABLE_NODE = `
import type { NodeDefinition, NodeExecutionContext } from 'cascade/contracts';
import { readImage, surface, writeImage } from 'cascade/image';

export const definition = {
  apiVersion: 1,
  label: 'Tint',
  runsOn: 'portable',
  capabilities: ['assets'],
  inputs: {},
  outputs: { image: { kind: 'data', type: 'image' } },
  props: {
    source: { type: 'string', default: 'assets/in.png' },
    tint: { type: 'string', default: '#3060c0' },
  },
} as const satisfies NodeDefinition;

export async function execute(context: NodeExecutionContext<typeof definition>) {
  const source = await readImage(context, context.props.source);
  const { canvas, context: g } = surface(source.width * 2, source.height * 2);
  g.drawImage(source, 0, 0, canvas.width, canvas.height);
  g.globalCompositeOperation = 'multiply';
  const gradient = g.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, context.props.tint);
  gradient.addColorStop(1, '#ffffff');
  g.fillStyle = gradient;
  g.fillRect(0, 0, canvas.width, canvas.height);
  context.outputs.image.set(await writeImage(context, canvas, context.nodeId + '.png'));
}
`;

function tempProject(files: Record<string, string | Uint8Array>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-image-'));
  dispose.push(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, data] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), data);
  }
  return root;
}

describe('one node body, two hosts', () => {
  it('cooks the same bytes under cascade run and in the editor engine, and exports', async () => {
    await headless();
    const input = createCanvas(8, 6);
    const ig = input.getContext('2d')!;
    ig.fillStyle = '#20a060'; ig.fillRect(0, 0, 8, 6);
    ig.fillStyle = '#f0e0c0'; ig.beginPath(); ig.arc(4, 3, 2.5, 0, Math.PI * 2); ig.fill();
    const png = await encodeImage(input);
    const document = {
      version: '0.2',
      nodes: [{ id: 'tint', module: 'project.Tint' }],
      connections: [],
      editor: {
        id: 'tint',
        parameters: [{ id: 'tint', node: 'tint', prop: 'tint', control: 'color' }],
        outputs: [{ id: 'png', node: 'tint', port: 'image', format: 'png', view: true }],
        assets: ['assets/in.png'],
      },
    };
    const root = tempProject({ 'nodes/Tint/index.ts': PORTABLE_NODE, 'assets/in.png': png, 'g.cascade': JSON.stringify(document) });
    const file = path.join(root, 'g.cascade');

    // The CLI host: Skia globals, project assets confined to .cascade-cache/.
    let cli: { path: string; size: number[] } | undefined;
    await runDeterministicProjectGraph(file, document, undefined, undefined, async (graph) => {
      cli = graph.getOutput('tint', 'image') as typeof cli;
    });
    expect(cli!.path).toMatch(/^\.cascade-cache\/tint\.[0-9a-f]{12}\.png$/);
    expect(cli!.size).toEqual([16, 12]);
    const cliBytes = new Uint8Array(fs.readFileSync(path.join(root, cli!.path)));

    // The editor engine: the player's asset store, the same compiled module.
    const { LocalEngine } = await import('@/player/editorEngine');
    const compiled = await import(`${pathToFileURL(path.join(root, '.cascade-cache', 'nodes', 'Tint.mjs')).href}?engine`);
    const prepared = await prepareExport(file);
    const engine = await LocalEngine.create({
      document: prepared.document,
      registrations: [{ kind: 'definition-v1', moduleId: 'project.Tint', definition: prepared.modules[0]!.definition, loadExecute: async () => compiled.execute }],
      assets: { 'assets/in.png': `data:image/png;base64,${Buffer.from(png).toString('base64')}` },
    });
    dispose.push(() => engine.dispose());
    expect(await engine.run()).toEqual({ status: 'completed', messages: [] });
    const browser = await engine.output('tint', 'image') as { path: string; size: number[] };
    expect(browser.path).toMatch(/^\.cascade-player\/generated\/\d+-tint\.png$/);
    expect(browser.size).toEqual([16, 12]);
    // The same pixels, not the same bytes: the CLI writes an intermediate as a
    // fast level-1 PNG, the editor engine with the canvas's own encoder.
    const pixelsOf = async (bytes: Uint8Array) => {
      const image = await decodeImage(bytes);
      const { canvas, context: g } = surface(image.width, image.height);
      g.drawImage(image, 0, 0);
      return Buffer.from(g.getImageData(0, 0, canvas.width, canvas.height).data);
    };
    expect((await pixelsOf(await engine.readAsset(browser as never))).equals(await pixelsOf(cliBytes))).toBe(true);

    // And the export accepts it: portable, declared assets, the input shipped.
    expect(prepared.plan.files.map((item) => item.path)).toContain('assets/assets/in.png');
  }, 60_000);
});

describe('freezing an image output', () => {
  it('ships the file an image ref names when its path is a frozen field', async () => {
    await headless();
    const input = createCanvas(4, 4);
    input.getContext('2d')!.fillRect(0, 0, 4, 4);
    const document = {
      version: '0.2',
      nodes: [{ id: 'tint', module: 'project.Tint' }],
      connections: [],
      editor: { id: 'tint', parameters: [], outputs: [{ id: 'png', node: 'tint', port: 'image', format: 'png', view: true }] },
    };
    const root = tempProject({ 'nodes/Tint/index.ts': PORTABLE_NODE, 'assets/in.png': await encodeImage(input), 'g.cascade': JSON.stringify(document) });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    dispose.push(() => log.mockRestore());
    await runEditorCommand(['freeze', path.join(root, 'g.cascade'), 'tint', '--fields', 'path,size,channels,depth,space']);
    const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'frozen', 'tint.json'), 'utf8'));
    expect(snapshot.value.path).toMatch(/^frozen\/tint\/tint\.[0-9a-f]{12}\.png$/);
    expect(snapshot.files).toEqual([snapshot.value.path]);
    expect(snapshot.value.size).toEqual([8, 8]);
    expect(fs.existsSync(path.join(root, snapshot.value.path))).toBe(true);
  }, 60_000);
});
