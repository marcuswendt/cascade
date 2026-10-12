/**
 * Locks: "this exact render, from this code, these parameters and this seed".
 *
 * A lock is a JSON file in the project's `locks/` folder, one per approval,
 * written by `cascade lock` and never edited afterwards. A change is a new lock
 * that names the one it supersedes. It records:
 *
 *  - the graph as cooked (stored whole in `.cascade/objects/`, by hash),
 *    the node that was rendered, and the scene if one was applied;
 *  - every parameter value and every seed, readable in the lock itself;
 *  - the content hash of every input file the graph names;
 *  - the project's source code, stored as a tree of objects, plus the hash of
 *    each node module and stage entrypoint the graph uses;
 *  - Cascade's and the project's versions and git state;
 *  - a fingerprint of every output the node produced, and a small preview.
 *
 * `replay` rebuilds the project's code from the store in a throwaway copy,
 * cooks the stored graph there, and compares fingerprints. No worktree, no
 * checkout: the commit is recorded for the reader, the code comes from the
 * lock. See doc/PRODUCTION_READINESS.md, Reproducibility.
 */
import { execFile } from 'node:child_process';
import fssync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { ProjectRoot } from '../../../server/src/project.js';
import { moduleId, projectModuleFile } from '../projectRuntime.js';
import { sceneDocument } from '../editorCommands.js';
import { cookNode } from './cook.js';
import {
  compareFingerprints, fingerprintOutputs,
  type OutputFingerprint, type PortDifference,
} from './fingerprint.js';
import {
  collectSources, diffTrees, hashSources, materialize, readTree, storeSources,
  type SourceTree, type TreeDiff,
} from './snapshot.js';
import { digest, digestFile, getObject, putObject, short, stableJson, type Digest } from './store.js';

const run = promisify(execFile);

export const LOCKS_DIR = 'locks';
/** Long side of the preview kept beside a lock: enough to recognise the piece. */
const PREVIEW_SIZE = 800;

export type LockStatus = 'approved' | 'approved-alternative' | 'pending' | 'superseded' | 'not-delivered';

export interface LockFile {
  readonly format: 'cascade.lock';
  readonly version: 1;
  readonly id: string;
  readonly name: string;
  readonly status: LockStatus | string;
  readonly note?: string;
  readonly supersedes?: string;
  readonly created: string;
  readonly graph: {
    /** Project-relative graph file the lock was made from. */
    readonly file: string;
    /** The node whose outputs are the render. */
    readonly node: string;
    /** The graph document as cooked, in the object store. */
    readonly object: Digest;
    readonly scene?: { readonly file: string; readonly object: Digest };
  };
  /** Every prop value, `node.prop`. Long values are recorded by hash. */
  readonly params: Record<string, unknown>;
  /** Published parameters by id, when the graph declares an editor. */
  readonly published?: Record<string, unknown>;
  /** Every prop named like a seed, `node.prop`. */
  readonly seeds: Record<string, unknown>;
  /** Project-relative input file to the hash of its content. */
  readonly inputs: Record<string, Digest>;
  readonly code: {
    /** The source tree object: every source file, by hash. */
    readonly tree: Digest;
    readonly files: number;
    /** Source-looking files too large to store; named so their absence is visible. */
    readonly skipped?: readonly string[];
    /** The module file of each node type the graph uses. */
    readonly modules: Record<string, Digest>;
    /** The Python stage entrypoint and worker from cascade.json, when declared. */
    readonly stages?: Record<string, Digest>;
  };
  readonly versions: {
    readonly cascade: VersionInfo;
    readonly project: VersionInfo;
    readonly node: string;
  };
  readonly host: {
    readonly kind: 'headless';
    readonly platform: string;
    /** `snapshot`: cooked from the stored code in a fresh copy. `live`: in the project, with its cache. */
    readonly cooked: 'snapshot' | 'live';
  };
  readonly output: {
    readonly ports: OutputFingerprint;
    readonly durationMs: number;
  };
  readonly preview?: { readonly file: string; readonly sha256: Digest };
}

