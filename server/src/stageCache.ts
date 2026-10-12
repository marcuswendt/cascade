/**
 * Stage calls with a cache key Cascade owns.
 *
 * Every Python stage call, from Studio or headless, goes through `callStage`.
 * It computes one key from four things and nothing else:
 *
 *   - the stage code: a hash of the project's stage sources (`StageSources`)
 *   - the parameters: the call's arguments, with every input file replaced by
 *     a hash of its bytes, so a path that now holds different pixels is a
 *     different input
 *   - the input hashes themselves, listed per argument
 *   - the Cascade version
 *
 * The key and its parts go into a `StageTrace` on every call, hit or miss, so
 * whether a result is fresh can be read off the trace rather than inferred
 * from timing. The doc's item 2 is the reason: a cache that keyed without the
 * stage source served an edited stage its old answer, and nothing said so.
 *
 * Caching the result is a separate decision (`exec.stages.cache`, off by
 * default). When it is on, a stored result is served only while every file it
 * names still has the bytes it had when stored; a stage that writes to a fixed
 * path and was since re-run with other inputs is a miss, never a stale hit.
 *
 * `CASCADE_STAGE_CACHE=off` in the environment turns reading and writing off
 * for one process, and the envelope tells the stage so (`cache: "off"`), so a
 * project's own cache can stand aside too. `cascade parity` sets it.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProjectRoot } from './project.js';
import type { StageCachePolicy, StageConfig } from './stageRunner.js';
import { contentDigest, StageSources } from './stageSources.js';

/** Bump when the entry format or the key's recipe changes. */
const CACHE_FORMAT = 1;
const CACHE_DIRECTORY = '.cascade/cache/stages';

export type StageCacheState = 'hit' | 'miss' | 'off';

/** What one stage call was, as written into a run trace. */
export interface StageTrace {
  readonly stage: string;
  /** The core cache key, 32 hex characters. */
  readonly key: string;
  readonly cache: StageCacheState;
  /** Why it was not a hit: "not enabled", "excluded", "no entry",
   *  "CASCADE_STAGE_CACHE=off", or the output file that changed. */
  readonly why?: string;
  /** The stage code hash the key was computed with. */
  readonly code: string;
  readonly cascade: string;
  /** Argument path -> first 16 hex of its file's content hash. */
  readonly inputs: Readonly<Record<string, string>>;
  readonly ms: number;
  /** The project's own cache report, when its worker sends one. */
  readonly project?: string;
  /** True when a warm worker restarted for changed code before this call. */
  readonly restarted?: boolean;
}

/** Sent to the stage beside its args, never inside them. */
export type StageEnvelope = Readonly<{
  key: string;
  code: string;
  cache: 'use' | 'off';
}>;

/** What a transport hands back: the result and what it knows about the run. */
export interface StageInvocation {
  readonly result: unknown;
  readonly projectCache?: string;
  readonly restarted?: boolean;
}

export type StageInvoker = (envelope: StageEnvelope) => Promise<StageInvocation>;

let version: string | undefined;

/**
 * The version of the Cascade that is running, from its own package.json.
 * Walks up from this file, because the source tree and the bundled CLI keep
 * it at different depths.
 */
export function cascadeVersion(): string {
  if (version) return version;
  let directory = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 6; depth++) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')) as { name?: string; version?: string };
      if (manifest.name === '@field/cascade' && manifest.version) return (version = manifest.version);
    } catch { /* keep walking */ }
    directory = path.dirname(directory);
  }
  return (version = 'unknown');
}

