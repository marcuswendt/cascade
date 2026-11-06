/**
 * Run a project's Python stage without an HTTP request.
 *
 * The exec route does this for the page; a headless host needs the same thing
 * with no Express in the picture, and duplicating it in the CLI is how the two
 * would drift. So the mechanics live here and both callers use them.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ProjectRoot } from './project.js';

const TIMEOUT_MS = 10 * 60 * 1000;
const MAX_BUFFER = 64 * 1024 * 1024;

export interface StageConfig {
  python: string;
  entrypoint: string;
  worker?: string;
  /** Project-relative files or folders whose `.py` files are the stage code
   *  (`exec.stages.sources`). Absent: see `StageSources.defaultRoots`. */
  sources?: string[];
  /** `exec.stages.cache`: the core result cache, off unless declared. */
  cache: StageCachePolicy;
}

/**
 * Whether Cascade caches a stage's result itself (`exec.stages.cache`).
 *
 * **Undeclared, it caches the calls a node's cook makes, and only those.** A
 * node is a pure function of its inputs (the definition contract), so a stage
 * it calls from its cook is inferred pure: same code, same arguments, same
 * input file bytes, same answer. A call from anywhere else — a panel's
 * `api.runStage`, a hand-rolled `fetch('/api/exec')` — is an action until
 * declared otherwise: a plotter's `plot-start` or `plot-status` changes under
 * an identical call, and caching it would stop the progress bar or skip the
 * plot. Until 6 Nov 2026 nothing was cached unless declared, and every re-cook
 * of a Python-backed sketch paid its first stage call again (4.1 of 4.7 s for
 * cloud-plots/relief).
 *
 * Declared:
 *
 *     "cache": false                       nothing, anywhere (the old default)
 *     "cache": true                        every call, cook or not
 *     "cache": { "exclude": ["plot-status"], "outputs": ["out", "svg_out"] }
 *
 * `exclude` names stages whose answer changes under an identical call (a
 * clock, a random draw, a network read, a file the arguments do not name);
 * they are never cached, whatever the scope. `outputs` names the arguments
 * that are files a stage WRITES, which are not inputs and are kept out of the
 * input hashes. An object without `"scope": "all"` keeps the cook-only scope.
 *
 * The key is computed and reported either way, so a trace always says which
 * code and inputs a result came from.
 */
export interface StageCachePolicy {
  readonly enabled: boolean;
  /** `cook`: only calls a node's cook makes. `all`: every call. */
  readonly scope: StageCacheScope;
  readonly exclude: readonly string[];
  readonly outputs: readonly string[];
}

export type StageCacheScope = 'cook' | 'all';

export interface StageRunOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly timeout?: number;
  readonly signal?: AbortSignal;
  /**
   * Where a stage's own output goes when it succeeds.
   *
   * Until now: nowhere. `stderr` was read only on failure and `stdout` only for
   * its last line, so **a stage could log and nobody could ever read it** —
   * while the comment below promises that logging on the way through is
   * supported. MW-OBSERVATORY-ART found this the hard way, by adding a
   * `[cache] served from cache` line to diagnose an invisible staleness bug and
   * then discovering the diagnostic was itself invisible.
   *
   * Absent means discard, which keeps a quiet run quiet. `cascade run
   * --verbose` supplies one.
   */
  readonly onOutput?: (stream: 'stdout' | 'stderr', text: string) => void;
  /**
   * The Cascade envelope (cache key, cache mode), for a one-shot stage. It
   * reaches the process as `CASCADE_STAGE_ENVELOPE`, JSON, rather than as an
   * argument, so a project cache keyed on its args is not changed by it.
   */
  readonly cascade?: Readonly<Record<string, unknown>>;
  /** The stage code hash: keys Python's bytecode cache, see `PythonWorker`. */
  readonly codeHash?: string | null;
}

function resolveProjectExecutable(project: ProjectRoot, configuredPath: string): string {
  if (path.isAbsolute(configuredPath)) {
    throw new Error('cascade.json exec.stages.python must be python, python3, or a project-relative executable');
  }
  const executable = path.resolve(project.root, configuredPath);
  const relative = path.relative(project.root, executable);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('cascade.json exec.stages.python must be python, python3, or a project-relative executable');
  }
  return executable;
}

/**
 * Reads exec.stages from cascade.json.
 *
 * Straight from the file rather than through readProjectManifest, which
 * projects the manifest down to its declared settings and drops `exec` —
 * reading it there reports every configured project as having no stages.
 */