export interface VersionInfo {
  readonly version?: string;
  readonly commit?: string;
  readonly dirty?: boolean;
}

/** Key order at the top of a lock file; everything else sorts alphabetically. */
const LOCK_KEY_ORDER = ['format', 'version', 'id', 'name', 'status', 'note', 'supersedes', 'created', 'graph'];

// ---------------------------------------------------------------- lock

export interface CreateLockOptions {
  readonly graph: string;
  readonly node: string;
  readonly name: string;
  readonly note?: string;
  readonly status?: string;
  readonly supersedes?: string;
  readonly scene?: string;
  /** Extra input files the graph reads without naming them in a prop. */
  readonly inputs?: readonly string[];
  /** Output ports to fingerprint. Default: all of them. */
  readonly ports?: readonly string[];
  /** An image to keep as the lock's preview (the one approved), instead of the render's own. */
  readonly preview?: string;
  /** Cook in the project itself, with its cache, instead of a fresh copy from the snapshot. */
  readonly live?: boolean;
  readonly verbose?: boolean;
}

export async function createLock(options: CreateLockOptions): Promise<{ lock: LockFile; file: string }> {
  const graphFile = path.resolve(options.graph);
  const root = path.dirname(graphFile);
  const project = new ProjectRoot(root);
  const id = lockId(options.name);
  const lockFile = path.join(root, LOCKS_DIR, `${id}.json`);
  if (await exists(lockFile)) {
    throw new Error(`${path.relative(process.cwd(), lockFile)} exists. A lock is never rewritten; make a new one with --supersedes ${id}`);
  }
  if (options.supersedes && !(await exists(path.join(root, LOCKS_DIR, `${options.supersedes}.json`)))) {
    throw new Error(`--supersedes ${options.supersedes}: no such lock in ${LOCKS_DIR}/`);
  }

  // The graph as it will be cooked: the file, with the scene applied.
  const graphBytes = await fs.readFile(graphFile);
  let document = JSON.parse(graphBytes.toString('utf8'));
  let graphObject: Digest;
  let scene: LockFile['graph']['scene'];
  if (options.scene) {
    const applied = await sceneDocument(graphFile, options.scene);
    for (const warning of applied.warnings) console.error(`Warning: ${warning}`);
    document = applied.document;
    graphObject = await putObject(root, `${JSON.stringify(document, null, 2)}\n`);
    scene = { file: displayPath(root, path.resolve(options.scene)), object: await putObject(root, await fs.readFile(options.scene)) };
  } else {
    graphObject = await putObject(root, graphBytes);
  }
  if (!document.nodes?.some((node: { id?: string }) => node.id === options.node)) {
    throw new Error(`No node "${options.node}" in ${path.basename(graphFile)}`);
  }

  // The code, stored before the cook so the lock names the code that made it.
  const sources = await collectSources(root);
  const { id: treeId, tree } = await storeSources(root, sources);
  const inputs = await hashInputs(project, document, options.inputs ?? []);

  const cooked = options.live
    ? await cookIn(root, graphFile, document, options)
    : await cookInCopy(root, tree, path.relative(root, graphFile), document, options, `lock-${id}`);

  const preview = await writePreview(root, id, options.preview
    ? path.resolve(options.preview)
    : firstRaster(cooked.root, cooked.ports));
  if (cooked.dispose) await cooked.dispose();

  const lock: LockFile = {
    format: 'cascade.lock',
    version: 1,
    id,
    name: options.name,
    status: options.status ?? 'approved',
    ...(options.note ? { note: options.note } : {}),
    ...(options.supersedes ? { supersedes: options.supersedes } : {}),
    created: new Date().toISOString(),
    graph: { file: relativeTo(root, graphFile), node: options.node, object: graphObject, ...(scene ? { scene } : {}) },
    params: graphParams(document),
    ...(publishedParams(document) ? { published: publishedParams(document) } : {}),
    seeds: graphSeeds(document),
    inputs,
    code: {
      tree: treeId,
      files: Object.keys(tree).length,
      ...(sources.skipped.length ? { skipped: sources.skipped } : {}),
      modules: await moduleHashes(root, document, tree),
      ...(await stageHashes(root, tree)),
    },
    versions: {
      cascade: await cascadeVersion(),
      project: await projectVersion(root),
      node: process.version,
    },
    host: { kind: 'headless', platform: `${process.platform}-${process.arch}`, cooked: options.live ? 'live' : 'snapshot' },
    output: { ports: cooked.ports, durationMs: cooked.durationMs },
    ...(preview ? { preview } : {}),
  };

  await fs.mkdir(path.dirname(lockFile), { recursive: true });
  await fs.writeFile(lockFile, stableJson(lock, LOCK_KEY_ORDER), { flag: 'wx' });
  return { lock, file: lockFile };
}

