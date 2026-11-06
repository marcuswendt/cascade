/**
 * Ladders and picks: three to five options side by side, and a lock at the
 * moment one is approved.
 *
 * `cascade ladder` cooks one node of a graph once per variant — a few values
 * of one or more parameters, or a few graph seeds — and writes:
 *
 *  - `ladders/<id>/<n>.png`, each variant's image, full size;
 *  - `ladders/<id>/sheet.png`, the contact sheet, each variant labelled with
 *    its number and what it changed (`cascade.image.ContactSheet`'s layout);
 *  - `ladders/<id>.json`, the record: per variant the graph as cooked (in the
 *    object store), its parameters and seeds, the input hashes and the
 *    fingerprint of what it made; once for the ladder the stored code, the
 *    versions and the project's git commit.
 *
 * Every variant is cooked from the stored code in one fresh copy of the
 * project, as a lock is, unless `--live`. So the record already holds
 * everything a lock needs, and `cascade pick <ladder> <n>` writes the lock
 * from it without cooking again: the lock names the code, seed, parameters
 * and image he looked at, not a re-render made afterwards. `cascade replay`
 * then rebuilds it with no worktree, and a match means the replay's pixels
 * equal that variant image's (doc/PRODUCTION_READINESS.md, item 10).
 *
 * The cloud-plots retrospective (October 2026) is why: approvals did not hold,
 * and sixteen worktrees were needed to reproduce what had been seen.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { ProjectRoot } from '../../../server/src/project.js';
import { composeContactSheet } from '../../../packages/runtime/src/builtins/image/index.js';
import { graphSeed } from '../../../packages/runtime/src/seed.js';
import { installHeadlessCanvas } from '../headlessCanvas.js';
import { fingerprintFile, type OutputFingerprint } from './fingerprint.js';
import {
  cascadeVersion, changedInputs, checkLockId, cookIn, firstRaster, graphParams, graphSeeds, hashInputs,
  lockId, moduleHashes, openCopy, projectVersion, publishedParams, relativeTo, stageHashes, writeLock,
  writePreview, type LockFile,
} from './lock.js';
import { collectSources, storeSources } from './snapshot.js';
import { digest, getObject, putObject, stableJson, type Digest } from './store.js';

export const LADDERS_DIR = 'ladders';
/** A ladder is for choosing by eye; past this a sheet stops being readable. */
const MAX_VARIANTS = 12;
const LADDER_KEY_ORDER = ['format', 'version', 'id', 'name', 'note', 'created', 'graph', 'vary', 'seeds'];

export interface LadderVariant {
  /** 1-based, as labelled on the sheet and named to `cascade pick`. */
  readonly index: number;
  readonly label: string;
  /** What this variant changed: `node.prop` to its value. */
  readonly set: Record<string, unknown>;
  /** The graph seed it cooked with. */
  readonly seed: number;
  /** The graph document as cooked, in the object store. */
  readonly graph: Digest;
  readonly params: Record<string, unknown>;
  readonly seeds: Record<string, unknown>;
  readonly inputs: Record<string, Digest>;
  /** The variant's image, project-relative. */
  readonly image: string;
  readonly output: { readonly ports: OutputFingerprint; readonly durationMs: number; readonly trace?: string };
}

export interface LadderFile {
  readonly format: 'cascade.ladder';
  readonly version: 1;
  readonly id: string;
  readonly name: string;
  readonly note?: string;
  readonly created: string;
  readonly graph: { readonly file: string; readonly node: string; readonly object: Digest };
  /** Every varied parameter with its values, in variant order. */
  readonly vary: Record<string, readonly unknown[]>;
  /** The graph seeds, when they were varied. */
  readonly seeds?: readonly number[];
  readonly code: LockFile['code'];
  readonly versions: LockFile['versions'];
  readonly host: LockFile['host'];
  readonly sheet: { readonly file: string; readonly sha256: Digest; readonly columns: number };
  readonly variants: readonly LadderVariant[];
  /** Appended by `cascade pick`; the lock is the record, this is the pointer. */
  readonly picks?: readonly { readonly variant: number; readonly lock: string; readonly at: string }[];
}