/** A string that names an existing file inside the project, or null. */
function projectFile(project: ProjectRoot, value: string): string | null {
  if (!value || value.length > 1024 || value.includes('\0') || /^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  if (path.isAbsolute(value) || !/[./]/.test(value)) return null;
  try {
    return project.resolveMedia(value.replace(/^\.\//, ''));
  } catch {
    return null;
  }
}

/**
 * Walk a value and replace every string naming a project file with the hash
 * of its bytes. `onFile` sees each one with its path in the value, `a.b[2]`.
 */
function replaceFiles(
  project: ProjectRoot,
  value: unknown,
  at: string,
  skip: ReadonlySet<string>,
  onFile: (where: string, relative: string, digest: string) => void,
): unknown {
  if (typeof value === 'string') {
    const full = projectFile(project, value);
    const digest = full ? contentDigest(full) : null;
    if (!digest) return value;
    onFile(at, value, digest);
    return `file:${digest}`;
  }
  if (Array.isArray(value)) return value.map((item, index) => replaceFiles(project, item, `${at}[${index}]`, skip, onFile));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const name of Object.keys(value).sort()) {
      const child = (value as Record<string, unknown>)[name];
      const where = at ? `${at}.${name}` : name;
      // An output argument names where the result goes, not what it is from.
      out[name] = !at && skip.has(name) ? child : replaceFiles(project, child, where, skip, onFile);
    }
    return out;
  }
  return value;
}

export interface StageKey {
  readonly key: string;
  readonly code: string;
  readonly cascade: string;
  readonly inputs: Readonly<Record<string, string>>;
}

/** The core cache key for one call. Pure apart from reading input files. */
export function stageCacheKey(
  project: ProjectRoot,
  stage: string,
  args: Record<string, unknown>,
  code: string,
  outputs: readonly string[] = [],
): StageKey {
  const inputs: Record<string, string> = {};
  const params = replaceFiles(project, args, '', new Set(outputs), (where, _relative, digest) => {
    inputs[where] = digest.slice(0, 16);
  });
  const cascade = cascadeVersion();
  const blob = JSON.stringify({ format: CACHE_FORMAT, stage, code, cascade, params });
  return { key: createHash('sha256').update(blob).digest('hex').slice(0, 32), code, cascade, inputs };
}

interface StoredEntry {
  readonly format: number;
  readonly stage: string;
  readonly key: string;
  readonly result: unknown;
  /** Project-relative file the result names -> content hash when stored. */
  readonly outputs: Readonly<Record<string, string>>;
}

function entryPath(project: ProjectRoot, stage: string, key: string): string {
  return project.resolve(path.posix.join(CACHE_DIRECTORY, stage, `${key}.json`));
}

/** Every project file a result names, with its hash now. */
function resultFiles(project: ProjectRoot, result: unknown): Record<string, string> {
  const files: Record<string, string> = {};
  replaceFiles(project, result, '', new Set(), (_where, relative, digest) => {
    files[relative] = digest;
  });
  return files;
}

function readEntry(project: ProjectRoot, stage: string, key: string): { result: unknown } | { why: string } {
  let entry: StoredEntry;
  try {
    entry = JSON.parse(fs.readFileSync(entryPath(project, stage, key), 'utf8')) as StoredEntry;
  } catch {
    return { why: 'no entry' };
  }
  if (entry.format !== CACHE_FORMAT || entry.key !== key) return { why: 'no entry' };
  for (const [relative, digest] of Object.entries(entry.outputs ?? {})) {
    const full = projectFile(project, relative);
    if (!full || contentDigest(full) !== digest) return { why: `output changed: ${relative}` };
  }
  return { result: entry.result };
}

function writeEntry(project: ProjectRoot, stage: string, key: string, result: unknown): void {
  const file = entryPath(project, stage, key);
  const entry: StoredEntry = { format: CACHE_FORMAT, stage, key, result, outputs: resultFiles(project, result) };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(entry));
  fs.renameSync(temporary, file); // atomic: an interrupted write never leaves half an entry
}

function cacheMode(policy: StageCachePolicy, stage: string, env: NodeJS.ProcessEnv): { use: boolean; why?: string } {
  if (env.CASCADE_STAGE_CACHE === 'off') return { use: false, why: 'CASCADE_STAGE_CACHE=off' };
  if (!policy.enabled) return { use: false, why: 'not enabled' };
  if (policy.exclude.includes(stage)) return { use: false, why: 'excluded' };
  return { use: true };
}

/** The stage sources a configuration declares, or the default folders. */
export function stageSources(project: ProjectRoot, config: StageConfig): StageSources {
  return new StageSources(project, config.sources ?? StageSources.defaultRoots(project, config.entrypoint, config.worker));
}

export interface CallStageOptions {
  readonly env?: NodeJS.ProcessEnv;
  /** Receives the trace of every call, hit or miss. */
  readonly onTrace?: (trace: StageTrace) => void;
}

/**
 * Run one stage through the core cache. `invoke` is the transport (a warm
 * worker or a one-shot process); it receives the envelope and is not called
 * at all on a hit.
 */
export async function callStage(
  project: ProjectRoot,
  config: StageConfig,
  stage: string,
  args: Record<string, unknown>,
  invoke: StageInvoker,
  options: CallStageOptions = {},
): Promise<{ result: unknown; trace: StageTrace }> {
  const started = performance.now();
  const code = stageSources(project, config).codeHash();
  const identity = stageCacheKey(project, stage, args, code, config.cache.outputs);
  const mode = cacheMode(config.cache, stage, options.env ?? process.env);
  const finish = (result: unknown, trace: Omit<StageTrace, 'stage' | 'key' | 'code' | 'cascade' | 'inputs' | 'ms'>) => {
    const full: StageTrace = {
      stage,
      key: identity.key,
      ...trace,
      code: identity.code,
      cascade: identity.cascade,
      inputs: identity.inputs,
      ms: Math.round(performance.now() - started),
    };
    options.onTrace?.(full);
    return { result, trace: full };
  };

  let why = mode.why;
  if (mode.use) {
    const stored = readEntry(project, stage, identity.key);
    if ('result' in stored) return finish(stored.result, { cache: 'hit' });
    why = stored.why;
  }

  const answer = await invoke({ key: identity.key, code, cache: mode.why === 'CASCADE_STAGE_CACHE=off' ? 'off' : 'use' });
  if (mode.use) {
    try {
      writeEntry(project, stage, identity.key, answer.result);
    } catch {
      // Caching is an optimisation; failing to store is not a failed stage.
    }
  }
  return finish(answer.result, {
    cache: mode.use ? 'miss' : 'off',
    ...(why ? { why } : {}),
    ...(answer.projectCache ? { project: answer.projectCache } : {}),
    ...(answer.restarted ? { restarted: true } : {}),
  });
}

/** One line for a log: `ink: miss (no entry) 3f2a…  1204 ms`. */
export function formatStageTrace(trace: StageTrace): string {
  const reason = trace.why ? ` (${trace.why})` : '';
  const project = trace.project ? ` project:${trace.project}` : '';
  const restarted = trace.restarted ? ' worker restarted for new code' : '';
  return `${trace.stage}: ${trace.cache}${reason}${project} key ${trace.key.slice(0, 12)} code ${trace.code} ${trace.ms} ms${restarted}`;
}
