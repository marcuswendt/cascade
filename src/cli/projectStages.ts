/**
 * The headless stage bridge: a node importing `cascade/stage` posts to the
 * server in the page and lands here in a headless run, so one Python-backed
 * node renders either way.
 *
 * Every call goes through `callStage`, the same core cache key and trace the
 * Studio route uses, so a headless run reports its cache hits and misses in
 * the same words as the server log.
 *
 * **One warm worker per run.** When the project declares `exec.stages.worker`,
 * a headless run uses it exactly as Studio does: one Python process for the
 * whole run, every frame, with the code-hash restart. Until 12 Oct every stage
 * call on every frame started a fresh interpreter (`node_cli.py --stage`),
 * which re-imported torch and reloaded models each time: about 7 s a frame,
 * and 12.5 min for the 483-frame morph. Projects without a worker, and callers
 * that ask for fresh processes (`cascade parity`, which must see what a cold
 * process draws), keep the one-shot path.
 */
import { installStageBridge } from '../../server/src/runtime/stage.js';
import { callStage, type StageTrace } from '../../server/src/stageCache.js';
import { readStageConfig, runProjectStage } from '../../server/src/stageRunner.js';
import { PythonWorker } from '../../server/src/pythonWorker.js';
import { stageSources } from '../../server/src/stageCache.js';
import type { ProjectRoot } from '../../server/src/project.js';

export interface ProjectStageOptions {
  /** Forward what a stage prints on success, prefixed with its name. */
  readonly verbose?: boolean;
  /** Receives the trace of every stage call. */
  readonly onTrace?: (trace: StageTrace) => void;
  /** Use the project's warm worker when it declares one. Default true. */
  readonly worker?: boolean;
}

/** Install the bridge; returns the disposer. */
export function installProjectStages(project: ProjectRoot, options: ProjectStageOptions = {}): () => void {
  let worker: { key: string; process: PythonWorker } | null = null;
  const warmWorker = (config: ReturnType<typeof readStageConfig>): PythonWorker | null => {
    if (options.worker === false || !config.worker) return null;
    const sources = stageSources(project, config);
    const key = `${config.python}\0${config.worker}\0${sources.roots.join('\0')}`;
    if (worker?.key !== key) {
      worker?.process.shutdown();
      worker = {
        key,
        process: new PythonWorker(project, config.worker, config.python, process.env, {
          sources,
          // The one-shot path's bound, not Studio's two minutes: an offline
          // render may run a stage for several.
          requestTimeoutMs: 10 * 60 * 1000,
          // What a stage prints is shown with --verbose only, as before.
          onStderr: options.verbose
            ? (text) => { for (const line of text.split('\n')) console.warn(`[stage-worker] ${line}`); }
            : () => {},
        }),
      };
    }
    return worker.process;
  };

  const dispose = installStageBridge(async (stage, args, callOptions) => {
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
        onOutput: options.verbose
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
    worker?.process.shutdown();
    worker = null;
  };
}
