/**
 * The headless stage bridge: a node importing `cascade/stage` posts to the
 * server in the page and lands here in a headless run, so one Python-backed
 * node renders either way.
 *
 * Every call goes through `callStage`, the same core cache key and trace the
 * Studio route uses, so a headless run reports its cache hits and misses in
 * the same words as the server log.
 */
import { installStageBridge } from '../../server/src/runtime/stage.js';
import { callStage, type StageTrace } from '../../server/src/stageCache.js';
import { readStageConfig, runProjectStage } from '../../server/src/stageRunner.js';
import type { ProjectRoot } from '../../server/src/project.js';

export interface ProjectStageOptions {
  /** Forward what a stage prints on success, prefixed with its name. */
  readonly verbose?: boolean;
  /** Receives the trace of every stage call. */
  readonly onTrace?: (trace: StageTrace) => void;
}

/** Install the bridge; returns the disposer. */
export function installProjectStages(project: ProjectRoot, options: ProjectStageOptions = {}): () => void {
  return installStageBridge(async (stage, args, callOptions) => {
    // Read per call, as the server does, so an edit to cascade.json applies.
    const config = readStageConfig(project);
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
}
