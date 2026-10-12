/**
 * `cascade export`: a graph's declared editor as a static site.
 *
 * The boundary is the point. An export ships the subgraph the published
 * outputs and parameters need, the assets the author selected, and the editor
 * shell — nothing else from the project. Live data sources must be frozen into
 * reviewed snapshots or the export fails; licensed, hidden and gitignored files
 * are refused; and the finished site is scanned for credentials, local paths
 * and backend URLs before it is moved into place.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { build, type Plugin } from 'esbuild';
import ts from 'typescript';
import type {
  CascadeDocument,
  CascadeDocumentConnection,
  CascadeDocumentNode,
  EditorDeclaration,
  EditorFont,
  FrozenSnapshot,
  NodeDefinition,
} from '../../packages/contracts/src/index.js';
import { createRuntime, PREFLIGHT_WARNING_CODES } from '../../packages/runtime/src/runtime.js';
import { createBrowserRuntimeHost } from '../../packages/runtime/src/browser.js';
import { builtinNodeRegistration } from '../../packages/runtime/src/builtins/index.js';
import { extractNodeDefinition } from '../../packages/runtime/src/definition/extract.js';
import { validateNodeModuleArchitecture } from '../../packages/runtime/src/definition/architecture.js';
import {
  connectionEnds,
  editorGraphVersion,
  requireEditor,
  selectEditorSubgraph,
  validateEditor,
} from '../../packages/runtime/src/editor/index.js';
import type { DefinitionNodeRegistration, RuntimeCapabilities } from '../../packages/runtime/src/types.js';
import { ProjectRoot } from '../../server/src/project.js';
import { moduleId, projectModuleFile } from './projectRuntime.js';
import { canonicalFuturePath, exists, inside, playerFile, staticRuntimePlugin } from './webBuild.js';

const run = promisify(execFile);

export interface EditorExportOptions {
  readonly out?: string;
  /** Print the manifest and stop: nothing is compiled or written. */
  readonly plan?: boolean;
  readonly deploy?: 'vercel';
  /** Vercel project name to deploy to; defaults to the editor id. */
  readonly project?: string;
  /** Vercel team. */
  readonly scope?: string;
  /**
   * The site is meant to be public. Without it a deploy that anyone can read
   * fails, because the default is that a shared editor sits behind Vercel
   * Authentication; with it, public is the expected result and is reported.
   */
  readonly public?: boolean;
  readonly log?: (line: string) => void;
}

export interface PlanFile {
  /** Path inside the exported site. */
  readonly path: string;
  readonly size: number;
  /** Where it came from: a project-relative path, `cascade` or `generated`. */
  readonly from: string;
  readonly kind: 'asset' | 'frozen' | 'code' | 'page' | 'manifest' | 'config';
}

export interface PlanNode {
  readonly id: string;
  readonly module: string;
  readonly kind: 'builtin' | 'project' | 'frozen';
  /** Prop names whose values ship inside the site. */
  readonly props: readonly string[];
}

export interface ExportPlan {
  readonly format: 'cascade.export-plan';
  readonly version: 1;
  readonly editor: Readonly<{ id: string; title?: string; graphVersion: string }>;
  readonly graph: string;
  readonly nodes: readonly PlanNode[];
  /** Nodes in the graph that do not ship. */
  readonly excluded: readonly string[];
  readonly parameters: readonly string[];
  readonly outputs: readonly string[];
  readonly frozen: readonly Readonly<{ node: string; snapshot: string; fields: readonly Readonly<{ field: string; personal: boolean }>[] }>[];
  readonly files: readonly PlanFile[];
  /** Everything flagged as personal. Review these before sharing. */
  readonly personal: readonly string[];
  readonly warnings: readonly string[];
}

interface Prepared {
  readonly plan: ExportPlan;
  readonly project: ProjectRoot;
  readonly document: CascadeDocument;
  readonly modules: readonly { id: string; file: string; definition: NodeDefinition }[];
  readonly assets: readonly { name: string; file: string }[];
  readonly panel?: string;
}

const PERSONAL = /(note|transcript|calendar|diary|journal|whoop|weight|sleep|hrv|heart|health|body|location|gps|email|phone|address|observation|caption|person|people)/i;
const COORDINATE = /^(lat|lon|lng|latitude|longitude)$/i;
const LIVE_CAPABILITIES = new Set(['files', 'python', 'shell']);

