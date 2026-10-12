/**
 * `cascade parity <graph> [--node <id>] [--seed N] [--tolerance N] [--json]`
 *
 * Does this graph give the same pixels every time, and the same pixels in
 * Studio as headless? It cooks three times and compares every node's outputs:
 *
 *   A  headless, through the deterministic runtime
 *   B  headless again, the same way          (A vs B: is it repeatable?)
 *   S  through Studio's own executor — the compatibility graph and its
 *      definition adapter — run headlessly   (A vs S: do the hosts agree?)
 *
 * Studio's path uses the same capability providers as headless (Dawn for the
 * GPU, the project's files and assets), so a difference in S is a difference
 * in how the two executors cook, not in which GPU drew it. The browser's own
 * WebGPU is the one thing this cannot reach.
 *
 * Stages run as fresh one-shot processes, not through the warm worker: a
 * difference that only shows from a cold start (MPS gave one drawing in one
 * process and another in the next, 12 Oct) must not be hidden by reuse.
 *
 * Caches stand aside for the whole command (`CASCADE_STAGE_CACHE=off`, and the
 * envelope tells each stage `cache: "off"`), because a second cook served from
 * a cache would agree with the first by construction and prove nothing.
 *
 * Outputs are snapshotted right after each cook — decoded pixels for an image,
 * canonical JSON for anything else — because a stage writing to a fixed path
 * overwrites the previous cook's file, and comparing afterwards would compare a
 * file with itself.
 *
 * The report is per node and per port, side by side, never one number for the
 * graph: the first stage that differs is the one to look at. Exit status is 0
 * when everything agrees within `--tolerance` (a channel difference out of 255,
 * default 0), 1 otherwise. doc/PRODUCTION_READINESS.md, item 5.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { ProjectRoot } from '../../server/src/project.js';
import { compileEmbedded, compileProjectModule } from '../../server/src/compile.js';
import { setEmbeddedCompiler, setProjectModuleCompiler } from '../engine/nodeModuleLoader.js';
import { graphSeed } from '../../packages/runtime/src/seed.js';
import { cookProjectGraph, createProjectHost } from './projectRuntime.js';
import { installProjectStages } from './projectStages.js';
import { installProjectIo } from './headlessIo.js';
import { installHeadlessCanvas } from './headlessCanvas.js';
import { imagePath } from './sequence.js';

export interface ParityOptions {
  readonly file: string;
  readonly node?: string;
  readonly seed?: number;
  /** Largest channel difference (0–255) still counted as the same. */
  readonly tolerance: number;
  readonly json: boolean;
  /** Skip the Studio cook (A vs B only). */
  readonly studio: boolean;
}

/** One output as it was right after a cook. */
export type Snapshot =
  | { readonly kind: 'missing' }
  | { readonly kind: 'image'; readonly digest: string; readonly width: number; readonly height: number; readonly pixels: Uint8Array }
  | { readonly kind: 'value'; readonly digest: string; readonly json: string };

export type Verdict = 'same' | 'within tolerance' | 'different' | 'missing';

export interface Comparison {
  readonly verdict: Verdict;
  /** "312 px (0.04 %), max Δ 41", "3952 vs 3953", ... */
  readonly detail?: string;
  readonly differingPixels?: number;
  readonly maxDelta?: number;
}

export interface PortReport {
  readonly node: string;
  readonly port: string;
  readonly kind: Snapshot['kind'];
  readonly repeat: Comparison;
  readonly studio?: Comparison;
}

export interface ParityReport {
  readonly graph: string;
  readonly seed: number;
  readonly tolerance: number;
  readonly ok: boolean;
  readonly ports: readonly PortReport[];
  /** A cook that failed outright, by name. */
  readonly failures: Readonly<Record<string, string>>;
}

type Snapshots = Map<string, Snapshot>; // `${node}.${port}` -> snapshot

// ----------------------------------------------------------------- snapshot

function sha(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}

/** JSON with typed arrays as arrays and object keys sorted, so equal values
 *  print equal text. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (ArrayBuffer.isView(item) && !(item instanceof DataView)) return Array.from(item as unknown as ArrayLike<number>);
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(Object.keys(item).sort().map((key) => [key, (item as Record<string, unknown>)[key]]));
    }
    if (typeof item === 'function') return undefined;
    return item;
  }) ?? 'undefined';
}

/** Studio's in-memory image: planar float channels. */
function planarImage(value: unknown): { width: number; height: number; channels: Float32Array[] } | null {
  const candidate = value as { width?: unknown; height?: unknown; channels?: unknown };
  if (!candidate || typeof candidate !== 'object') return null;
  if (typeof candidate.width !== 'number' || typeof candidate.height !== 'number') return null;
  if (!Array.isArray(candidate.channels) || !candidate.channels.every((channel) => channel instanceof Float32Array)) return null;
  return candidate as { width: number; height: number; channels: Float32Array[] };
}