// ---------------------------------------------------------------- replay

export interface ReplayOptions {
  /** Copy the replayed output files here, as `<id>.<port><ext>`. */
  readonly out?: string;
  /** Cook with the project's code as it is now, not the lock's. Answers "does main still make this?". */
  readonly live?: boolean;
  /** Leave the replay copy on disk and report where. */
  readonly keep?: boolean;
  /** Replay even though an input file changed since the lock. */
  readonly allowInputChange?: boolean;
  readonly verbose?: boolean;
}

export interface ReplayResult {
  readonly id: string;
  readonly name: string;
  /** `match`: every fingerprinted output is identical to the lock's. */
  readonly status: 'match' | 'mismatch';
  readonly cooked: 'snapshot' | 'live';
  readonly differences: readonly PortDifference[];
  readonly ports: OutputFingerprint;
  readonly inputsChanged: readonly InputChange[];
  /** How the live project's code differs from the lock's. Informational for a snapshot replay. */
  readonly codeSinceLock: TreeDiff;
  readonly warnings: readonly string[];
  readonly durationMs: number;
  readonly files: readonly string[];
  readonly kept?: string;
}

export interface InputChange {
  readonly path: string;
  readonly expected: Digest;
  readonly actual: Digest | 'missing';
}

export async function replayLock(projectRoot: string, lock: LockFile, options: ReplayOptions = {}): Promise<ReplayResult> {
  const root = path.resolve(projectRoot);
  const project = new ProjectRoot(root);
  const document = JSON.parse((await getObject(root, lock.graph.object)).toString('utf8'));
  const tree = await readTree(root, lock.code.tree);

  const inputsChanged = await changedInputs(project, lock.inputs);
  if (inputsChanged.length && !options.allowInputChange) {
    throw new Error([
      `${lock.id}: ${inputsChanged.length} input ${inputsChanged.length === 1 ? 'file has' : 'files have'} changed since the lock, so the replay could not reproduce it:`,
      ...inputsChanged.map((change) => `  ${change.path}: locked ${short(change.expected)}, now ${change.actual === 'missing' ? 'missing' : short(change.actual)}`),
      'Restore the inputs, or pass --allow-input-change to replay anyway.',
    ].join('\n'));
  }

  const warnings = versionWarnings(lock, await cascadeVersion());
  const live = await hashSources(await collectSources(root));
  const codeSinceLock = diffTrees(tree, live);

  const graphFile = path.join(root, lock.graph.file);
  const ports = Object.keys(lock.output.ports);
  const cooked = options.live
    ? await cookIn(root, graphFile, document, { node: lock.graph.node, ports, verbose: options.verbose })
    : await cookInCopy(root, tree, lock.graph.file, document, { node: lock.graph.node, ports, verbose: options.verbose }, `replay-${lock.id}`);

  try {
    const differences = compareFingerprints(lock.output.ports, cooked.ports);
    const files: string[] = [];
    if (options.out) {
      const out = path.resolve(options.out);
      await fs.mkdir(out, { recursive: true });
      for (const [port, fingerprint] of Object.entries(cooked.ports)) {
        if (fingerprint.kind !== 'file') continue;
        const target = path.join(out, `${lock.id}.${port}${path.extname(fingerprint.path)}`);
        await fs.copyFile(cooked.resolve(fingerprint.path), target);
        files.push(target);
      }
    }
    return {
      id: lock.id,
      name: lock.name,
      status: differences.length ? 'mismatch' : 'match',
      cooked: options.live ? 'live' : 'snapshot',
      differences,
      ports: cooked.ports,
      inputsChanged,
      codeSinceLock,
      warnings,
      durationMs: cooked.durationMs,
      files,
      ...(options.keep && !options.live ? { kept: cooked.root } : {}),
    };
  } finally {
    if (cooked.dispose && !options.keep) await cooked.dispose();
  }
}