export interface LadderOptions {
  readonly graph: string;
  readonly node: string;
  readonly name: string;
  readonly note?: string;
  /** `node.prop` to the values to try, one per variant. A single value applies to every variant. */
  readonly vary?: Record<string, readonly unknown[]>;
  /** Graph seeds to try, one per variant. */
  readonly seeds?: readonly number[];
  readonly columns?: number;
  readonly ports?: readonly string[];
  readonly inputs?: readonly string[];
  readonly live?: boolean;
  readonly verbose?: boolean;
}

// ---------------------------------------------------------------- ladder

export async function createLadder(options: LadderOptions): Promise<{ ladder: LadderFile; file: string }> {
  const graphFile = path.resolve(options.graph);
  const root = path.dirname(graphFile);
  const project = new ProjectRoot(root);
  const id = lockId(options.name);
  const ladderFile = path.join(root, LADDERS_DIR, `${id}.json`);
  if (await exists(ladderFile) || await exists(path.join(root, LADDERS_DIR, id))) {
    throw new Error(`${LADDERS_DIR}/${id} exists. A ladder is never rewritten; give this one another --name`);
  }

  const base = JSON.parse(await fs.readFile(graphFile, 'utf8'));
  if (!base.nodes?.some((node: { id?: string }) => node.id === options.node)) {
    throw new Error(`No node "${options.node}" in ${path.basename(graphFile)}`);
  }
  const plan = variantPlan(base, options.vary ?? {}, options.seeds);
  const graphRelative = relativeTo(root, graphFile);

  const sources = await collectSources(root);
  const { id: treeId, tree } = await storeSources(root, sources);
  const directory = path.join(root, LADDERS_DIR, id);
  await fs.mkdir(directory, { recursive: true });

  const copy = options.live ? undefined : await openCopy(root, tree, `ladder-${id}`);
  const variants: LadderVariant[] = [];
  try {
    for (const [offset, step] of plan.entries()) {
      const index = offset + 1;
      const document = withVariant(base, step.set, step.seed);
      const cookOptions = { node: options.node, ports: options.ports, verbose: options.verbose };
      const cooked = copy
        ? await copy.cook(graphRelative, document, cookOptions)
        : await cookIn(root, graphFile, document, cookOptions);
      const source = firstRaster(cooked.root, cooked.ports);
      if (!source) throw new Error(`Variant ${index}: node "${options.node}" made no raster image to put on a sheet (ports: ${Object.keys(cooked.ports).join(', ')})`);
      const image = path.join(directory, `${String(index).padStart(2, '0')}${path.extname(source).toLowerCase()}`);
      await fs.copyFile(source, image);
      variants.push({
        index,
        label: variantLabel(index, step.set, options.seeds ? step.seed : undefined),
        set: step.set,
        seed: graphSeed(document),
        graph: await putObject(root, `${JSON.stringify(document, null, 2)}\n`),
        params: graphParams(document),
        seeds: graphSeeds(document),
        inputs: await hashInputs(project, document, options.inputs ?? []),
        image: relativeTo(root, image),
        output: { ports: cooked.ports, durationMs: cooked.durationMs, ...(cooked.trace ? { trace: cooked.trace } : {}) },
      });
    }
  } finally {
    await copy?.dispose();
  }

  const sheet = await writeSheet(root, path.join(directory, 'sheet.png'), variants, options.columns);
  const ladder: LadderFile = {
    format: 'cascade.ladder',
    version: 1,
    id,
    name: options.name,
    ...(options.note ? { note: options.note } : {}),
    created: new Date().toISOString(),
    graph: { file: graphRelative, node: options.node, object: await putObject(root, await fs.readFile(graphFile)) },
    vary: Object.fromEntries(Object.keys(options.vary ?? {}).map((key) => [key, plan.map((step) => step.set[key])])),
    ...(options.seeds ? { seeds: [...options.seeds] } : {}),
    code: {
      tree: treeId,
      files: Object.keys(tree).length,
      ...(sources.skipped.length ? { skipped: sources.skipped } : {}),
      modules: await moduleHashes(root, base, tree),
      ...(await stageHashes(root, tree)),
    },
    versions: { cascade: await cascadeVersion(), project: await projectVersion(root), node: process.version },
    host: { kind: 'headless', platform: `${process.platform}-${process.arch}`, cooked: options.live ? 'live' : 'snapshot' },
    sheet,
    variants,
  };
  await fs.writeFile(ladderFile, stableJson(ladder, LADDER_KEY_ORDER), { flag: 'wx' });
  return { ladder, file: ladderFile };
}

