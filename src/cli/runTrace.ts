/**
 * The trace a headless run leaves behind: per run, each node that cooked, how
 * long it took, and every Python stage it called with that call's cache key
 * and cache state.
 *
 * Written to `.cascade/runs/<time>-<graph>.json` in the project, so a run an
 * agent made can be opened afterwards and a stale result is visible as a hit
 * on an old key rather than inferred from timing. The guiding principle in
 * doc/PRODUCTION_READINESS.md asks for exactly this: every headless run leaves
 * a trace with each stage's timing and cache state.
 *
 * The deterministic runtime cooks one node at a time, so a stage call is
 * attributed to the node whose `node:start` came last. That is the same
 * single-lane fact the ambient cook signal in `cascade/stage` relies on.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { StageTrace } from '../../server/src/stageCache.js';
import type { LoadedCascadeGraph } from '../../packages/runtime/src/types.js';

export interface TracedNode {
  readonly id: string;
  readonly module: string;
  ms: number;
  readonly stages: StageTrace[];
}

export interface TracedRun {
  readonly runId: string;
  readonly frame?: number;
  readonly nodes: TracedNode[];
}

export interface RunTraceFile {
  readonly format: 1;
  readonly graph: string;
  readonly startedAt: string;
  readonly cascade: string;
  readonly seed: number;
  readonly runs: readonly TracedRun[];
}

/** One stage call with the node that made it, for `--json` output. */
export interface StageSummary extends StageTrace {
  readonly node: string | null;
}

export class RunTrace {
  private readonly runs: TracedRun[] = [];
  private current: { node: TracedNode; started: number } | null = null;
  /** Stage calls made outside any node (a run with no graph events). */
  private readonly loose: StageTrace[] = [];
  private readonly startedAt = new Date();

  constructor(
    private readonly graphFile: string,
    private readonly cascade: string,
    private readonly seed: number,
  ) {}

  /** Follow one loaded graph's events. Returns the unsubscribe. */
  attach(graph: LoadedCascadeGraph): () => void {
    const modules = new Map(graph.inspect().nodes.map((node) => [node.id, node.moduleId]));
    return graph.subscribe((event) => {
      if (event.type === 'run:start') {
        this.runs.push({ runId: event.runId, frame: graph.getFrame(), nodes: [] });
      } else if (event.type === 'node:start') {
        const run = this.runs[this.runs.length - 1];
        if (!run) return;
        const node: TracedNode = { id: event.nodeId, module: modules.get(event.nodeId) ?? '', ms: 0, stages: [] };
        run.nodes.push(node);
        this.current = { node, started: performance.now() };
      } else if (event.type === 'node:complete' && this.current?.node.id === event.nodeId) {
        this.current.node.ms = Math.round(performance.now() - this.current.started);
        this.current = null;
      }
    });
  }

  /** Record a stage call against the node cooking now. */
  recordStage(trace: StageTrace): void {
    if (this.current) this.current.node.stages.push(trace);
    else this.loose.push(trace);
  }

  /** Every stage call in order, with its node. */
  stages(): StageSummary[] {
    const list: StageSummary[] = [];
    for (const run of this.runs) {
      for (const node of run.nodes) for (const stage of node.stages) list.push({ node: node.id, ...stage });
    }
    for (const stage of this.loose) list.push({ node: null, ...stage });
    return list;
  }

  toJSON(): RunTraceFile {
    return {
      format: 1,
      graph: this.graphFile,
      startedAt: this.startedAt.toISOString(),
      cascade: this.cascade,
      seed: this.seed,
      runs: this.runs,
    };
  }

  /** Write the trace into the project and return its project-relative path. */
  write(projectRoot: string): string {
    const stamp = this.startedAt.toISOString().replace(/[:.]/g, '-');
    const name = `${stamp}-${path.basename(this.graphFile, '.cascade')}.json`;
    const relative = path.posix.join('.cascade', 'runs', name);
    const full = path.join(projectRoot, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, JSON.stringify(this.toJSON(), null, 2) + '\n');
    pruneTraces(path.dirname(full));
    return relative;
  }
}

/** Traces kept per project; the oldest go first. Names sort by time. */
export const KEPT_TRACES = 200;

function pruneTraces(directory: string): void {
  const traces = fs.readdirSync(directory).filter((name) => name.endsWith('.json')).sort();
  for (const name of traces.slice(0, Math.max(0, traces.length - KEPT_TRACES))) {
    fs.rmSync(path.join(directory, name), { force: true });
  }
}
