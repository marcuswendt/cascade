import type {
  CascadeAbortSignal,
  CascadePreset,
  CascadeSeries,
  SeriesCollection,
  SeriesInstanceResult,
} from "@cascade/contracts";

import type { LoadedCascadeGraph } from "../types.js";

/**
 * Cooking a graph once per parameter set.
 *
 * Step 1 of `PLAN series.md`, and headless on purpose: it is the foundation the
 * gallery and the scheduler stand on, and it is verifiable without a picture.
 *
 * **The whole difficulty is that a parameter set is sparse.** `applyPreset`
 * mutates the runtime, and instance 3 overriding `seed` while instance 4 does
 * not means instance 4 inherits instance 3's seed unless something puts it
 * back. That is accidental feedback — in the one mechanism specified as having
 * none — and it would show up as a series where the pictures are subtly wrong
 * in an order-dependent way, which is close to the worst failure this system
 * could have: re-run it and the same instance renders differently, so it reads
 * as a flaky renderer rather than as a bug.
 *
 * So every instance is cooked from the same baseline. The baseline is itself a
 * `CascadePreset`, holding the graph's current value for **every key any
 * instance touches** — the union, computed once — which means restoring is the
 * same validated code path as applying, rather than a second one that can
 * disagree with it.
 */

/** Every `node.input` and `node.prop` any instance in the series overrides. */
function overriddenKeys(series: CascadeSeries): Map<string, { inputs: Set<string>; props: Set<string> }> {
  const keys = new Map<string, { inputs: Set<string>; props: Set<string> }>();
  for (const instance of series.instances) {
    for (const [nodeId, values] of Object.entries(instance.parameters.nodes)) {
      let entry = keys.get(nodeId);
      if (!entry) {
        entry = { inputs: new Set(), props: new Set() };
        keys.set(nodeId, entry);
      }
      for (const name of Object.keys(values.inputs ?? {})) entry.inputs.add(name);
      for (const name of Object.keys(values.props ?? {})) entry.props.add(name);
    }
  }
  return keys;
}

/**
 * The graph's current values for those keys, as a preset.
 *
 * Read through `inspect()` rather than from the nodes directly, so the values
 * are the same snapshots every other reader gets. A key the graph does not
 * have is left out rather than defaulted: `applyPreset` is the thing that
 * decides an unknown key is a misuse, and it should keep deciding that.
 */
export function seriesBaseline(graph: LoadedCascadeGraph, series: CascadeSeries): CascadePreset {
  const wanted = overriddenKeys(series);
  const inspection = graph.inspect();
  const nodes: Record<string, { inputs?: Record<string, never>; props?: Record<string, never> }> = {};

  for (const node of inspection.nodes) {
    const entry = wanted.get(node.id);
    if (!entry) continue;
    const inputs: Record<string, unknown> = {};
    const props: Record<string, unknown> = {};
    for (const name of entry.inputs) {
      if (node.inputs[name] !== undefined) inputs[name] = node.inputs[name].value;
    }
    for (const name of entry.props) {
      if (node.props[name] !== undefined) props[name] = node.props[name].value;
    }
    if (Object.keys(inputs).length > 0 || Object.keys(props).length > 0) {
      nodes[node.id] = {
        ...(Object.keys(inputs).length > 0 ? { inputs } : {}),
        ...(Object.keys(props).length > 0 ? { props } : {}),
      } as never;
    }
  }

  return { version: 1, nodes } as CascadePreset;
}

export interface RunSeriesOptions {
  readonly signal?: CascadeAbortSignal;
  readonly frame?: number;
  readonly fps?: number;
  /**
   * The instance to cook first, by id.
   *
   * *"Making changes to the underlying network re-renders the current selected
   * item first then the entire series."* The order of the results is always the
   * series' own order whatever this says — only the order of the **work**
   * changes, because the caller is watching one instance and waiting for a
   * list would defeat the point.
   */
  readonly first?: string;
  /** Called as each instance finishes, in cook order rather than list order,
   *  so a gallery can fill in as results arrive instead of after all of them. */
  readonly onInstance?: (result: SeriesInstanceResult) => void;
}