export function readStageConfig(project: ProjectRoot): StageConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(project.resolve('cascade.json'), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('Project stages are not configured; add exec.stages to cascade.json');
    }
    throw new Error(`Cannot read cascade.json: ${error instanceof Error ? error.message : String(error)}`);
  }
  const stages = (raw as { exec?: { stages?: unknown } })?.exec?.stages;
  const value = stages && typeof stages === 'object' && !Array.isArray(stages)
    ? stages as Record<string, unknown>
    : null;
  const entrypoint = value && typeof value.entrypoint === 'string' ? value.entrypoint : '';
  if (!entrypoint) {
    throw new Error('Project stages are not configured; add exec.stages.entrypoint to cascade.json');
  }
  // Resolving it here keeps a stage path inside the project, the same check the
  // HTTP route makes.
  project.resolve(entrypoint);
  const worker = typeof value?.worker === 'string' && value.worker ? value.worker : undefined;
  if (value?.worker !== undefined && !worker) {
    throw new Error('cascade.json exec.stages.worker must be a project-relative path');
  }
  if (worker) project.resolve(worker);
  const configuredPython = value?.python;
  let python = 'python3';
  if (configuredPython !== undefined) {
    if (typeof configuredPython !== 'string' || !configuredPython.trim()) {
      throw new Error('cascade.json exec.stages.python must be python, python3, or a project-relative executable');
    }
    const executable = configuredPython.trim();
    python = executable === 'python' || executable === 'python3'
      ? executable
      : resolveProjectExecutable(project, executable);
  }
  const sources = value?.sources;
  if (sources !== undefined && (!Array.isArray(sources) || sources.some((item) => typeof item !== 'string' || !item))) {
    throw new Error('cascade.json exec.stages.sources must be a list of project-relative paths');
  }
  return {
    python,
    entrypoint,
    ...(worker ? { worker } : {}),
    ...(sources ? { sources: sources as string[] } : {}),
    cache: readCachePolicy(value?.cache),
  };
}

function readCachePolicy(value: unknown): StageCachePolicy {
  const strings = (list: unknown, name: string): string[] => {
    if (list === undefined) return [];
    if (!Array.isArray(list) || list.some((item) => typeof item !== 'string')) {
      throw new Error(`cascade.json exec.stages.cache.${name} must be a list of names`);
    }
    return list as string[];
  };
  if (value === undefined) return { enabled: true, scope: 'cook', exclude: [], outputs: [] };
  if (value === false) return { enabled: false, scope: 'cook', exclude: [], outputs: [] };
  if (value === true) return { enabled: true, scope: 'all', exclude: [], outputs: [] };
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (record.scope !== undefined && record.scope !== 'cook' && record.scope !== 'all') {
      throw new Error('cascade.json exec.stages.cache.scope must be "cook" or "all"');
    }
    return {
      enabled: record.enabled !== false,
      scope: record.scope === 'all' ? 'all' : 'cook',
      exclude: strings(record.exclude, 'exclude'),
      outputs: strings(record.outputs, 'outputs'),
    };
  }
  throw new Error('cascade.json exec.stages.cache must be true, false or { exclude, outputs, scope }');
}

/**
 * Invoke one stage and return its parsed result.
 *
 * The dispatcher's answer is the LAST line it printed, so a stage that logs on
 * its way through does not corrupt its own return value — and an `error` field
 * in that answer is raised here, because a stage that reports failure as data
 * would otherwise pass silently.
 */
export async function runProjectStage(
  project: ProjectRoot,
  stage: string,
  args: Record<string, unknown>,
  options: StageRunOptions = {},
): Promise<unknown> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(stage)) {
    throw new Error('stage contains unsupported characters');
  }
  const { python, entrypoint } = readStageConfig(project);
  const script = project.resolve(entrypoint);
  const payload = JSON.stringify(args);
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = execFile(
      python,
      [script, '--stage', stage, '--args', '-'],
      {
        cwd: project.root,
        timeout: options.timeout ?? TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        env: {
          ...(options.env ?? process.env),
          ...(options.cascade ? { CASCADE_STAGE_ENVELOPE: JSON.stringify(options.cascade) } : {}),
          // Python checks a .pyc against the source's size and whole-second
          // mtime, so a quick same-length edit would run the old bytecode.
          ...(options.codeHash ? { PYTHONPYCACHEPREFIX: path.join(os.tmpdir(), 'cascade-pycache', options.codeHash) } : {}),
        },
        signal: options.signal,
      },
      (error, out, err) => {
        if (error) {
          const output = err?.trim() || out.trim().split('\n').pop() || error.message;
          return reject(new Error(`stage "${stage}" failed: ${output}`));
        }
        // On success too, not only on failure. A stage that writes a warning to
        // stderr and then succeeds was silent, which is the case worth hearing
        // about — a failure announces itself anyway.
        if (err?.trim()) options.onOutput?.('stderr', err.trim());
        resolve(out);
      },
    );
    child.stdin?.end(payload);
  });
  /**
   * Everything but the last line is the stage talking, so that is what gets
   * forwarded.
   *
   * Excluding the last line matters: it is the result, and echoing a JSON blob
   * at anyone who asked for verbose output would make the flag useless for the
   * thing it is for.
   */
  if (options.onOutput) {
    const lines = stdout.trim().split('\n');
    const chatter = lines.slice(0, -1).join('\n').trim();
    if (chatter) options.onOutput('stdout', chatter);
  }
  const lastLine = stdout.trim().split('\n').pop() || '{}';
  let parsed: unknown;
  try {
    parsed = JSON.parse(lastLine);
  } catch {
    throw new Error(`stage "${stage}" returned no JSON: ${lastLine.slice(0, 200)}`);
  }
  if (parsed && typeof parsed === 'object' && 'error' in parsed) {
    throw new Error(`stage "${stage}" failed: ${String((parsed as { error: unknown }).error)}`);
  }
  return parsed;
}
