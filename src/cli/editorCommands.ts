/**
 * The editor-export commands: `export`, `freeze`, `publish`, `scene`, and the
 * `--scene`/`--write` form of `run`.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  CascadeDocument,
  EditorDeclaration,
  FrozenSnapshot,
  JsonValue,
  PublishedControl,
  PublishedParameter,
  SceneFile,
} from '../../packages/contracts/src/index.js';
import { applyScene, fromBase64, parseScene } from '../../packages/runtime/src/editor/index.js';
import { ProjectRoot } from '../../server/src/project.js';
import { exportEditor, formatPlan } from './editorExport.js';
import { installHeadlessCanvas } from './headlessCanvas.js';
import { installProjectIo } from './headlessIo.js';
import { cookProjectGraph } from './projectRuntime.js';

export const EDITOR_COMMANDS = ['export', 'freeze', 'publish', 'scene'] as const;

export const EDITOR_HELP = `
Shareable editors (see doc/EDITOR_EXPORT.md):
  cascade export <graph> --plan                 Print what would ship, build nothing
  cascade export <graph> --out <dir> [--deploy vercel [--project <name>] [--scope <team>]]
  cascade publish <graph> <node>.<prop> [--id <id>] [--label <text>] [--group <name>]
                  [--control <kind>] [--min n] [--max n] [--step n] [--help <text>] [--remove]
  cascade freeze <graph> <node> --fields <a,b.c> [--output <port>] [--personal <a,..>]
  cascade scene <graph> <scene.json> --out <new-graph.cascade>
  cascade run <graph> --scene <scene.json> [--write <node>.<port>=<file>]...
`;

export async function runEditorCommand(args: readonly string[]): Promise<void> {
  const [command, graph] = args;
  if (!graph || graph.startsWith('-')) throw new Error(`cascade ${command} requires a graph file`);
  const flags = parseFlags(args.slice(2));
  switch (command) {
    case 'export': return exportCommand(graph, flags);
    case 'publish': return publishCommand(graph, flags);
    case 'freeze': return freezeCommand(graph, flags);
    case 'scene': return sceneCommand(graph, flags);
    case 'run': return runWithScene(graph, flags);
    default: throw new Error(`Unknown command ${command}`);
  }
}

interface Flags {
  readonly positional: string[];
  readonly values: Map<string, string[]>;
  readonly switches: Set<string>;
}

const SWITCHES = new Set(['--plan', '--remove', '--json']);

function parseFlags(args: readonly string[]): Flags {
  const positional: string[] = [];
  const values = new Map<string, string[]>();
  const switches = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    if (SWITCHES.has(arg)) { switches.add(arg); continue; }
    const value = args[index + 1];
    if (value === undefined || (value.startsWith('--') && !/^--?\d/.test(value))) throw new Error(`${arg} needs a value`);
    values.set(arg, [...(values.get(arg) ?? []), value]);
    index++;
  }
  return { positional, values, switches };
}

const one = (flags: Flags, name: string) => { const list = flags.values.get(name); return list?.[list.length - 1]; };

async function exportCommand(graph: string, flags: Flags): Promise<void> {
  const deploy = one(flags, '--deploy');
  if (deploy && deploy !== 'vercel') throw new Error('--deploy supports vercel only');
  const result = await exportEditor(graph, {
    plan: flags.switches.has('--plan'),
    out: one(flags, '--out'),
    ...(deploy ? { deploy: 'vercel' as const } : {}),
    project: one(flags, '--project'),
    scope: one(flags, '--scope'),
  });
  if (flags.switches.has('--json')) console.log(JSON.stringify(result.plan, null, 2));
  else console.log(formatPlan(result.plan));
  if (result.directory) console.log(`\nEditor exported: ${result.directory}\nManifest: ${path.join(result.directory, 'export-manifest.json')}`);
  if (result.url) console.log(`Deployed: ${result.url}`);
}

async function readGraph(file: string): Promise<CascadeDocument> {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

/** Write a graph back with the editor section replaced and everything else untouched. */
async function writeEditor(file: string, document: CascadeDocument, editor: EditorDeclaration): Promise<void> {
  const next = { ...document, editor };
  await fs.writeFile(file, `${JSON.stringify(next, null, 2)}\n`);
}