// ---------------------------------------------------------------- read and list

/** A lock by id (`locks/<id>.json` in the project) or by path to its file. */
export async function readLock(projectRoot: string, idOrFile: string): Promise<{ lock: LockFile; root: string }> {
  const asFile = path.resolve(idOrFile);
  const file = idOrFile.endsWith('.json') && fssync.existsSync(asFile)
    ? asFile
    : path.join(path.resolve(projectRoot), LOCKS_DIR, `${idOrFile}.json`);
  let parsed: LockFile;
  try {
    parsed = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    throw new Error(`No lock "${idOrFile}" (looked for ${path.relative(process.cwd(), file) || file})`);
  }
  if (parsed?.format !== 'cascade.lock') throw new Error(`${file} is not a Cascade lock`);
  // The project is the folder that holds `locks/`.
  return { lock: parsed, root: path.dirname(path.dirname(file)) };
}

export async function listLocks(projectRoot: string): Promise<LockFile[]> {
  const directory = path.join(path.resolve(projectRoot), LOCKS_DIR);
  let names: string[];
  try { names = await fs.readdir(directory); } catch { return []; }
  const locks: LockFile[] = [];
  for (const name of names.filter((entry) => entry.endsWith('.json')).sort()) {
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(directory, name), 'utf8'));
      if (parsed?.format === 'cascade.lock') locks.push(parsed);
    } catch { /* not a lock */ }
  }
  return locks.sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------- cooking

interface Cooked {
  /** The project root the cook ran in (the copy, or the project). */
  readonly root: string;
  readonly ports: OutputFingerprint;
  readonly durationMs: number;
  readonly resolve: (relative: string) => string;
  readonly dispose?: () => Promise<void>;
}

async function cookIn(
  root: string,
  graphFile: string,
  document: unknown,
  options: { node: string; ports?: readonly string[]; verbose?: boolean },
): Promise<Cooked> {
  const project = new ProjectRoot(root);
  const { outputs, durationMs } = await cookNode(graphFile, document, options.node, options);
  const resolve = (relative: string) => project.resolveMedia(relative);
  const ports = await fingerprintOutputs({ projectRoot: root, resolve }, outputs, options.ports);
  return { root, ports, durationMs, resolve };
}

/** Cook in a fresh copy of the project whose code is exactly `tree`. */
async function cookInCopy(
  root: string,
  tree: SourceTree,
  graphRelative: string,
  document: unknown,
  options: { node: string; ports?: readonly string[]; verbose?: boolean },
  label: string,
): Promise<Cooked> {
  const copy = await fs.mkdtemp(path.join(os.tmpdir(), `cascade-${label.replace(/[^A-Za-z0-9._-]/g, '_')}-`));
  const dispose = () => fs.rm(copy, { recursive: true, force: true });
  try {
    await materialize(root, tree, copy);
    const graphFile = path.join(copy, graphRelative);
    await fs.rm(graphFile, { force: true });
    await fs.writeFile(graphFile, `${JSON.stringify(document, null, 2)}\n`);
    return { ...(await cookIn(await fs.realpath(copy), graphFile, document, options)), dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}

// ---------------------------------------------------------------- what the lock records

/** `"C48 v1"` -> `c48-v1`. The name stays as written; the id is its file name. */
export function lockId(name: string): string {
  const id = name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!id || id.startsWith('.')) throw new Error(`"${name}" does not make a usable lock id`);
  return id;
}

type GraphNode = { id: string; module?: string; props?: Record<string, unknown> };

/** Long values are recorded by hash, so the lock stays readable. */
function compact(value: unknown): unknown {
  const json = JSON.stringify(value);
  return json !== undefined && json.length > 200 ? digest(stableJson(value)) : value;
}

export function graphParams(document: any): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const node of (document.nodes ?? []) as GraphNode[]) {
    for (const [prop, value] of Object.entries(node.props ?? {})) params[`${node.id}.${prop}`] = compact(value);
  }
  return params;
}