/** Plan, and unless `plan` is set, build (and deploy) the editor site. */
export async function exportEditor(file: string, options: EditorExportOptions = {}): Promise<{ plan: ExportPlan; directory?: string; url?: string }> {
  const log = options.log ?? ((line: string) => console.log(line));
  const prepared = await prepareExport(file);
  if (options.plan) return { plan: prepared.plan };
  if (!options.out) throw new Error('cascade export requires --out <directory> (or --plan to review without building)');
  const directory = await buildSite(prepared, options.out);
  const plan = JSON.parse(await fs.readFile(path.join(directory, 'export-manifest.json'), 'utf8')) as ExportPlan;
  let url: string | undefined;
  if (options.deploy === 'vercel') url = await deployVercel(directory, options.project ?? prepared.plan.editor.id, options.scope, log, options.public === true);
  return { plan, directory, ...(url ? { url } : {}) };
}

export async function prepareExport(file: string): Promise<Prepared> {
  const graphFile = path.resolve(file);
  const project = new ProjectRoot(path.dirname(graphFile));
  const source = JSON.parse(await fs.readFile(graphFile, 'utf8')) as CascadeDocument;
  if (!Array.isArray(source.nodes)) throw new Error('Graph document must contain a nodes array');
  const editor = requireEditor(source);
  const problems = validateEditor(source).filter((item) => item.severity === 'error').map((item) => item.message);
  const warnings = validateEditor(source).filter((item) => item.severity === 'warning').map((item) => item.message);
  if (problems.length) throw new Error(`The editor declaration has errors:\n${problems.map((line) => `  ${line}`).join('\n')}`);

  const selected = selectEditorSubgraph(source);
  const frozenNodes = new Map((editor.freeze ?? []).map((item) => [item.node, item]));
  const nodes = source.nodes.filter((node) => selected.has(node.id));

  // Classify every shipped node before compiling anything, so one run names every problem.
  const modules: { id: string; file: string; definition: NodeDefinition }[] = [];
  const definitions = new Map<string, NodeDefinition>();
  const notExportable: string[] = [];
  const live: string[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    if (frozenNodes.has(node.id)) continue;
    const id = moduleId(node as never);
    const builtin = builtinNodeRegistration(id);
    if (builtin) { definitions.set(node.id, builtin.definition); continue; }
    const resolved = await projectModuleFile(project.root, node as never, id);
    if (!resolved.file) { notExportable.push(`${node.id} (${id}: no project module found)`); continue; }
    const sourceFile = project.resolve(path.relative(project.root, resolved.file));
    const code = await fs.readFile(sourceFile, 'utf8');
    const extracted = extractNodeDefinition(code, sourceFile, ts);
    if (!extracted.ok) { notExportable.push(`${node.id} (${id}: not a definition-v1 module)`); continue; }
    const definition = extracted.definition;
    definitions.set(node.id, definition);
    const capabilities = (definition.capabilities ?? []) as readonly string[];
    if (capabilities.includes('python') || capabilities.includes('shell')) {
      notExportable.push(`${node.id} (${id}: Python/shell node)`);
      continue;
    }
    if (definition.runsOn === 'server' || definition.source === 'live' || capabilities.some((name) => LIVE_CAPABILITIES.has(name))) {
      live.push(`${node.id} (${id}${definition.source === 'live' ? ', live source' : definition.runsOn === 'server' ? ', server node' : ', reads files'})`);
      continue;
    }
    const architecture = validateNodeModuleArchitecture(code, sourceFile, ts);
    if (architecture.length) { notExportable.push(...architecture.map((item) => `${node.id} (${id}: ${item.code}: ${item.message})`)); continue; }
    if (!seen.has(id)) { seen.add(id); modules.push({ id, file: sourceFile, definition }); }
  }
  const refusals: string[] = [];
  if (notExportable.length) refusals.push(`Not exportable (only browser-runnable nodes ship; port these to TypeScript or freeze their output):\n${notExportable.map((line) => `  ${line}`).join('\n')}`);
  if (live.length) refusals.push(`Live data sources are still wired in; freeze them with \`cascade freeze\` or take them out of the published path:\n${live.map((line) => `  ${line}`).join('\n')}`);
  if (refusals.length) throw new Error(refusals.join('\n'));

  // Frozen sources: the reviewed snapshot replaces the node, and its files ship.
  const assets = new Map<string, { name: string; file: string; kind: 'asset' | 'frozen'; from: string }>();
  const frozenPlan: { node: string; snapshot: string; fields: { field: string; personal: boolean }[] }[] = [];
  const personal: string[] = [];
  const replacements = new Map<string, CascadeDocumentNode>();
  for (const frozen of editor.freeze ?? []) {
    if (!selected.has(frozen.node)) continue;
    const snapshotPath = checkedAssetPath(frozen.snapshot, `snapshot for ${frozen.node}`);
    const snapshot = JSON.parse(await fs.readFile(project.resolve(snapshotPath), 'utf8')) as FrozenSnapshot;
    if (snapshot.format !== 'cascade.frozen' || snapshot.version !== 1)
      throw new Error(`${frozen.snapshot} is not a cascade freeze snapshot`);
    const fields = snapshot.fields.map((field) => {
      const flagged = (snapshot.personal ?? []).includes(field) || field.split(/[.[\]]/).some((part) => PERSONAL.test(part) || COORDINATE.test(part));
      if (flagged) personal.push(`${frozen.node}: ${field}`);
      return { field, personal: flagged };
    });
    frozenPlan.push({ node: frozen.node, snapshot: snapshotPath, fields });
    for (const name of snapshot.files ?? []) await addAsset(project, assets, checkedAssetPath(name, `file of snapshot ${frozen.node}`), 'frozen', snapshotPath);
    const original = source.nodes.find((node) => node.id === frozen.node)!;
    replacements.set(frozen.node, {
      id: original.id,
      module: 'cascade.core.Frozen',
      ...(original.parent ? { parent: original.parent } : {}),
      props: { value: snapshot.value },
    } as CascadeDocumentNode);
  }

  // The shipped document: selected nodes stripped to what the runtime reads, no annotations, no metadata beyond a name.
  const shippedNodes = nodes.map((node) => replacements.get(node.id) ?? stripNode(node));
  const connections: CascadeDocumentConnection[] = [];
  for (const connection of source.connections ?? []) {
    const ends = connectionEnds(connection);
    if (!selected.has(ends.source) || !selected.has(ends.target) || frozenNodes.has(ends.target)) continue;
    if (!frozenNodes.has(ends.source)) { connections.push(connection); continue; }
    connections.push([[ends.source, 0, 'value'], Array.isArray(connection)
      ? (connection as readonly [unknown, readonly [string, number, string?]])[1]
      : [ends.target, 0, ends.targetPort]] as CascadeDocumentConnection);
  }
  const shippedEditor: EditorDeclaration = {
    id: editor.id,
    ...(editor.title ? { title: editor.title } : {}),
    ...(editor.description ? { description: editor.description } : {}),
    ...(editor.groups ? { groups: editor.groups } : {}),
    parameters: editor.parameters ?? [],
    outputs: editor.outputs ?? [],
    ...(editor.presets ? { presets: editor.presets } : {}),
    ...(editor.freeze ? { freeze: editor.freeze.filter((item) => selected.has(item.node)).map((item) => ({ node: item.node, output: item.output, snapshot: '' })) } : {}),
    ...(editor.panel ? { panel: { module: '', ...(editor.panel.placement ? { placement: editor.panel.placement } : {}) } } : {}),
    ...(editor.inspect === false ? { inspect: false } : {}),
    ...(editor.peek ? { peek: editor.peek } : {}),
    ...(editor.draft ? { draft: editor.draft } : {}),
    ...(editor.fonts?.length ? { fonts: editor.fonts } : {}),
  };
  const document: CascadeDocument = {
    version: source.version,
    ...(typeof (source as unknown as { metadata?: { name?: unknown } }).metadata?.name === 'string'
      ? { metadata: { name: (source as unknown as { metadata: { name: string } }).metadata.name } } : {}),
    nodes: shippedNodes,
    connections,
    editor: shippedEditor,
  } as CascadeDocument;
  const graphVersion = editorGraphVersion(document);
  if (graphVersion !== editorGraphVersion(source))
    throw new Error('Internal: the exported graph version differs from the source graph version');

  // Literal asset values in shipped props, plus the author's selection.
  for (const asset of editor.assets ?? []) await addAsset(project, assets, checkedAssetPath(asset, 'editor.assets'), 'asset', 'editor.assets');
  for (const font of editor.fonts ?? []) await addAsset(project, assets, checkedFont(font), 'asset', 'editor.fonts');
  for (const literal of await literalAssets(document, modules)) await addAsset(project, assets, checkedAssetPath(literal.path, literal.where), 'asset', literal.where);
  for (const asset of assets.values()) await refuseIgnored(project.root, asset.name);

  const planNodes: PlanNode[] = shippedNodes.map((node) => ({
    id: node.id,
    module: String(node.module ?? node.type ?? ''),
    kind: replacements.has(node.id) ? 'frozen' : builtinNodeRegistration(moduleId(node as never)) ? 'builtin' : 'project',
    props: Object.keys((node.props ?? {}) as Record<string, unknown>),
  }));
  const files: PlanFile[] = [];
  for (const asset of assets.values())
    files.push({ path: `assets/${asset.name}`, size: (await fs.stat(asset.file)).size, from: asset.from === 'editor.assets' ? asset.name : `${asset.name} (${asset.from})`, kind: asset.kind });
  const panel = editor.panel?.module ? project.resolve(checkedAssetPath(editor.panel.module, 'editor.panel.module')) : undefined;
  const plan: ExportPlan = {
    format: 'cascade.export-plan',
    version: 1,
    editor: { id: editor.id, ...(editor.title ? { title: editor.title } : {}), graphVersion },
    graph: path.basename(graphFile),
    nodes: planNodes,
    excluded: source.nodes.filter((node) => !selected.has(node.id)).map((node) => node.id),
    parameters: (editor.parameters ?? []).map((item) => `${item.id} → ${item.node}.${item.prop}`),
    outputs: (editor.outputs ?? []).map((item) => `${item.id} → ${item.node}.${item.port} (${item.format})`),
    frozen: frozenPlan,
    files,
    personal,
    warnings,
  };
  return { plan, project, document, modules, assets: [...assets.values()].map(({ name, file }) => ({ name, file })), ...(panel ? { panel } : {}) };
}