async function publishCommand(graph: string, flags: Flags): Promise<void> {
  const target = flags.positional[0];
  const match = target ? /^([^.]+)\.(.+)$/.exec(target) : null;
  if (!match) throw new Error('cascade publish needs <node>.<prop>');
  const [, node, prop] = match;
  const document = await readGraph(graph);
  if (!document.nodes.some((item) => item.id === node)) throw new Error(`No node ${node} in ${graph}`);
  const editor: EditorDeclaration = document.editor ?? { id: path.basename(graph).replace(/\.cascade$/, '') };
  const parameters = [...(editor.parameters ?? [])];
  const id = one(flags, '--id') ?? prop;
  const existing = parameters.findIndex((item) => item.node === node && item.prop === prop);
  if (flags.switches.has('--remove')) {
    if (existing < 0) throw new Error(`${node}.${prop} is not published`);
    parameters.splice(existing, 1);
    await writeEditor(graph, document, { ...editor, parameters });
    console.log(`Unpublished ${node}.${prop}`);
    return;
  }
  const number = (name: string) => {
    const value = one(flags, name);
    if (value === undefined) return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number`);
    return parsed;
  };
  const previous = existing >= 0 ? parameters[existing] : undefined;
  const parameter: PublishedParameter = {
    ...previous,
    id: previous?.id ?? id,
    node,
    prop,
    ...(one(flags, '--label') ? { label: one(flags, '--label') } : {}),
    ...(one(flags, '--group') ? { group: one(flags, '--group') } : {}),
    ...(one(flags, '--control') ? { control: one(flags, '--control') as PublishedControl } : {}),
    ...(number('--min') !== undefined ? { min: number('--min') } : {}),
    ...(number('--max') !== undefined ? { max: number('--max') } : {}),
    ...(number('--step') !== undefined ? { step: number('--step') } : {}),
    ...(number('--order') !== undefined ? { order: number('--order') } : {}),
    ...(one(flags, '--help') ? { help: one(flags, '--help') } : {}),
    ...(one(flags, '--unit') ? { unit: one(flags, '--unit') } : {}),
  };
  if (existing >= 0) parameters[existing] = parameter;
  else {
    if (parameters.some((item) => item.id === parameter.id)) throw new Error(`Parameter id ${parameter.id} is taken; pass --id`);
    parameters.push(parameter);
  }
  await writeEditor(graph, document, { ...editor, parameters });
  console.log(`${existing >= 0 ? 'Updated' : 'Published'} ${node}.${prop} as "${parameter.id}"`);
}

/**
 * Cook a live source once and keep exactly the chosen fields. The snapshot and
 * any files its fields reference are written into `frozen/<node>/` for review
 * and commit; the export ships that, never the source.
 */
async function freezeCommand(graph: string, flags: Flags): Promise<void> {
  const node = flags.positional[0];
  if (!node) throw new Error('cascade freeze needs a node id');
  const fields = (one(flags, '--fields') ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  if (!fields.length) throw new Error('cascade freeze needs --fields: name exactly the values to keep');
  const personal = (one(flags, '--personal') ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  const document = await readGraph(graph);
  if (!document.nodes.some((item) => item.id === node)) throw new Error(`No node ${node} in ${graph}`);
  const graphFile = path.resolve(graph);
  const project = new ProjectRoot(path.dirname(graphFile));
  await installHeadlessCanvas().catch(() => undefined);
  const removeIo = installProjectIo(project);
  const { outputs } = await cookProjectGraph(graphFile, document, node).finally(removeIo);
  const produced = outputs.get(node);
  if (!produced) throw new Error(`${node} produced nothing`);
  const output = one(flags, '--output') ?? [...produced.keys()][0];
  if (!produced.has(output)) throw new Error(`${node} has no output ${output}; it has ${[...produced.keys()].join(', ')}`);
  const full = toJson(produced.get(output));
  const directory = path.join('frozen', node);
  await fs.mkdir(project.resolve(directory), { recursive: true });
  const files: string[] = [];
  const pick = async (value: JsonValue): Promise<JsonValue> => {
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { path?: unknown }).path === 'string') {
      const from = (value as { path: string }).path;
      const source = project.resolve(from.replace(/^\.\//, ''));
      const name = `${directory}/${path.basename(from)}`;
      await fs.copyFile(source, project.resolve(name));
      files.push(name);
      return { ...(value as Record<string, JsonValue>), path: name };
    }
    if (Array.isArray(value)) return Promise.all(value.map(pick));
    if (value && typeof value === 'object')
      return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await pick(item)])));
    return value;
  };
  const chosen: Record<string, JsonValue> = {};
  for (const field of fields) {
    const value = getPath(full, field);
    if (value === undefined) throw new Error(`${node}.${output} has no field ${field}`);
    setPath(chosen, field, await pick(value));
  }
  const snapshot: FrozenSnapshot = {
    format: 'cascade.frozen', version: 1, node, output, fields,
    ...(personal.length ? { personal } : {}),
    value: chosen, ...(files.length ? { files } : {}), frozenAt: new Date().toISOString(),
  };
  const snapshotFile = `${directory}.json`;
  await fs.writeFile(project.resolve(snapshotFile), `${JSON.stringify(snapshot, null, 2)}\n`);
  const editor: EditorDeclaration = document.editor ?? { id: path.basename(graph).replace(/\.cascade$/, '') };
  const freeze = (editor.freeze ?? []).filter((item) => item.node !== node);
  freeze.push({ node, output, snapshot: snapshotFile });
  await writeEditor(graph, document, { ...editor, freeze });
  console.log(`Froze ${node}.${output}: ${fields.join(', ')} → ${snapshotFile}${files.length ? ` (+${files.length} file${files.length > 1 ? 's' : ''})` : ''}`);
}

/** Apply a scene onto a copy of the graph, writing embedded files into the project. */
async function sceneCommand(graph: string, flags: Flags): Promise<void> {
  const sceneFile = flags.positional[0];
  const out = one(flags, '--out');
  if (!sceneFile || !out) throw new Error('cascade scene needs <scene.json> --out <new-graph.cascade>');
  if (path.resolve(out) === path.resolve(graph)) throw new Error('--out must be a new file; the source graph is never overwritten');
  const { document, warnings } = await sceneDocument(graph, sceneFile);
  await fs.writeFile(out, `${JSON.stringify(document, null, 2)}\n`);
  for (const warning of warnings) console.warn(`Warning: ${warning}`);
  console.log(`Scene applied: ${out}`);
}

/**
 * Resolve a scene against a graph. An embedded file is written to
 * `assets/scenes/<sha>-<name>`; a referenced one (a licensed font) is matched
 * by hash against files of the same name under `assets/`.
 */
export async function sceneDocument(graph: string, sceneFile: string): Promise<{ document: CascadeDocument; warnings: readonly string[] }> {
  const document = await readGraph(graph);
  const scene = parseScene(await fs.readFile(sceneFile, 'utf8'));
  const project = new ProjectRoot(path.dirname(path.resolve(graph)));
  const located = new Map<string, JsonValue>();
  for (const [id, file] of Object.entries(scene.files ?? {})) {
    const found = await locateSceneFile(project, file);
    if (found) located.set(id, { path: found, ...(file.mediaType ? { mediaType: file.mediaType } : {}) });
  }
  return applyScene(document, scene, { resolveFile: (parameter) => located.get(parameter.id) });
}

async function locateSceneFile(project: ProjectRoot, file: SceneFile): Promise<string | undefined> {
  const { createHash } = await import('node:crypto');
  const safe = path.basename(file.name).replace(/[^A-Za-z0-9._-]/g, '_');
  if (file.data) {
    const bytes = fromBase64(file.data);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== file.sha256) throw new Error(`Scene file ${file.name} does not match its hash`);
    const name = `assets/scenes/${digest.slice(0, 12)}-${safe}`;
    await fs.mkdir(path.dirname(project.resolve(name)), { recursive: true });
    await fs.writeFile(project.resolve(name), bytes);
    return name;
  }
  for (const candidate of await filesNamed(project.root, path.basename(file.name))) {
    const digest = createHash('sha256').update(await fs.readFile(candidate)).digest('hex');
    if (digest === file.sha256) return path.relative(project.root, candidate).split(path.sep).join('/');
  }
  return undefined;
}

async function filesNamed(root: string, name: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (directory: string, depth: number) => {
    if (depth > 6) return;
    for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(() => [])) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.cascade-cache') continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(file, depth + 1);
      else if (entry.name === name) found.push(file);
    }
  };
  await walk(path.join(root, 'assets'), 0);
  await walk(path.join(root, 'licensed'), 0);
  return found;
}

/** `cascade run <graph> --scene s.json --write node.port=file`: cook with a scene and keep chosen outputs. */
async function runWithScene(graph: string, flags: Flags): Promise<void> {
  const graphFile = path.resolve(graph);
  let document: CascadeDocument = await readGraph(graph);
  const scene = one(flags, '--scene');
  if (scene) {
    const applied = await sceneDocument(graph, scene);
    document = applied.document;
    for (const warning of applied.warnings) console.warn(`Warning: ${warning}`);
  }
  await installHeadlessCanvas().catch(() => undefined);
  const project = new ProjectRoot(path.dirname(graphFile));
  const removeIo = installProjectIo(project);
  const { outputs } = await cookProjectGraph(graphFile, document).finally(removeIo);
  for (const spec of flags.values.get('--write') ?? []) {
    const match = /^([^.=]+)\.([^=]+)=(.+)$/.exec(spec);
    if (!match) throw new Error(`--write expects <node>.<port>=<file>, got ${spec}`);
    const [, node, port, file] = match;
    const value = outputs.get(node)?.get(port);
    if (value === undefined) throw new Error(`${node}.${port} produced nothing`);
    if (typeof value === 'string') await fs.writeFile(file, value);
    else if (value && typeof value === 'object' && typeof (value as { path?: unknown }).path === 'string')
      await fs.copyFile(project.resolve((value as { path: string }).path.replace(/^\.\//, '')), file);
    else await fs.writeFile(file, JSON.stringify(toJson(value)));
    console.log(`Wrote ${node}.${port} → ${file}`);
  }
}

/** Plain JSON for a cooked value; typed arrays become arrays. */
function toJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value, (_key, item) => (ArrayBuffer.isView(item) ? Array.from(item as unknown as ArrayLike<number>) : item)) ?? 'null');
}

function getPath(value: JsonValue, field: string): JsonValue | undefined {
  let current: unknown = value;
  for (const part of field.split('.').flatMap((item) => item.split(/\[(\d+)\]/).filter(Boolean))) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current as JsonValue | undefined;
}

function setPath(target: Record<string, JsonValue>, field: string, value: JsonValue): void {
  const parts = field.split('.').flatMap((item) => item.split(/\[(\d+)\]/).filter(Boolean));
  let current: Record<string, JsonValue> | JsonValue[] = target;
  parts.forEach((part, index) => {
    const last = index === parts.length - 1;
    const container = current as Record<string, JsonValue>;
    if (last) { container[part] = value; return; }
    if (container[part] === undefined) container[part] = /^\d+$/.test(parts[index + 1]) ? [] : {};
    current = container[part] as Record<string, JsonValue>;
  });
}