/** The values of the editor's published parameters, by their scene ids. */
export function publishedParams(document: any): Record<string, unknown> | undefined {
  const published = document.editor?.parameters as { id: string; node: string; prop: string }[] | undefined;
  if (!published?.length) return undefined;
  const nodes = new Map<string, GraphNode>((document.nodes ?? []).map((node: GraphNode) => [node.id, node]));
  const values: Record<string, unknown> = {};
  for (const parameter of published) values[parameter.id] = compact(nodes.get(parameter.node)?.props?.[parameter.prop] ?? null);
  return values;
}

export function graphSeeds(document: any): Record<string, unknown> {
  const seeds: Record<string, unknown> = {};
  for (const node of (document.nodes ?? []) as GraphNode[]) {
    for (const [prop, value] of Object.entries(node.props ?? {})) {
      if (/seed/i.test(prop)) seeds[`${node.id}.${prop}`] = value;
    }
  }
  for (const parameter of document.editor?.parameters ?? []) {
    if (parameter.control === 'seed') {
      seeds[`${parameter.node}.${parameter.prop}`] = document.nodes?.find((node: GraphNode) => node.id === parameter.node)?.props?.[parameter.prop] ?? null;
    }
  }
  return seeds;
}

/**
 * Hash every file the graph names in a prop (at any depth: a moment's photo
 * path inside its record counts), plus any named with `--input`.
 */