/** Human-readable manifest for the terminal. */
export function formatPlan(plan: ExportPlan): string {
  const lines: string[] = [];
  lines.push(`Editor ${plan.editor.title ?? plan.editor.id} (${plan.editor.id}, ${plan.editor.graphVersion}) from ${plan.graph}`);
  lines.push('', `Nodes shipped (${plan.nodes.length}):`);
  for (const node of plan.nodes) lines.push(`  ${node.id}  ${node.module}${node.kind === 'frozen' ? '  [frozen snapshot]' : ''}${node.props.length ? `  props: ${node.props.join(', ')}` : ''}`);
  lines.push('', `Not shipped (${plan.excluded.length}): ${plan.excluded.join(', ') || 'none'}`);
  lines.push('', `Published parameters (${plan.parameters.length}):`, ...plan.parameters.map((line) => `  ${line}`));
  lines.push('', 'Outputs:', ...plan.outputs.map((line) => `  ${line}`));
  if (plan.frozen.length) {
    lines.push('', 'Frozen sources:');
    for (const frozen of plan.frozen) {
      lines.push(`  ${frozen.node} from ${frozen.snapshot}`);
      for (const field of frozen.fields) lines.push(`    ${field.field}${field.personal ? '   PERSONAL' : ''}`);
    }
  }
  lines.push('', 'Files:');
  for (const file of plan.files) lines.push(`  ${file.path}  ${formatSize(file.size)}  ${file.kind}  from ${file.from}`);
  if (plan.personal.length) lines.push('', 'PERSONAL — check before sharing:', ...plan.personal.map((line) => `  ${line}`));
  if (plan.warnings.length) lines.push('', 'Warnings:', ...plan.warnings.map((line) => `  ${line}`));
  return lines.join('\n');
}

