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
 * A headless run may cook several nodes at once (a stage pool, round 2), so a
 * stage call or a printed line is attributed to the node whose cook it came
 * from through `cookingNode`, which the runtime's `nodeScope` sets around each
 * node's execute. Without it (a runtime that does not set the scope) the node
 * whose `node:start` came last is used, which is right for a serial run.
 * Nodes start in topological order either way, so entries are in that order.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import type { StageTrace } from '../../server/src/stageCache.js';
import type { LoadedCascadeGraph } from '../../packages/runtime/src/types.js';

export interface TracedNode {
  readonly id: string;
  readonly module: string;
  ms: number;
  readonly stages: StageTrace[];
  /** What the node printed while it cooked (console, and its stages' stdout/stderr). Absent when nothing. */
  logs?: LogLine[];
  /** Lines past `MAX_NODE_LOGS`, counted rather than kept. */
  logsDropped?: number;
}

export interface LogLine {
  /** `log`, `info`, `warn`, `error`, `debug`, or `stdout`/`stderr` for a Python stage. */
  readonly level: string;
  readonly text: string;
}

/** One logged line with its node, for `--json` output. */
export interface LogSummary extends LogLine {
  readonly node: string;
}

/** Lines kept per node and per line, so a node printing per mark cannot bloat the trace. */
export const MAX_NODE_LOGS = 500;
export const MAX_LOG_LINE = 2000;

export interface TracedRun {
  readonly runId: string;
  readonly frame?: number;
  /** The cook, `run:start` to `run:complete`: every node plus the runtime's own time. */
  ms?: number;
  /**
   * The whole frame, cook to outputs on disk, and of that the part after the
   * cook (collecting and saving the outputs). Round 2 needed a profiler to
   * find that a PNG encode was half of every frame; this is where it shows.
   */
  frameMs?: number;
  saveMs?: number;
  readonly nodes: TracedNode[];
}

export interface RunTraceFile {
  readonly format: 1;
  readonly graph: string;
  readonly startedAt: string;
  readonly cascade: string;
  readonly seed: number;
  /** Names of the variables `--env` set for this run. */
  readonly env?: readonly string[];
  readonly runs: readonly TracedRun[];
}

/** One stage call with the node that made it, for `--json` output. */
export interface StageSummary extends StageTrace {
  readonly node: string | null;
}

/** The id of the node whose cook the current async work belongs to. */
export const cookingNode = new AsyncLocalStorage<string>();

/** `CreateRuntimeOptions.nodeScope` for a headless run: see `cookingNode`. */
export function traceNodeScope<T>(nodeId: string, run: () => T): T {
  return cookingNode.run(nodeId, run);
}

export class RunTrace {
  private readonly runs: TracedRun[] = [];
  private current: { node: TracedNode; started: number } | null = null;
  /** Nodes of the latest run still cooking, by id. */
  private readonly cooking = new Map<string, { node: TracedNode; started: number }>();

  /** The node a stage call or log line belongs to. */
  private owner(): TracedNode | undefined {
    const id = cookingNode.getStore();
    if (id !== undefined) {
      const scoped = this.cooking.get(id)?.node;
      if (scoped) return scoped;
    }
    return this.current?.node;
  }
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
        this.runStarted = performance.now();
      } else if (event.type === 'run:complete') {
        const run = this.runs[this.runs.length - 1];
        if (run && this.runStarted !== null) run.ms = Math.round(performance.now() - this.runStarted);
        this.runStarted = null;
      } else if (event.type === 'node:start') {
        const run = this.runs[this.runs.length - 1];
        if (!run) return;
        const node: TracedNode = { id: event.nodeId, module: modules.get(event.nodeId) ?? '', ms: 0, stages: [] };
        run.nodes.push(node);
        this.current = { node, started: performance.now() };
        this.cooking.set(event.nodeId, this.current);
      } else if (event.type === 'node:complete') {
        const cooking = this.cooking.get(event.nodeId);
        if (!cooking) return;
        cooking.node.ms = Math.round(performance.now() - cooking.started);
        this.cooking.delete(event.nodeId);
        if (this.current === cooking) this.current = null;
      }
    });
  }

  private runStarted: number | null = null;

  /**
   * The latest run's whole frame took `frameMs`, its outputs saved: what is
   * left after the cook is the save. Called by the frame loop per frame and
   * once by a still run.
   */
  recordSaved(frameMs: number): void {
    const run = this.runs[this.runs.length - 1];
    if (!run) return;
    run.frameMs = Math.round(frameMs);
    if (run.ms !== undefined) run.saveMs = Math.max(0, run.frameMs - run.ms);
  }

  /** Record a stage call against the node cooking now. */
  recordStage(trace: StageTrace): void {
    const node = this.owner();
    if (node) node.stages.push(trace);
    else this.loose.push(trace);
  }

  /**
   * Record a line printed while a node cooks, against that node. Returns
   * false when no node is cooking, so the caller leaves the line alone (the
   * CLI's own messages are not node output).
   */
  recordLog(level: string, text: string): boolean {
    const node = this.owner();
    if (!node) return false;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      node.logs ??= [];
      if (node.logs.length >= MAX_NODE_LOGS) {
        node.logsDropped = (node.logsDropped ?? 0) + 1;
        continue;
      }
      node.logs.push({ level, text: line.length > MAX_LOG_LINE ? `${line.slice(0, MAX_LOG_LINE)}…` : line });
    }
    return true;
  }

  /** Every logged line in order, with its node. */
  logs(): LogSummary[] {
    return this.runs.flatMap((run) => run.nodes.flatMap((node) => (node.logs ?? []).map((line) => ({ node: node.id, ...line }))));
  }

  /** The names (never the values) of variables `--env` set, for the trace. */
  setEnvNames(names: readonly string[]): void {
    this.envNames = [...names];
  }

  private envNames: string[] = [];

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
      ...(this.envNames.length ? { env: this.envNames } : {}),
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

const CONSOLE_LEVELS = ['log', 'info', 'warn', 'error', 'debug'] as const;

/**
 * Copy what nodes print into the trace while they cook, and pass it on as
 * before. A node's `console.log` used to reach the terminal only, which is
 * gone by the time an agent opens the trace, and under `--json` was mixed
 * into `warnings`. Returns the restore.
 */
export function captureNodeConsole(trace: RunTrace): () => void {
  const original = Object.fromEntries(CONSOLE_LEVELS.map((level) => [level, console[level]])) as Record<(typeof CONSOLE_LEVELS)[number], (...args: unknown[]) => void>;
  for (const level of CONSOLE_LEVELS) {
    console[level] = (...args: unknown[]) => {
      trace.recordLog(level, args.map((arg) => (typeof arg === 'string' ? arg : arg instanceof Error ? arg.stack ?? arg.message : safeJson(arg))).join(' '));
      original[level](...args);
    };
  }
  return () => {
    for (const level of CONSOLE_LEVELS) console[level] = original[level];
  };
}

function safeJson(value: unknown): string {
  try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
}

/** Traces kept per project; the oldest go first. Names sort by time. */
export const KEPT_TRACES = 200;

function pruneTraces(directory: string): void {
  const traces = fs.readdirSync(directory).filter((name) => name.endsWith('.json')).sort();
  for (const name of traces.slice(0, Math.max(0, traces.length - KEPT_TRACES))) {
    fs.rmSync(path.join(directory, name), { force: true });
  }
}
