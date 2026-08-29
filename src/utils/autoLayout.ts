/**
 * Top-to-bottom graph layout.
 *
 * Cascade draws a node's inputs along its top edge and its outputs along its
 * bottom, so a graph reads cleanly when it flows downward: every wire leaves the
 * bottom of one node and arrives at the top of the next, and none of them has to
 * turn back on itself. Laid out left to right, the same graph forces each wire
 * through a right angle and they cross far more.
 *
 * Layered, in five passes:
 *
 *  1. RANK — each node sits one level below its deepest input, so a wire always
 *     points down and never sideways within a layer.
 *  2. TIGHTEN — a node with no consumer until far below is pulled down to just
 *     above the first of them. Longest-path ranking puts everything as early as
 *     it can go, which strands a node near the top trailing one long wire past
 *     everything in between.
 *  3. ROUTE — an edge spanning more than one layer is broken into a chain of
 *     placeholders, one per layer it crosses. This is the pass that was missing,
 *     and it does two things at once: the ordering below finally sees the long
 *     edge instead of ignoring it, and the placement reserves a lane for it, so
 *     it runs BETWEEN the nodes it passes rather than straight over them.
 *  4. ORDER — within a layer, nodes are sorted by the average position of the
 *     nodes they connect to (the barycentre heuristic). Repeated a few times,
 *     alternating direction, which is what actually removes crossings.
 *  5. PLACE — measured against the widest layer so the result is centred rather
 *     than ragged, with column spacing scaled to how wide a node can get. Then
 *     a straightening sweep pulls each node toward the average of what it
 *     connects to, as far as its neighbours allow, so a chain runs down the
 *     page instead of stepping side to side.
 *
 * Measured on the two real graphs this was built against, cloud-plots (21
 * nodes, 37 edges) and cloud-posters (23, 35). See the numbers in the commit.
 */

export interface LayoutNode {
  id: string;
  position: { x: number; y: number } | number[];
  inputs?: Array<{ connections?: unknown[] }>;
  outputs?: Array<{ connections?: unknown[] }>;
}

export interface LayoutEdge {
  from: string;
  to: string;
}

export interface LayoutOptions {
  /** Horizontal gap between neighbouring nodes in a layer. */
  columnGap?: number;
  /**
   * Rendered width per node id, measured from the DOM.
   *
   * Nodes are not a uniform size: one with fourteen ports or a variadic list is
   * several times wider than a plain one, and spacing every column by a fixed
   * pitch made those overlap their neighbours. Widths are optional — without
   * them the fixed pitch is used, which is right for a graph that has not been
   * rendered yet.
   */
  widths?: Map<string, number>;
  /** Vertical gap between layers. Generous by default: the wires are what the
   *  reader follows, and they need room to fan out. */
  rowGap?: number;
  originX?: number;
  originY?: number;
}

/** Marks a routing placeholder. Never appears in the returned positions. */
const PLACEHOLDER_PREFIX = '\u0000lane:';

/** How much room a long wire is given to pass through a row. Narrow — it is a
 *  lane for one wire, not a node — but not zero, or the wire is back on top of
 *  its neighbours. */
const PLACEHOLDER_WIDTH = 28;

const DEFAULTS: Required<Omit<LayoutOptions, 'widths'>> = {
  columnGap: 260,
  rowGap: 190,
  originX: 40,
  originY: 40,
};

/**
 * Compute positions. Pure: it returns a map of id to position and touches
 * nothing, so the same function serves the editor's button and an offline
 * rewrite of a .cascade file.
 */