async function buildSite(prepared: Prepared, outOption: string): Promise<string> {
  const { project, document, modules, assets, panel } = prepared;
  const out = path.resolve(process.cwd(), outOption);
  const canonicalOut = await canonicalFuturePath(out);
  for (const sourceDirectory of ['assets', 'nodes', 'lib']) {
    const sourceRoot = await canonicalFuturePath(path.join(project.root, sourceDirectory));
    if (inside(sourceRoot, canonicalOut)) throw new Error(`Export output cannot be inside the project's ${sourceDirectory} directory`);
  }
  if (inside(canonicalOut, await fs.realpath(project.root))) throw new Error('Export output cannot contain the project');
  // Replace a previous export, never anything else.
  if (await exists(out)) {
    if (!(await exists(path.join(out, 'export-manifest.json'))))
      throw new Error(`${out} exists and is not a previous export. Choose a new directory.`);
  }

  const plugins: Plugin[] = [await staticRuntimePlugin(project.root), sveltePlugin(project.root)];
  const editorEntry = await playerFile('editor');
  const imports = modules.map((item, index) => `import { execute as execute${index} } from ${JSON.stringify(item.file)};`).join('\n');
  const registrations = modules.map((item, index) => `{ kind:'definition-v1', moduleId:${JSON.stringify(item.id)}, definition:${JSON.stringify(item.definition)}, loadExecute:async()=>execute${index} }`).join(',');
  const assetSource = assets.map((item) => `${JSON.stringify(item.name)}:new URL(${JSON.stringify(`./assets/${item.name.split('/').map(encodeURIComponent).join('/')}`)},import.meta.url).href`).join(',');
  const panelImport = panel ? `import * as panel from ${JSON.stringify(panel)};` : '';
  // Two bundles: the page (editor shell, panel) and the engine worker (runtime
  // and the project's nodes), so a slow stage never blocks the page.
  const engineEntry = await playerFile('editorEngine');
  const fonts = fontSources(document.editor?.fonts ?? []);
  const entry = `import { startEditor } from ${JSON.stringify(editorEntry)};\n${panelImport}\n${fonts.loader}\nwindow.cascadeEditorReady = startEditor({document:${JSON.stringify(document)},worker:new URL('./editor-worker.js',import.meta.url),assets:{${assetSource}}${panel ? ',panel' : ''}});`;
  const workerEntry = `import { serveEditorEngine } from ${JSON.stringify(engineEntry)};\n${imports}\n${fonts.loader}\nserveEditorEngine([${registrations}]);`;
  const bundle = (contents: string, sourcefile: string) => build({
    bundle: true, platform: 'browser', format: 'esm', target: 'es2022', write: false, minify: true,
    legalComments: 'none', logLevel: 'silent', plugins,
    stdin: { contents, resolveDir: project.root, sourcefile },
  });
  const [result, workerResult] = await Promise.all([bundle(entry, 'editor-entry.js'), bundle(workerEntry, 'editor-worker-entry.js')]);

  await fs.mkdir(path.dirname(out), { recursive: true });
  const staging = await fs.mkdtemp(path.join(path.dirname(out), '.cascade-export-'));
  try {
    const title = escapeHtml(document.editor?.title ?? document.editor?.id ?? 'Cascade');
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,maximum-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><link rel="icon" href="data:,"><title>${title}</title><style>${fonts.css}html,body{margin:0;height:100%;background:#f4f4f2}@media (prefers-color-scheme:dark){html,body{background:#151515}}</style></head><body><script type="module" src="./editor.js"></script></body></html>`;
    const files: PlanFile[] = [];
    const write = async (name: string, data: string | Uint8Array, kind: PlanFile['kind'], from: string) => {
      await fs.mkdir(path.dirname(path.join(staging, name)), { recursive: true });
      await fs.writeFile(path.join(staging, name), data);
      files.push({ path: name, size: typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength, from, kind });
    };
    await write('index.html', html, 'page', 'generated');
    await write('editor.js', result.outputFiles![0].contents, 'code', 'cascade editor shell');
    await write('editor-worker.js', workerResult.outputFiles![0].contents, 'code', 'cascade runtime + project nodes');
    for (const asset of assets) {
      const target = path.join(staging, 'assets', asset.name);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(asset.file, target);
    }
    await write('vercel.json', `${JSON.stringify(vercelConfig(), null, 2)}\n`, 'config', 'generated');
    const plan: ExportPlan = { ...prepared.plan, files: [...files, ...prepared.plan.files] };
    await fs.writeFile(path.join(staging, 'export-manifest.json'), `${JSON.stringify(plan, null, 2)}\n`);
    await scanForLeaks(staging, project.root);
    await fs.rm(out, { recursive: true, force: true });
    await fs.rename(staging, out);
    await fs.chmod(out, 0o755);
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true });
    throw error;
  }
  return out;
}