async function hashInputs(project: ProjectRoot, document: any, extra: readonly string[]): Promise<Record<string, Digest>> {
  const candidates = new Set<string>(extra.map((file) => relativeTo(project.root, path.resolve(file))));
  const walk = (value: unknown) => {
    if (typeof value === 'string') {
      if (value.length < 1024 && !value.includes('\n') && !/^[a-z]+:\/\//i.test(value) && /\.[A-Za-z0-9]{1,6}$/.test(value)) {
        candidates.add(value.replace(/^\.?\//, ''));
      }
    } else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  for (const node of (document.nodes ?? []) as GraphNode[]) walk(node.props);
  const inputs: Record<string, Digest> = {};
  for (const candidate of [...candidates].sort()) {
    const file = resolveInput(project, candidate);
    if (!file) continue;
    inputs[candidate] = await digestFile(file);
  }
  return inputs;
}

function resolveInput(project: ProjectRoot, relative: string): string | null {
  try {
    const file = project.resolveMedia(relative);
    return fssync.statSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
}

async function changedInputs(project: ProjectRoot, inputs: Record<string, Digest>): Promise<InputChange[]> {
  const changes: InputChange[] = [];
  for (const [name, expected] of Object.entries(inputs)) {
    const file = resolveInput(project, name);
    const actual = file ? await digestFile(file) : 'missing';
    if (actual !== expected) changes.push({ path: name, expected, actual });
  }
  return changes;
}

async function moduleHashes(root: string, document: any, tree: SourceTree): Promise<Record<string, Digest>> {
  const modules: Record<string, Digest> = {};
  for (const node of (document.nodes ?? []) as GraphNode[]) {
    const id = moduleId(node as any);
    if (!id || id in modules) continue;
    const { file } = await projectModuleFile(root, node as any, id);
    if (!file) continue;
    const name = relativeTo(root, file);
    modules[id] = tree[name] ?? await digestFile(file);
  }
  return modules;
}

async function stageHashes(root: string, tree: SourceTree): Promise<{ stages?: Record<string, Digest> }> {
  let manifest: any;
  try { manifest = JSON.parse(await fs.readFile(path.join(root, 'cascade.json'), 'utf8')); } catch { return {}; }
  const declared = manifest?.exec?.stages;
  if (!declared) return {};
  const stages: Record<string, Digest> = {};
  for (const key of ['entrypoint', 'worker']) {
    const name = typeof declared[key] === 'string' ? declared[key].replace(/^\.\//, '') : undefined;
    if (name && tree[name]) stages[name] = tree[name]!;
  }
  return Object.keys(stages).length ? { stages } : {};
}

function firstRaster(root: string, ports: OutputFingerprint): string | undefined {
  for (const fingerprint of Object.values(ports)) {
    if (fingerprint.kind === 'file' && fingerprint.pixels) {
      try { return new ProjectRoot(root).resolveMedia(fingerprint.path); } catch { /* skip */ }
    }
  }
  return undefined;
}

/** A small PNG beside the lock, so a lock can be looked at without replaying it. */
async function writePreview(root: string, id: string, source: string | undefined): Promise<LockFile['preview']> {
  if (!source) return undefined;
  const { default: sharp } = await import('sharp');
  const file = path.join(LOCKS_DIR, `${id}.preview.png`);
  const bytes = await sharp(source, { limitInputPixels: false })
    .resize(PREVIEW_SIZE, PREVIEW_SIZE, { fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();
  await fs.mkdir(path.join(root, LOCKS_DIR), { recursive: true });
  await fs.writeFile(path.join(root, file), bytes);
  return { file: file.split(path.sep).join('/'), sha256: digest(bytes) };
}

// ---------------------------------------------------------------- versions

async function git(cwd: string): Promise<{ commit?: string; dirty?: boolean }> {
  try {
    const { stdout: commit } = await run('git', ['rev-parse', 'HEAD'], { cwd });
    const { stdout: status } = await run('git', ['status', '--porcelain', '--untracked-files=no'], { cwd, maxBuffer: 16 * 1024 * 1024 });
    return { commit: commit.trim(), dirty: status.trim().length > 0 };
  } catch {
    return {};
  }
}

/** The Cascade that is running this command: its package version and, from a checkout, its commit. */
export async function cascadeVersion(): Promise<VersionInfo> {
  let directory = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
      if (manifest.name === '@field/cascade') return { version: manifest.version, ...(await git(directory)) };
    } catch { /* keep walking */ }
    const parent = path.dirname(directory);
    if (parent === directory) return {};
    directory = parent;
  }
}

async function projectVersion(root: string): Promise<VersionInfo> {
  let version: string | undefined;
  try { version = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version; } catch { /* none */ }
  return { ...(version ? { version } : {}), ...(await git(root)) };
}

function versionWarnings(lock: LockFile, current: VersionInfo): string[] {
  const locked = lock.versions.cascade;
  const warnings: string[] = [];
  if (locked.version && current.version && locked.version !== current.version) {
    warnings.push(`Locked with Cascade ${locked.version}, replaying with ${current.version}`);
  } else if (locked.commit && current.commit && locked.commit !== current.commit) {
    warnings.push(`Locked with Cascade at ${locked.commit.slice(0, 7)}, replaying at ${current.commit.slice(0, 7)}`);
  }
  if (lock.versions.node !== process.version) warnings.push(`Locked under Node ${lock.versions.node}, replaying under ${process.version}`);
  return warnings;
}

// ---------------------------------------------------------------- helpers

function relativeTo(root: string, file: string): string {
  const relative = path.relative(root, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`${file} is outside the project (${root})`);
  return relative.split(path.sep).join('/');
}

/** Project-relative when inside the project, absolute otherwise. */
function displayPath(root: string, file: string): string {
  const relative = path.relative(root, file);
  return relative.startsWith('..') || path.isAbsolute(relative) ? file : relative.split(path.sep).join('/');
}

async function exists(file: string): Promise<boolean> {
  try { await fs.access(file); return true; } catch { return false; }
}