function rgba8FromPlanar(image: { width: number; height: number; channels: Float32Array[] }): Uint8Array {
  const count = image.width * image.height;
  const out = new Uint8Array(count * 4);
  for (let index = 0; index < count; index++) {
    for (let channel = 0; channel < 4; channel++) {
      const source = image.channels[channel] ?? (channel === 3 ? null : image.channels[0]);
      const value = source ? source[index]! : 1;
      out[index * 4 + channel] = Math.max(0, Math.min(255, Math.round(value * 255)));
    }
  }
  return out;
}

async function decodeFile(full: string): Promise<{ width: number; height: number; pixels: Uint8Array }> {
  const { data, info } = await sharp(full).ensureAlpha().raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, pixels: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
}

const IMAGE_FILE = /\.(png|jpe?g|webp|tiff?)$/i;

export async function snapshotValue(project: ProjectRoot, value: unknown): Promise<Snapshot> {
  if (value === undefined || value === null) return { kind: 'missing' };
  const planar = planarImage(value);
  if (planar) {
    const pixels = rgba8FromPlanar(planar);
    return { kind: 'image', digest: sha(pixels), width: planar.width, height: planar.height, pixels };
  }
  const file = imagePath(value);
  if (file && IMAGE_FILE.test(file)) {
    try {
      const decoded = await decodeFile(project.resolveMedia(file.replace(/^\.?\//, '')));
      return { kind: 'image', digest: sha(decoded.pixels), ...decoded };
    } catch {
      // Not a readable image after all: compare it as the value it is.
    }
  }
  const json = canonical(value);
  return { kind: 'value', digest: sha(json), json };
}

async function snapshotOutputs(
  project: ProjectRoot,
  outputs: ReadonlyMap<string, ReadonlyMap<string, unknown>>,
): Promise<Snapshots> {
  const snapshots: Snapshots = new Map();
  for (const [node, ports] of outputs) {
    for (const [port, value] of ports) {
      if (value === undefined) continue;
      snapshots.set(`${node}.${port}`, await snapshotValue(project, value));
    }
  }
  return snapshots;
}

// ------------------------------------------------------------------ compare

function numbers(json: string): number[] | null {
  try {
    const value = JSON.parse(json) as unknown;
    if (typeof value === 'number') return [value];
    if (Array.isArray(value) && value.every((item) => typeof item === 'number')) return value as number[];
  } catch { /* not numeric */ }
  return null;
}

export function compareSnapshots(a: Snapshot | undefined, b: Snapshot | undefined, tolerance: number): Comparison {
  if (!a || !b || a.kind === 'missing' || b.kind === 'missing') {
    if ((!a || a.kind === 'missing') && (!b || b.kind === 'missing')) return { verdict: 'same' };
    return { verdict: 'missing', detail: !a || a.kind === 'missing' ? 'absent in the first cook' : 'absent in this cook' };
  }
  if (a.digest === b.digest) return { verdict: 'same' };
  if (a.kind === 'image' && b.kind === 'image') {
    if (a.width !== b.width || a.height !== b.height) {
      return { verdict: 'different', detail: `size ${a.width}×${a.height} vs ${b.width}×${b.height}` };
    }
    let differing = 0;
    let maxDelta = 0;
    for (let pixel = 0; pixel < a.pixels.length; pixel += 4) {
      let worst = 0;
      for (let channel = 0; channel < 4; channel++) {
        const delta = Math.abs(a.pixels[pixel + channel]! - b.pixels[pixel + channel]!);
        if (delta > worst) worst = delta;
      }
      if (worst > 0) differing++;
      if (worst > maxDelta) maxDelta = worst;
    }
    const share = (100 * differing) / (a.width * a.height);
    const detail = `${differing} px (${share < 0.01 ? share.toExponential(1) : share.toFixed(2)} %), max Δ ${maxDelta}`;
    return { verdict: maxDelta <= tolerance ? 'within tolerance' : 'different', detail, differingPixels: differing, maxDelta };
  }
  if (a.kind === 'value' && b.kind === 'value') {
    const left = numbers(a.json);
    const right = numbers(b.json);
    if (left && right && left.length === right.length) {
      const maxDelta = Math.max(...left.map((value, index) => Math.abs(value - right[index]!)));
      const detail = left.length === 1 ? `${left[0]} vs ${right[0]}` : `max Δ ${maxDelta}`;
      return { verdict: 'different', detail, maxDelta };
    }
    const shorten = (text: string) => (text.length > 60 ? `${text.slice(0, 57)}...` : text);
    return { verdict: 'different', detail: `${shorten(a.json)} vs ${shorten(b.json)}` };
  }
  return { verdict: 'different', detail: `${a.kind} vs ${b.kind}` };
}

// --------------------------------------------------------------------- cook

async function cookHeadless(file: string, document: unknown, node: string | undefined, project: ProjectRoot): Promise<Snapshots> {
  const { outputs } = await cookProjectGraph(file, structuredClone(document), node);
  return snapshotOutputs(project, outputs);
}

/**
 * Cook through Studio's executor: the compatibility `Graph`, its scheduler and
 * the definition adapter, with the headless host's capabilities swapped in for
 * the browser's. Imported lazily, so `run` never loads the Studio engine.
 */
async function cookStudio(file: string, document: unknown, node: string | undefined, project: ProjectRoot): Promise<Snapshots> {
  const [{ Graph }, { registerStandardNodes }, { studioCapabilities }, { cookUntilSettled }] = await Promise.all([
    import('../nodes/Graph.js'),
    import('../nodes/registerStandardNodes.js'),
    import('../nodes/definition/projectDefinition.js'),
    import('./frames.js'),
  ]);
  // The definition libraries Studio's entry imports, which register on import.
  await Promise.all([
    import('../nodes/core/definitions.js'),
    import('../nodes/math/index.js'),
    import('../nodes/pop/index.js'),
    import('../nodes/geo/index.js'),
  ]);
  registerStandardNodes();
  const host = createProjectHost(file, []);
  Object.assign(studioCapabilities, host.capabilities);

  const graph = Graph.fromJSON(structuredClone(document));
  graph.restoreConnections();
  const entry = node ? graph.getNode(node) : undefined;
  if (node && !entry) throw new Error(`no node "${node}" in the Studio graph`);
  try {
    await cookUntilSettled(graph, entry ?? undefined);
    const failed = graph.nodes.filter((item) => item.error !== null);
    if (failed.length) {
      throw new Error(failed.map((item) => `${item.id}: ${item.error?.message ?? 'cook error'}`).join('; '));
    }
    const outputs = new Map<string, Map<string, unknown>>();
    for (const item of graph.nodes) {
      outputs.set(item.id, new Map(item.outputs.map((port) => [port.name, port.value] as [string, unknown])));
    }
    return await snapshotOutputs(project, outputs);
  } finally {
    graph.scheduler?.dispose?.();
    await (host.capabilities.gpu as { dispose?: () => Promise<void> } | undefined)?.dispose?.();
  }
}

// ---------------------------------------------------------------------- run

export async function parity(options: ParityOptions): Promise<ParityReport> {
  const file = path.resolve(options.file);
  const document = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
  if (options.seed !== undefined) document.seed = options.seed;
  const project = new ProjectRoot(path.dirname(file));

  const previousCache = process.env.CASCADE_STAGE_CACHE;
  process.env.CASCADE_STAGE_CACHE = 'off';
  setProjectModuleCompiler(async (folder) => (await compileProjectModule(project, folder)).code);
  setEmbeddedCompiler(async (code) => (await compileEmbedded(project, code)).code);
  const disposers = [installProjectStages(project, { worker: false }), installProjectIo(project)];
  try {
    const canvas = await installHeadlessCanvas();
    disposers.push(() => canvas.dispose());
  } catch { /* a graph without canvas nodes cooks without it */ }

  const failures: Record<string, string> = {};
  const attempt = async (name: string, cook: () => Promise<Snapshots>): Promise<Snapshots | null> => {
    try {
      return await cook();
    } catch (error) {
      failures[name] = error instanceof Error ? error.message : String(error);
      return null;
    }
  };

  try {
    const first = await attempt('headless', () => cookHeadless(file, document, options.node, project));
    const second = await attempt('headless again', () => cookHeadless(file, document, options.node, project));
    const studio = options.studio ? await attempt('studio', () => cookStudio(file, document, options.node, project)) : null;

    const keys = [...new Set([...(first?.keys() ?? []), ...(second?.keys() ?? [])])].sort();
    const ports: PortReport[] = keys.map((key) => {
      const dot = key.indexOf('.');
      const a = first?.get(key);
      return {
        node: key.slice(0, dot),
        port: key.slice(dot + 1),
        kind: (a ?? second?.get(key))?.kind ?? 'missing',
        repeat: compareSnapshots(a, second?.get(key), options.tolerance),
        ...(studio ? { studio: compareSnapshots(a, studio.get(key), options.tolerance) } : {}),
      };
    });
    const agrees = (comparison?: Comparison) => !comparison || comparison.verdict === 'same' || comparison.verdict === 'within tolerance';
    const ok = Object.keys(failures).length === 0 && ports.every((port) => agrees(port.repeat) && agrees(port.studio));
    return { graph: file, seed: graphSeed(document), tolerance: options.tolerance, ok, ports, failures };
  } finally {
    for (const dispose of disposers.reverse()) {
      try { dispose(); } catch { /* best effort */ }
    }
    setProjectModuleCompiler(null);
    setEmbeddedCompiler(null);
    if (previousCache === undefined) delete process.env.CASCADE_STAGE_CACHE;
    else process.env.CASCADE_STAGE_CACHE = previousCache;
  }
}

/** The report as a table: one row per port, the two comparisons side by side. */
export function formatParityReport(report: ParityReport): string {
  const lines = [`parity ${report.graph}  seed ${report.seed}  tolerance ${report.tolerance}`];
  for (const [cook, message] of Object.entries(report.failures)) lines.push(`  ${cook} cook failed: ${message}`);
  const cell = (comparison?: Comparison) =>
    !comparison ? '-' : comparison.detail ? `${comparison.verdict}: ${comparison.detail}` : comparison.verdict;
  const rows = report.ports.map((port) => [`${port.node}.${port.port}`, port.kind, cell(port.repeat), cell(port.studio)]);
  const header = ['output', 'kind', 'headless twice', 'headless vs studio'];
  const widths = header.map((title, column) => Math.max(title.length, ...rows.map((row) => row[column]!.length)));
  const format = (row: string[]) => `  ${row.map((text, column) => text.padEnd(widths[column]!)).join('  ')}`.trimEnd();
  lines.push(format(header));
  for (const row of rows) lines.push(format(row));
  const differing = report.ports.filter((port) => !['same', 'within tolerance'].includes(port.repeat.verdict)
    || (port.studio && !['same', 'within tolerance'].includes(port.studio.verdict)));
  lines.push(report.ok ? 'all outputs agree' : `${differing.length} of ${report.ports.length} outputs differ`);
  return lines.join('\n');
}

export function parseParityArgs(args: readonly string[]): ParityOptions {
  let file: string | undefined;
  let node: string | undefined;
  let seed: number | undefined;
  let tolerance = 0;
  let json = false;
  let studio = true;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    const value = () => {
      const next = args[++index];
      if (next === undefined || next.startsWith('--')) throw new Error(`${argument} needs a value`);
      return next;
    };
    if (argument === '--node') node = value();
    else if (argument === '--seed') {
      seed = Number(value());
      if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('--seed must be an integer from 0 to 4294967295');
    } else if (argument === '--tolerance') {
      tolerance = Number(value());
      if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 255) throw new Error('--tolerance must be 0 to 255');
    } else if (argument === '--json') json = true;
    else if (argument === '--no-studio') studio = false;
    else if (argument.startsWith('-')) throw new Error(`unknown option: ${argument}`);
    else if (!file) file = argument;
    else throw new Error(`unexpected argument: ${argument}`);
  }
  if (!file) throw new Error('usage: cascade parity <graph-file> [--node <id>] [--seed N] [--tolerance N] [--no-studio] [--json]');
  return { file, ...(node ? { node } : {}), ...(seed === undefined ? {} : { seed }), tolerance, json, studio };
}

/**
 * The CLI entry: prints the report, returns the exit status — 1 when outputs
 * differ. Under `--json` the report is the envelope's data and `report.ok`
 * carries the verdict, so the exit status says only whether parity ran.
 */
export async function runParityCommand(args: readonly string[]): Promise<number> {
  const options = parseParityArgs(args);
  // Stdout stays machine-readable under --json, whatever nodes log.
  const log = console.log;
  if (options.json) console.log = console.error;
  try {
    const report = await parity(options);
    if (options.json) {
      process.stdout.write(JSON.stringify(report) + '\n');
      return 0;
    }
    log(formatParityReport(report));
    return report.ok ? 0 : 1;
  } finally {
    console.log = log;
  }
}