/** Static hosting settings: no build step, no external connections, not indexed. */
function vercelConfig() {
  return {
    $schema: 'https://openapi.vercel.sh/vercel.json',
    framework: null,
    buildCommand: '',
    installCommand: '',
    outputDirectory: '.',
    headers: [{
      source: '/(.*)',
      headers: [
        { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self' blob: data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
      ],
    }],
  };
}

const LEAK_PATTERNS: readonly (readonly [string, RegExp])[] = [
  ['libSQL/Turso URL', /libsql:\/\/|\.turso\.io/i],
  ['local path', /\/Users\/[A-Za-z]|\/home\/[a-z][a-z0-9_-]*\/|[A-Z]:\\\\Users\\\\|file:\/\//],
  ['home-relative path', /["'`\s(]~\/[A-Za-z._-]/],
  ['Observatory endpoint', /observatory\.field\.io|observatory-api|\/api\/observatory/i],
  ['bearer token', /Bearer\s+[A-Za-z0-9._~+/-]{16,}/],
  ['API key', /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|\bghp_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bxox[abprs]-[A-Za-z0-9-]{10,}|\bAKIA[0-9A-Z]{16}\b|\bAIza[0-9A-Za-z_-]{30,}/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['env file reference', /(?:^|[^A-Za-z0-9_])\.env(?:\.local|\.production|\.development)?["'`]/],
];

/** Fail on anything that looks like a credential, a local path or a backend. */
export async function scanForLeaks(directory: string, projectRoot: string): Promise<void> {
  const secrets = await secretValues(projectRoot);
  const findings: string[] = [];
  for (const file of await filesUnder(directory)) {
    const name = path.relative(directory, file);
    if (/(^|\/)\.env/.test(name) || /(^|\/)\.vercel\//.test(name)) { findings.push(`${name}: environment or link file in the site`); continue; }
    if (/(^|\/)licensed\//.test(name)) { findings.push(`${name}: licensed file in the site`); continue; }
    if (!/\.(js|mjs|html|json|svg|txt|css|md|map|xml)$/i.test(name)) continue;
    const text = await fs.readFile(file, 'utf8');
    for (const [label, pattern] of LEAK_PATTERNS) {
      const match = pattern.exec(text);
      if (match) findings.push(`${name}: ${label} near "${excerpt(text, match.index)}"`);
    }
    for (const [key, value] of secrets) if (text.includes(value)) findings.push(`${name}: the value of ${key}`);
  }
  if (findings.length) throw new Error(`The export was stopped: it would publish sensitive content.\n${findings.map((line) => `  ${line}`).join('\n')}`);
}

/** Values of secret-looking variables in this process and the project's .env files. */
async function secretValues(projectRoot: string): Promise<[string, string][]> {
  const secret = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|AUTH|CREDENTIAL|DATABASE_URL|DB_URL|_URL|_DSN)$/i;
  const values = new Map<string, string>();
  for (const [key, value] of Object.entries(process.env)) if (value && value.length >= 12 && secret.test(key)) values.set(key, value);
  for (const entry of await fs.readdir(projectRoot).catch(() => [] as string[])) {
    if (!entry.startsWith('.env')) continue;
    const text = await fs.readFile(path.join(projectRoot, entry), 'utf8').catch(() => '');
    for (const line of text.split('\n')) {
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*["']?([^"'\n]*)["']?\s*$/.exec(line);
      if (match && match[2].length >= 8) values.set(`${match[1]} (${entry})`, match[2]);
    }
  }
  values.set('your home directory', os.homedir());
  return [...values];
}

async function deployVercel(directory: string, projectName: string, scope: string | undefined, log: (line: string) => void, intendedPublic: boolean): Promise<string> {
  const team = scope ?? 'field-io';
  // Link in a scratch directory: `vercel link` also pulls env into .env.local,
  // which must never land in the site being deployed.
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'cascade-vercel-'));
  try {
    await run('vercel', ['link', '--yes', '--project', projectName, '--scope', team], { cwd: scratch });
    const link = await fs.readFile(path.join(scratch, '.vercel', 'project.json'), 'utf8');
    await fs.mkdir(path.join(directory, '.vercel'), { recursive: true });
    await fs.writeFile(path.join(directory, '.vercel', 'project.json'), link);
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
  log(`Deploying ${directory} to Vercel project ${team}/${projectName}…`);
  const { stdout } = await run('vercel', ['deploy', '--prod', '--yes', '--scope', team], { cwd: directory, maxBuffer: 16 * 1024 * 1024 });
  const url = stdout.trim().split('\n').reverse().find((line) => /^https:\/\//.test(line.trim()))?.trim();
  if (!url) throw new Error(`Vercel did not report a deployment URL:\n${stdout}`);
  // Vercel Authentication must be on, unless public was asked for: an
  // anonymous request must not get the page by accident.
  const response = await fetch(`https://${projectName}.vercel.app/`, { redirect: 'manual' });
  const verdict = publicVerdict(response.status, intendedPublic);
  if (verdict === 'public-as-intended') log(`Public, as intended (--public): https://${projectName}.vercel.app`);
  else if (verdict === 'public-by-accident')
    throw new Error(`Deployed, but https://${projectName}.vercel.app is publicly readable. Turn on Vercel Authentication (Settings → Deployment Protection) for ${team}/${projectName}.`);
  return url;
}

/** What an anonymous request's status means for a deploy. */
export function publicVerdict(status: number, intendedPublic: boolean): 'protected' | 'public-as-intended' | 'public-by-accident' {
  if (status !== 200) return 'protected';
  return intendedPublic ? 'public-as-intended' : 'public-by-accident';
}

/** Svelte panels compile with the project's own svelte, so core never depends on it. */
function sveltePlugin(projectRoot: string): Plugin {
  return {
    name: 'cascade-editor-svelte',
    setup(builder) {
      builder.onLoad({ filter: /\.svelte$/ }, async (args) => {
        let compiler: { compile(source: string, options: object): { js: { code: string } } };
        try {
          compiler = createRequire(path.join(projectRoot, 'package.json'))('svelte/compiler');
        } catch {
          return { errors: [{ text: `${args.path}: install svelte in the project to use a Svelte panel` }] };
        }
        const source = await fs.readFile(args.path, 'utf8');
        const output = compiler.compile(source, { filename: args.path, generate: 'client', css: 'injected' });
        return { contents: output.js.code, loader: 'js', resolveDir: path.dirname(args.path) };
      });
    },
  };
}

async function literalAssets(document: CascadeDocument, modules: readonly { id: string; definition: NodeDefinition }[]): Promise<{ path: string; where: string }[]> {
  const registrations: DefinitionNodeRegistration[] = modules.map((item) => ({
    kind: 'definition-v1', moduleId: item.id, definition: item.definition,
    loadExecute: async () => { throw new Error('Exports never execute project code'); },
  }));
  const runtime = createRuntime({ host: createBrowserRuntimeHost({
    modules: { resolve: async (id) => registrations.find((item) => item.moduleId === id) ?? null },
    assets: {} as NonNullable<RuntimeCapabilities['assets']>,
    gpu: {} as NonNullable<RuntimeCapabilities['gpu']>,
  }), nodes: registrations });
  const found: { path: string; where: string }[] = [];
  try {
    const graph = await runtime.load(document);
    const blocking = graph.preflight().filter((item) => !PREFLIGHT_WARNING_CODES.has(item.code));
    if (blocking.length) throw new Error(`This graph cannot run in the browser:\n${blocking.map((item) => `  ${item.path ?? ''} ${item.code}: ${item.message}`).join('\n')}`);
    for (const node of graph.inspect().nodes)
      for (const [name, port] of [...Object.entries(node.inputs), ...Object.entries(node.props)]) {
        if (port.type !== 'image' && port.type !== 'asset') continue;
        const value = port.value as unknown;
        const asset = typeof value === 'string' ? value : value && typeof value === 'object' && 'path' in value ? (value as { path: unknown }).path : undefined;
        if (typeof asset === 'string' && asset && !/^(https?:|data:|blob:)/.test(asset)) found.push({ path: asset, where: `${node.id}.${name}` });
      }
  } finally {
    await runtime.dispose();
  }
  return found;
}

const FONT_FILE = /\.(woff2?|ttf|otf)$/i;

/** An `editor.fonts` entry: open-licensed, a font file, and a visible project path. */
function checkedFont(font: EditorFont): string {
  const where = `editor.fonts ${JSON.stringify(font?.family ?? '')}`;
  if (!font || typeof font.family !== 'string' || !font.family.trim()) throw new Error(`${where}: needs a family name`);
  if (font.license !== 'OFL-1.1')
    throw new Error(`${where}: only OFL-1.1 fonts are exported (got ${JSON.stringify(font.license)}); a licensed font never leaves the project`);
  if (typeof font.file !== 'string' || !FONT_FILE.test(font.file)) throw new Error(`${where}: file must be a .woff2, .woff, .ttf or .otf`);
  return checkedAssetPath(font.file, where);
}

/** `@font-face` rules for the page, and the same fonts loaded into the engine worker's scope. */
function fontSources(fonts: readonly EditorFont[]): { css: string; loader: string } {
  const url = (file: string) => `./assets/${file.replace(/^\.\//, '').split('/').map(encodeURIComponent).join('/')}`;
  const css = fonts.map((font) => `@font-face{font-family:${JSON.stringify(font.family)};src:url(${JSON.stringify(url(font.file))});font-weight:${font.weight ?? 'normal'};font-style:${font.style ?? 'normal'};font-display:swap}`).join('');
  const list = JSON.stringify(fonts.map((font) => ({ family: font.family, url: url(font.file), weight: String(font.weight ?? 'normal'), style: font.style ?? 'normal' })));
  // Canvas text in a worker sees only fonts added to the worker's own scope,
  // and canvas text in the page draws the fallback until a face is loaded, so
  // both load them explicitly before the first cook.
  const loader = fonts.length
    ? `await (async()=>{const s=globalThis;if(typeof FontFace==='undefined'||!s.fonts)return;await Promise.all(${list}.map(async(f)=>{try{const face=new FontFace(f.family,'url('+new URL(f.url,import.meta.url).href+')',{weight:f.weight,style:f.style});s.fonts.add(await face.load())}catch(e){console.warn('Font '+f.family+' did not load',e)}}))})();`
    : '';
  return { css, loader };
}

function checkedAssetPath(asset: string, where: string): string {
  const name = String(asset).replace(/^\.\//, '');
  if (!name || name.includes('\\') || path.isAbsolute(name) || name.split('/').some((part) => !part || part === '..' || part.startsWith('.')))
    throw new Error(`${where}: ${asset} must be a visible project-relative file`);
  if (name.split('/').includes('licensed'))
    throw new Error(`${where}: ${asset} is under a licensed/ directory and is never exported`);
  return name;
}

async function addAsset(project: ProjectRoot, assets: Map<string, { name: string; file: string; kind: 'asset' | 'frozen'; from: string }>, name: string, kind: 'asset' | 'frozen', from: string): Promise<void> {
  if (assets.has(name)) return;
  const file = project.resolve(name);
  const real = await fs.realpath(file);
  if (real.split(path.sep).includes('licensed')) throw new Error(`${name} resolves into a licensed/ directory and is never exported`);
  if (!(await fs.stat(real)).isFile()) throw new Error(`${name} is not a file`);
  assets.set(name, { name, file: real, kind, from });
}

async function refuseIgnored(root: string, name: string): Promise<void> {
  try {
    await run('git', ['check-ignore', '-q', '--', name], { cwd: root });
  } catch (error) {
    const code = (error as { code?: number | string }).code;
    if (code === 1 || code === 128 || code === 'ENOENT') return; // not ignored, or not a git repository
    throw error;
  }
  throw new Error(`${name} is gitignored, so it is not exported. Commit it, or select another file.`);
}

function stripNode(node: CascadeDocumentNode): CascadeDocumentNode {
  return {
    id: node.id,
    ...(node.module ? { module: node.module } : {}),
    ...(node.type ? { type: node.type } : {}),
    ...(node.parent ? { parent: node.parent } : {}),
    ...(node.inputs ? { inputs: node.inputs } : {}),
    ...(node.props ? { props: node.props } : {}),
  };
}

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(file) : [file];
  }));
  return nested.flat();
}

function excerpt(text: string, index: number): string {
  return text.slice(Math.max(0, index - 20), index + 40).replace(/\s+/g, ' ');
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!);
}

function formatSize(bytes: number): string {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`;
}