interface Step {
  readonly set: Record<string, unknown>;
  readonly seed: number;
}

/** One step per variant: the values zipped across parameters, a lone value broadcast. */
export function variantPlan(document: any, vary: Record<string, readonly unknown[]>, seeds?: readonly number[]): Step[] {
  const lengths = [...Object.values(vary).map((values) => values.length), ...(seeds ? [seeds.length] : [])];
  if (!lengths.length) throw new Error('A ladder needs --vary <node.prop>=<a,b,c> or --seeds <a,b,c>');
  const count = Math.max(...lengths);
  if (count < 2) throw new Error('A ladder needs at least two variants');
  if (count > MAX_VARIANTS) throw new Error(`A ladder has at most ${MAX_VARIANTS} variants (got ${count}); three to five is the usual`);
  for (const [key, values] of Object.entries(vary)) {
    if (values.length !== 1 && values.length !== count) throw new Error(`--vary ${key} has ${values.length} values; every list needs ${count} (or one)`);
    const [nodeId, prop] = splitTarget(key);
    if (!document.nodes?.some((node: { id?: string }) => node.id === nodeId)) throw new Error(`--vary ${key}: no node "${nodeId}"`);
    if (!prop) throw new Error(`--vary ${key}: name the parameter as node.prop`);
  }
  if (seeds && seeds.length !== 1 && seeds.length !== count) throw new Error(`--seeds has ${seeds.length} values; it needs ${count} (or one)`);
  return Array.from({ length: count }, (_, index) => ({
    set: Object.fromEntries(Object.entries(vary).map(([key, values]) => [key, values[values.length === 1 ? 0 : index]])),
    seed: seeds ? seeds[seeds.length === 1 ? 0 : index]! : graphSeed(document),
  }));
}

/** The graph with one variant's values and seed applied. The original is not changed. */
export function withVariant(document: any, set: Record<string, unknown>, seed: number): any {
  const copy = structuredClone(document);
  for (const [key, value] of Object.entries(set)) {
    const [nodeId, prop] = splitTarget(key);
    const node = copy.nodes.find((candidate: { id?: string }) => candidate.id === nodeId);
    node.props = { ...(node.props ?? {}), [prop]: value };
  }
  if (seed !== graphSeed(document) || document.seed !== undefined) copy.seed = seed;
  return copy;
}

function splitTarget(key: string): [string, string] {
  const at = key.lastIndexOf('.');
  return at <= 0 ? [key, ''] : [key.slice(0, at), key.slice(at + 1)];
}