export interface SeriesRunResult {
  /** In the series' own order, whatever order the work ran in. */
  readonly instances: readonly SeriesInstanceResult[];
  /** By record id, which is the address everything downstream uses. */
  readonly byId: ReadonlyMap<string, SeriesInstanceResult>;
  readonly status: "completed" | "cancelled" | "failed";
}

/** Ids must be unique, or an instance has no address at all — and every
 *  judgement, override and cache key in the plan hangs off that address. */
export function validateSeries(series: CascadeSeries): void {
  if (series.version !== 1) {
    throw new Error("Series version must be 1");
  }
  const seen = new Set<string>();
  for (const instance of series.instances) {
    if (!instance.id) throw new Error("Every series instance needs an id");
    if (seen.has(instance.id)) {
      throw new Error(`Duplicate series instance id ${instance.id}`);
    }
    seen.add(instance.id);
  }
}

function collect(graph: LoadedCascadeGraph, collection: SeriesCollection): unknown {
  return "graphOutput" in collection
    ? graph.getGraphOutput(collection.graphOutput)
    : graph.getOutput(collection.nodeId, collection.output);
}

/** The cook order: the selected instance, then the rest in the series' order. */
function cookOrder(series: CascadeSeries, first: string | undefined): number[] {
  const order = series.instances.map((_, index) => index);
  if (first === undefined) return order;
  const selected = series.instances.findIndex(instance => instance.id === first);
  if (selected < 0) return order;
  return [selected, ...order.filter(index => index !== selected)];
}

export async function runSeries(
  graph: LoadedCascadeGraph,
  series: CascadeSeries,
  options: RunSeriesOptions = {},
): Promise<SeriesRunResult> {
  validateSeries(series);

  // Before the first `applyPreset` and not after, or the baseline is already
  // instance one's.
  const baseline = seriesBaseline(graph, series);
  const results = new Array<SeriesInstanceResult>(series.instances.length);
  let cancelled = false;

  try {
    for (const index of cookOrder(series, options.first)) {
      if (options.signal?.aborted) {
        cancelled = true;
        break;
      }
      const instance = series.instances[index]!;

      // Baseline first, every time. A sparse set does not clear what the
      // previous instance changed, and inheriting it is accidental feedback.
      await graph.applyPreset(baseline);
      await graph.applyPreset(instance.parameters);

      const run = await graph.run({
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.frame === undefined ? {} : { frame: options.frame }),
        ...(options.fps === undefined ? {} : { fps: options.fps }),
      });

      const result: SeriesInstanceResult = {
        id: instance.id,
        index,
        status: run.status,
        // A run that did not complete has no value worth collecting, and
        // reading the port anyway would hand back the previous instance's
        // picture under this instance's id.
        value: run.status === "completed" ? collect(graph, series.collect) : undefined,
        diagnostics: run.diagnostics,
        durationMs: run.timings.durationMs,
      };
      results[index] = result;
      options.onInstance?.(result);
      if (run.status === "cancelled") {
        cancelled = true;
        break;
      }
    }
  } finally {
    // Leave the graph as it was found. A series is a way of looking at a graph,
    // not an edit to it, and a Studio session that ran one and was left on the
    // last instance's parameters would be indistinguishable from one the author
    // had changed by hand.
    await graph.applyPreset(baseline);
  }

  const completed = results.filter((result): result is SeriesInstanceResult => Boolean(result));
  const status = cancelled
    ? "cancelled"
    : completed.some(result => result.status === "failed")
      ? "failed"
      : "completed";

  return {
    instances: completed,
    byId: new Map(completed.map(result => [result.id, result])),
    status,
  };
}