export function layoutTopDown(
  nodeIds: string[],
  edges: LayoutEdge[],
  options: LayoutOptions = {}
): Map<string, { x: number; y: number }> {
  const { columnGap, rowGap, originX, originY } = { ...DEFAULTS, ...options };
  const widths = options.widths;
  const widthOf = (id: string) => widths?.get(id) ?? columnGap - 60;

  const upstream = new Map<string, string[]>();
  const downstream = new Map<string, string[]>();
  for (const id of nodeIds) {
    upstream.set(id, []);
    downstream.set(id, []);
  }
  for (const edge of edges) {
    if (!upstream.has(edge.to) || !downstream.has(edge.from)) continue;
    upstream.get(edge.to)!.push(edge.from);
    downstream.get(edge.from)!.push(edge.to);
  }

  // --- 1. rank ---------------------------------------------------------
  const rank = new Map<string, number>();
  const visiting = new Set<string>();

  function rankOf(id: string): number {
    const known = rank.get(id);
    if (known !== undefined) return known;
    // A cycle would otherwise recurse forever. Graphs here are acyclic, but a
    // layout routine that hangs on a malformed graph is worse than one that
    // lays it out imperfectly.
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const parents = upstream.get(id) ?? [];
    const value = parents.length ? Math.max(...parents.map(rankOf)) + 1 : 0;
    visiting.delete(id);
    rank.set(id, value);
    return value;
  }
  nodeIds.forEach(rankOf);

  // --- 2. tighten ------------------------------------------------------
  /**
   * Longest-path ranking places every node as early as its inputs allow, which
   * is right for the spine and wrong for anything hanging off it: a node whose
   * only consumer is eight layers down sits at the top, trailing one wire past
   * everything between. Pull it down to just above its first consumer, but
   * never above its own deepest input.
   *
   * Repeated until nothing moves — one node dropping can free the one that
   * feeds it. Bounded, because a graph with a cycle must not spin here.
   */
  for (let pass = 0; pass < nodeIds.length && pass < 32; pass++) {
    let moved = false;
    for (const id of nodeIds) {
      const consumers = downstream.get(id) ?? [];
      if (!consumers.length) continue;
      const parents = upstream.get(id) ?? [];
      const floor = parents.length ? Math.max(...parents.map(p => rank.get(p) ?? 0)) + 1 : 0;
      const ceiling = Math.min(...consumers.map(c => rank.get(c) ?? 0)) - 1;
      const wanted = Math.max(floor, ceiling);
      if (wanted > (rank.get(id) ?? 0)) {
        rank.set(id, wanted);
        moved = true;
      }
    }
    if (!moved) break;
  }

  const layers: string[][] = [];
  for (const id of nodeIds) {
    const r = rank.get(id) ?? 0;
    while (layers.length <= r) layers.push([]);
    layers[r].push(id);
  }

  // --- 3. route --------------------------------------------------------
  /**
   * Every edge that skips a layer gets a placeholder in each layer it crosses,
   * and the edge becomes a chain of one-layer hops through them. The
   * placeholders are ordered and placed exactly like nodes and then thrown
   * away — what they leave behind is a gap in each row where the long wire can
   * run, instead of a wire drawn over whatever happened to be in the way.
   *
   * This is the standard Sugiyama dummy-vertex step, and leaving it out is
   * what made a big graph look like a tangle: the ordering pass could not see
   * a long edge at all, so it optimised the short ones and let the long ones
   * fall where they may.
   */
  const isPlaceholder = (id: string) => id.startsWith(PLACEHOLDER_PREFIX);
  const up = new Map<string, string[]>(upstream);
  const down = new Map<string, string[]>(downstream);

  edges.forEach((edge, index) => {
    const from = rank.get(edge.from);
    const to = rank.get(edge.to);
    if (from === undefined || to === undefined || to - from <= 1) return;

    // Replace the direct link with the chain.
    up.set(edge.to, (up.get(edge.to) ?? []).filter(id => id !== edge.from));
    down.set(edge.from, (down.get(edge.from) ?? []).filter(id => id !== edge.to));

    let previous = edge.from;
    for (let r = from + 1; r < to; r++) {
      const id = `${PLACEHOLDER_PREFIX}${index}:${r}`;
      layers[r].push(id);
      up.set(id, [previous]);
      down.set(id, []);
      down.set(previous, [...(down.get(previous) ?? []), id]);
      previous = id;
    }
    down.set(previous, [...(down.get(previous) ?? []), edge.to]);
    up.set(edge.to, [...(up.get(edge.to) ?? []), previous]);
  });

  // Stable starting order, so the result doesn't depend on object key order.
  layers.forEach(layer => layer.sort());

  // --- 4. order --------------------------------------------------------
  const indexIn = (layer: string[], id: string) => layer.indexOf(id);

  function sortByBarycentre(layer: string[], reference: string[], relation: Map<string, string[]>) {
    const score = new Map<string, number>();
    layer.forEach((id, fallback) => {
      const linked = (relation.get(id) ?? []).map(other => indexIn(reference, other)).filter(i => i >= 0);
      score.set(id, linked.length ? linked.reduce((a, b) => a + b, 0) / linked.length : fallback);
    });
    layer.sort((a, b) => (score.get(a)! - score.get(b)!) || a.localeCompare(b));
  }

  /** Crossings between two adjacent rows, counted from the order alone. */
  function crossingsBetween(upper: string[], lower: string[]): number {
    const pairs: Array<[number, number]> = [];
    lower.forEach((id, j) => {
      for (const parent of up.get(id) ?? []) {
        const i = upper.indexOf(parent);
        if (i >= 0) pairs.push([i, j]);
      }
    });
    let total = 0;
    for (let a = 0; a < pairs.length; a++) {
      for (let b = a + 1; b < pairs.length; b++) {
        if ((pairs[a][0] - pairs[b][0]) * (pairs[a][1] - pairs[b][1]) < 0) total++;
      }
    }
    return total;
  }

  const localCrossings = (row: number) =>
    (row > 0 ? crossingsBetween(layers[row - 1], layers[row]) : 0) +
    (row < layers.length - 1 ? crossingsBetween(layers[row], layers[row + 1]) : 0);

  for (let pass = 0; pass < 8; pass++) {
    // Down: order each layer by where its inputs sit in the layer above.
    for (let i = 1; i < layers.length; i++) sortByBarycentre(layers[i], layers[i - 1], up);
    // Up: and by where its consumers sit below. One direction alone leaves the
    // other end tangled.
    for (let i = layers.length - 2; i >= 0; i--) sortByBarycentre(layers[i], layers[i + 1], down);

    /**
     * Then transpose: try swapping each adjacent pair and keep the swap when it
     * removes crossings. Barycentre gets close and then stalls — it optimises
     * an average, and two nodes with the same average sit in whatever order
     * they arrived in. This is the pass that takes the last ones out, and it
     * can only ever improve the count because a swap is kept only if it does.
     */
    let improved = true;
    for (let sweep = 0; sweep < 4 && improved; sweep++) {
      improved = false;
      for (let row = 0; row < layers.length; row++) {
        const layer = layers[row];
        for (let i = 0; i + 1 < layer.length; i++) {
          const before = localCrossings(row);
          [layer[i], layer[i + 1]] = [layer[i + 1], layer[i]];
          if (localCrossings(row) < before) improved = true;
          else [layer[i], layer[i + 1]] = [layer[i + 1], layer[i]];
        }
      }
    }
  }

  // --- 5. place --------------------------------------------------------
  // Generous, because the measured width already includes the name label and
  // two labels butted together are unreadable even when the boxes don't touch.
  const gap = 90;
  const boxWidth = (id: string) => (isPlaceholder(id) ? PLACEHOLDER_WIDTH : widthOf(id));
  const spacing = (id: string) => (isPlaceholder(id) ? gap / 2 : gap);

  // Pack each layer by real width, then centre the layers against the widest
  // row so the graph reads as a column rather than drifting to one side.
  const layerWidths = layers.map(layer =>
    layer.reduce((total, id) => total + boxWidth(id), 0) + Math.max(0, layer.length - 1) * gap
  );
  const widestRow = Math.max(1, ...layerWidths);

  const centres = new Map<string, number>();
  layers.forEach((layer, row) => {
    let x = originX + (widestRow - layerWidths[row]) / 2;
    layer.forEach(id => {
      centres.set(id, x + boxWidth(id) / 2);
      x += boxWidth(id) + gap;
    });
    void row;
  });

  /**
   * Straighten. Each node is pulled toward the average centre of everything it
   * connects to, as far as its neighbours in the row allow — so a chain runs
   * down the page instead of stepping side to side, and a wire between two
   * layers becomes vertical wherever nothing is in the way.
   *
   * Sweeps alternate direction because pulling toward inputs alone leaves the
   * bottom of the graph ragged, and toward consumers alone leaves the top. The
   * neighbour limits are hard: this only ever takes up slack the packing
   * already left, so nothing can be pushed into anything else.
   */
  for (let pass = 0; pass < 6; pass++) {
    const relation = pass % 2 === 0 ? up : down;
    for (const layer of layers) {
      for (let i = 0; i < layer.length; i++) {
        const id = layer[i];
        const linked = (relation.get(id) ?? [])
          .map(other => centres.get(other))
          .filter((c): c is number => c !== undefined);
        if (!linked.length) continue;
        const wanted = linked.reduce((a, b) => a + b, 0) / linked.length;

        const half = boxWidth(id) / 2;
        const leftId = layer[i - 1];
        const rightId = layer[i + 1];
        const low = leftId !== undefined
          ? centres.get(leftId)! + boxWidth(leftId) / 2 + spacing(id) + half
          : -Infinity;
        const high = rightId !== undefined
          ? centres.get(rightId)! - boxWidth(rightId) / 2 - spacing(id) - half
          : Infinity;

        centres.set(id, Math.min(Math.max(wanted, low), high));
      }
    }
  }

  // The placeholders did their work in the ordering and the packing; only real
  // nodes come back.
  const positions = new Map<string, { x: number; y: number }>();
  layers.forEach((layer, row) => {
    for (const id of layer) {
      if (isPlaceholder(id)) continue;
      positions.set(id, {
        x: Math.round(centres.get(id)! - boxWidth(id) / 2),
        y: Math.round(originY + row * rowGap),
      });
    }
  });

  return positions;
}

/** Edges from a live graph's connections. */
export function edgesFromConnections(connections: Array<{ from: { nodeId: string }; to: { nodeId: string } }>): LayoutEdge[] {
  return connections.map(c => ({ from: c.from.nodeId, to: c.to.nodeId }));
}