function variantLabel(index: number, set: Record<string, unknown>, seed: number | undefined): string {
  const parts = Object.entries(set).map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`);
  if (seed !== undefined) parts.push(`seed ${seed}`);
  return [String(index), ...parts].join('  ');
}

async function writeSheet(root: string, file: string, variants: readonly LadderVariant[], columns?: number): Promise<LadderFile['sheet']> {
  const canvas = await installHeadlessCanvas();
  try {
    const images = await Promise.all(variants.map((variant) => fs.readFile(path.join(root, variant.image))));
    const { bytes, layout } = await composeContactSheet(images.map((bytes) => new Uint8Array(bytes)), {
      columns: columns ?? Math.min(variants.length, 5),
      labels: variants.map((variant) => variant.label),
      labelSize: 16,
    });
    await fs.writeFile(file, bytes);
    return { file: relativeTo(root, file), sha256: digest(bytes), columns: layout.columns };
  } finally {
    canvas.dispose();
  }
}

// ---------------------------------------------------------------- read

/** A ladder by id (`ladders/<id>.json`) or by path to its file. */
export async function readLadder(projectRoot: string, idOrFile: string): Promise<{ ladder: LadderFile; root: string; file: string }> {
  const asFile = path.resolve(idOrFile);
  const file = idOrFile.endsWith('.json') && await exists(asFile)
    ? asFile
    : path.join(path.resolve(projectRoot), LADDERS_DIR, `${idOrFile}.json`);
  let parsed: LadderFile;
  try {
    parsed = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    throw new Error(`No ladder "${idOrFile}" (looked for ${path.relative(process.cwd(), file) || file})`);
  }
  if (parsed?.format !== 'cascade.ladder') throw new Error(`${file} is not a Cascade ladder`);
  return { ladder: parsed, root: path.dirname(path.dirname(file)), file };
}

// ---------------------------------------------------------------- pick

export interface PickOptions {
  /** The lock's name. Default: the ladder's name and the variant number. */
  readonly name?: string;
  readonly note?: string;
  readonly status?: string;
  readonly supersedes?: string;
}

export interface PickResult {
  readonly lock: LockFile;
  readonly file: string;
  readonly ladder: string;
  readonly variant: LadderVariant;
  readonly warnings: readonly string[];
}

/**
 * Write the lock for one variant of a ladder, from what the ladder recorded.
 * Nothing is cooked: the lock's fingerprint is the variant's, so it names the
 * image that was approved. Refused when that image has changed on disk since
 * the ladder, because then the image being approved is not the one recorded.
 */
export async function pickVariant(projectRoot: string, ladderIdOrFile: string, index: number, options: PickOptions = {}): Promise<PickResult> {
  const { ladder, root, file: ladderFile } = await readLadder(projectRoot, ladderIdOrFile);
  const variant = ladder.variants.find((candidate) => candidate.index === index);
  if (!variant) throw new Error(`${ladder.id} has variants 1 to ${ladder.variants.length}; there is no ${index}`);
  const id = lockId(options.name ?? `${ladder.name} ${index}`);
  await checkLockId(root, id, options.supersedes);

  const image = path.join(root, variant.image);
  const recorded = Object.values(variant.output.ports).find((port) => port.kind === 'file' && port.pixels);
  const current = await fingerprintFile({ projectRoot: root, resolve: (relative) => path.join(root, relative) }, image, variant.image)
    .catch(() => undefined);
  if (!recorded || recorded.kind !== 'file' || current?.kind !== 'file' || current.pixels !== recorded.pixels) {
    throw new Error(`${variant.image} is missing or no longer the image the ladder recorded; make a new ladder rather than lock a different picture`);
  }

  const document = JSON.parse((await getObject(root, variant.graph)).toString('utf8'));
  const warnings: string[] = [];
  const changed = await changedInputs(new ProjectRoot(root), variant.inputs);
  if (changed.length) {
    warnings.push(`${changed.length} input ${changed.length === 1 ? 'file has' : 'files have'} changed since the ladder (${changed.map((change) => change.path).join(', ')}); the lock records the ladder's, so a replay needs them restored`);
  }
  const preview = await writePreview(root, id, image);
  const published = publishedParams(document);
  const lock: LockFile = {
    format: 'cascade.lock',
    version: 1,
    id,
    name: options.name ?? `${ladder.name} ${index}`,
    status: options.status ?? 'approved',
    ...(options.note ? { note: options.note } : {}),
    ...(options.supersedes ? { supersedes: options.supersedes } : {}),
    created: new Date().toISOString(),
    graph: { file: ladder.graph.file, node: ladder.graph.node, object: variant.graph },
    params: variant.params,
    ...(published ? { published } : {}),
    seeds: variant.seeds,
    inputs: variant.inputs,
    code: ladder.code,
    versions: ladder.versions,
    host: ladder.host,
    output: variant.output,
    ...(preview ? { preview } : {}),
    ladder: {
      id: ladder.id,
      file: relativeTo(root, ladderFile),
      variant: index,
      label: variant.label,
      image: variant.image,
      sheet: ladder.sheet.file,
    },
  };
  const file = await writeLock(root, lock);

  const picks = [...(ladder.picks ?? []), { variant: index, lock: id, at: lock.created }];
  await fs.writeFile(ladderFile, stableJson({ ...ladder, picks }, LADDER_KEY_ORDER));
  return { lock, file, ladder: ladder.id, variant, warnings };
}

// ---------------------------------------------------------------- helpers

/** `--vary` values: a JSON list without its brackets (`0.5,1,2`, `[1,2],[3,4]`), or bare words. */
export function parseValues(text: string): unknown[] {
  try {
    const parsed = JSON.parse(`[${text}]`);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* words */ }
  return text.split(',').map((word) => word.trim());
}

async function exists(file: string): Promise<boolean> {
  try { await fs.access(file); return true; } catch { return false; }
}
