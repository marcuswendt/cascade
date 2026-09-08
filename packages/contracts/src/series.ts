import type { CascadePreset } from "./document.js";

/**
 * A series: one system, many instances.
 *
 * **A series is a graph plus an ordered list of parameter sets, and nothing
 * else.** Plan: `Work/Projects/Cascade/plans/PLAN series.md`. The definition is
 * deliberately this thin, because the alternative is the trap the plan names —
 * *the series must not become a second document format.* If it grows its own
 * copy of node state it forks from the graph and the two disagree.
 *
 * So there is no boundary in it. Houdini marks a region because the varying
 * thing flows through the region as geometry; here the varying thing is a
 * sparse map of parameter overrides keyed by node id, so the affected subgraph
 * is **derived** from those overrides by the dependency graph that already
 * exists. Nothing is marked, so nothing can be marked wrongly. That is also
 * why `Block Begin`/`Block End` are not copied: they exist to serve feedback,
 * a series has none, and the form without the feedback is all cost.
 */
export interface CascadeSeries {
  readonly version: 1;
  /**
   * Ordered, and ordered on purpose.
   *
   * Independent instances do not need an order, which makes a bag tempting.
   * But feedback — instance N reading N-1 — needs a sequence, and retrofitting
   * order onto something built unordered is the expensive kind of change.
   * Ordered costs nothing today. Marcus, 2026-09-08: *"feedback will at some
   * point be useful but maybe not this series."*
   */
  readonly instances: readonly CascadeSeriesInstance[];
  /** Which output the series collects, one value per instance. */
  readonly collect: SeriesCollection;
}

export interface CascadeSeriesInstance {
  /**
   * **The record's own id, never its index in the array.**
   *
   * The decision the plan says to make before anything is built. A set reorders
   * the moment a filter changes or data arrives, so a judgement pinned to a
   * position — a favourite, an override, a note — silently becomes a different
   * picture. For the Observatory this is the moment's id; for a wedge, the
   * parameter tuple; for a hand-written list, whatever the author typed.
   */
  readonly id: string;
  /** This instance's overrides. `CascadePreset` already is a parameter set. */
  readonly parameters: CascadePreset;
  /** For display. Never an address — see `id`. */
  readonly label?: string;
}

/**
 * Either a graph output by name, or any node's output port.
 *
 * Both, for the same reason subnets stay an ordinary tool rather than the
 * mechanism: requiring a `cascade.core.Output` node would mean restructuring an
 * existing graph before it could be a series, and `cloud-volumes` is exactly
 * that case.
 */
export type SeriesCollection =
  | { readonly graphOutput: string }
  | { readonly nodeId: string; readonly output: string };

/** One instance's result. `status` is the run's, so a failed instance is
 *  reported rather than dropped — a series that silently renders 9,998 of
 *  10,000 is worse than one that says which two failed. */
export interface SeriesInstanceResult {
  readonly id: string;
  readonly index: number;
  readonly status: "completed" | "cancelled" | "failed";
  readonly value: unknown;
  readonly diagnostics: readonly unknown[];
  readonly durationMs: number;
}
