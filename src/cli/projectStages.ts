/**
 * The headless stage bridge: a node importing `cascade/stage` posts to the
 * server in the page and lands here in a headless run, so one Python-backed
 * node renders either way.
 *
 * Every call goes through `callStage`, the same core cache key and trace the
 * Studio route uses, so a headless run reports its cache hits and misses in
 * the same words as the server log.
 *
 * **A small pool of warm workers per run.** When the project declares
 * `exec.stages.worker`, a headless run uses it as Studio does: warm Python
 * processes kept for the whole run, every frame, with the code-hash restart.
 * Since round 2 of the performance work (7 Nov) the run keeps up to
 * `stageWorkerCount` of them (2–4 by default, grown only when a call finds
 * every one busy) and cooks that many independent nodes at once, so a
 * frame's sibling stage calls overlap. Until 12 Oct every stage
 * call on every frame started a fresh interpreter (`node_cli.py --stage`),
 * which re-imported torch and reloaded models each time: about 7 s a frame,
 * and 12.5 min for the 483-frame morph. Projects without a worker, and callers
 * that ask for fresh processes (`cascade parity`, which must see what a cold
 * process draws), keep the one-shot path.
 */
import { installStageBridge } from '../../server/src/runtime/stage.js';
import { callStage, type StageTrace } from '../../server/src/stageCache.js';
import { readStageConfig, runProjectStage } from '../../server/src/stageRunner.js';
import { defaultStageWorkerCount, PythonWorker, PythonWorkerPool } from '../../server/src/pythonWorker.js';
import { stageSources } from '../../server/src/stageCache.js';
import type { ProjectRoot } from '../../server/src/project.js';
import { settleProjectImages } from './headlessIo.js';

export interface ProjectStageOptions {
  /** Forward what a stage prints on success, prefixed with its name. */
  readonly verbose?: boolean;
  /** Receives the trace of every stage call. */
  readonly onTrace?: (trace: StageTrace) => void;
  /** Use the project's warm worker when it declares one. Default true. */
  readonly worker?: boolean;
  /**
   * Receives what a stage prints, one line at a time (`stage` is null for the
   * warm worker, which serves every stage). Set, it replaces the `verbose`
   * printing; the run uses it to put stage output in the trace.
   */
  readonly onOutput?: (stage: string | null, stream: 'stdout' | 'stderr', line: string) => void;
  /**
   * Start the project's warm worker now instead of at the first stage call.
   * `cascade render` workers do, so the Python start (seconds, for a project
   * importing torch) overlaps the probe frames instead of following them.
   */
  readonly prewarm?: boolean;
  /**
   * Warm workers to keep, overriding the configured or machine-sized count
   * (`stageWorkerCount`). `cascade render` workers pass 1.
   */
  readonly poolSize?: number;
}

/**
 * How many warm workers this run keeps: `poolSize` when the caller fixes it
 * (a `cascade render` worker uses 1: the render already runs a process per
 * core), else `CASCADE_STAGE_WORKERS`, else `cascade.json`
 * `exec.stages.workers`, else sized from the machine (2–4).
 */
export function stageWorkerCount(config: { workers?: number }, poolSize?: number): number {
  if (poolSize !== undefined) return Math.max(1, Math.floor(poolSize));
  const fromEnv = Number(process.env.CASCADE_STAGE_WORKERS);
  if (Number.isInteger(fromEnv) && fromEnv >= 1) return fromEnv;
  return config.workers ?? defaultStageWorkerCount();
}

const LANES_KEY = '__cascadeStageLanes';

/**
 * How many nodes a headless run should cook at once: the stage pool's size
 * while a bridge with a warm worker is installed, else 1. Nodes overlap only
 * where they wait on Python; a graph of JS nodes keeps cooking one at a time,
 * so its trace's node timings stay its own.
 */
export function installedStageLanes(): number {
  const lanes = (globalThis as Record<string, unknown>)[LANES_KEY];
  return typeof lanes === 'number' && lanes > 1 ? lanes : 1;
}

/** Install the bridge; returns the disposer. */
export function installProjectStages(project: ProjectRoot, options: ProjectStageOptions = {}): () => void {
  let worker: { key: string; process: PythonWorkerPool } | null = null;
  const warmWorker = (config: ReturnType<typeof readStageConfig>): PythonWorkerPool | null => {
    if (options.worker === false || !config.worker) return null;
    const entrypoint = config.worker;
    const sources = stageSources(project, config);
    const size = stageWorkerCount(config, options.poolSize);
    const key = `${config.python}\0${entrypoint}\0${sources.roots.join('\0')}\0${size}`;
    if (worker?.key !== key) {
      worker?.process.shutdown();
      worker = {
        key,
        process: new PythonWorkerPool(size, () => new PythonWorker(project, entrypoint, config.python, process.env, {
          sources,
          // The one-shot path's bound, not Studio's two minutes: an offline
          // render may run a stage for several.
          requestTimeoutMs: 10 * 60 * 1000,
          // What a stage prints is shown with --verbose only, as before.
          onStderr: options.onOutput
            ? (text) => { for (const line of text.split('\n')) options.onOutput!(null, 'stderr', line); }
            : options.verbose
              ? (text) => { for (const line of text.split('\n')) console.warn(`[stage-worker] ${line}`); }
              : () => {},
        })),
      };
    }
    return worker.process;
  };

  const globals = globalThis as Record<string, unknown>;
  const previousLanes = globals[LANES_KEY];
  try {
    const config = readStageConfig(project);
    globals[LANES_KEY] = options.worker === false || !config.worker ? 1 : stageWorkerCount(config, options.poolSize);
  } catch {
    globals[LANES_KEY] = 1; // stages not configured: nothing to overlap
  }

  if (options.prewarm) {
    // A project without stages, or with no worker, has nothing to warm.
    try { warmWorker(readStageConfig(project))?.warm(); }
    catch { /* stages not configured: the first call says so */ }
  }

  const dispose = installStageBridge(async (stage, args, callOptions) => {
    // Python reads image paths as files: an image still held in memory and
    // being written behind is on disk before the stage, or the cache key, sees it.
    await settleProjectImages(project);
    // Read per call, as the server does, so an edit to cascade.json applies.
    const config = readStageConfig(project);
    const warm = warmWorker(config);
    if (warm) {
      const { result } = await callStage(project, config, stage, args, (envelope) =>
        warm.callWithMeta(stage, args, { signal: callOptions?.signal, cascade: envelope }), { onTrace: options.onTrace });
      return result;
    }
    const { result } = await callStage(project, config, stage, args, async (envelope) => ({
      result: await runProjectStage(project, stage, args, {
        // A superseded cook kills its subprocess rather than waiting for it.
        signal: callOptions?.signal,
        cascade: envelope,
        codeHash: envelope.code,
        /**
         * A stage can log, and until 0.8 nobody could read it: `stderr` was
         * consulted only on failure and `stdout` only for its last line. Behind
         * `--verbose`, because a stage that prints per mark would bury the
         * render it is part of; prefixed with the stage name, because a graph
         * runs several.
         */
        onOutput: options.onOutput
          ? (stream, text) => { for (const line of text.split('\n')) options.onOutput!(stage, stream, line); }
          : options.verbose
          ? (stream, text) => {
              const write = stream === 'stderr' ? console.warn : console.log;
              for (const line of text.split('\n')) write(`[${stage}] ${line}`);
            }
          : undefined,
      }),
    }), { onTrace: options.onTrace });
    return result;
  });
  return () => {
    dispose();
    globals[LANES_KEY] = previousLanes;
    worker?.process.shutdown();
    worker = null;
  };
}
