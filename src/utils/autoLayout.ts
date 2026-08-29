/**
 * Top-to-bottom graph layout.
 *
 * Cascade draws a node's inputs along its top edge and its outputs along its
 * bottom, so a graph reads cleanly when it flows downward: every wire leaves the
 * bottom of one node and arrives at the top of the next, and none of them has to
 * turn back on itself. Laid out left to right, the same graph forces each wire
 * through a right angle and they cross far more.
 *
 * Layered, in the usual three passes:
 *
 *  1. RANK — each node sits one level below its deepest input, so a wire always
 *     points down and never sideways within a layer.
 *  2. ORDER — within a layer, nodes are sorted by the average position of the
 *     nodes they connect to (the barycentre heuristic). Repeated a few times,
 *     alternating direction, which is what actually removes crossings.
 *  3. PLACE — measured against the widest layer so the result is centred rather
 *     than ragged, with column spacing scaled to how wide a node can get.
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

const DEFAULTS: Required<LayoutOptions> = {
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

  const layers: string[][] = [];
  for (const id of nodeIds) {
    const r = rank.get(id) ?? 0;
    while (layers.length <= r) layers.push([]);
    layers[r].push(id);
  }

  // Stable starting order, so the result doesn't depend on object key order.
  layers.forEach(layer => layer.sort());

  // --- 2. order --------------------------------------------------------
  const indexIn = (layer: string[], id: string) => layer.indexOf(id);

  function sortByBarycentre(layer: string[], reference: string[], relation: Map<string, string[]>) {
    const score = new Map<string, number>();
    layer.forEach((id, fallback) => {
      const linked = (relation.get(id) ?? []).map(other => indexIn(reference, other)).filter(i => i >= 0);
      score.set(id, linked.length ? linked.reduce((a, b) => a + b, 0) / linked.length : fallback);
    });
    layer.sort((a, b) => (score.get(a)! - score.get(b)!) || a.localeCompare(b));
  }

  for (let pass = 0; pass < 4; pass++) {
    // Down: order each layer by where its inputs sit in the layer above.
    for (let i = 1; i < layers.length; i++) sortByBarycentre(layers[i], layers[i - 1], upstream);
    // Up: and by where its consumers sit below. One direction alone leaves the
    // other end tangled.
    for (let i = layers.length - 2; i >= 0; i--) sortByBarycentre(layers[i], layers[i + 1], downstream);
  }

  // --- 3. place --------------------------------------------------------
  const positions = new Map<string, { x: number; y: number }>();
  // Generous, because the measured width already includes the name label and
  // two labels butted together are unreadable even when the boxes don't touch.
  const gap = 90;

  // Pack each layer by real width, then centre the layers against the widest
  // row so the graph reads as a column rather than drifting to one side.
  const layerWidths = layers.map(layer =>
    layer.reduce((total, id) => total + widthOf(id), 0) + Math.max(0, layer.length - 1) * gap
  );
  const widestRow = Math.max(1, ...layerWidths);

  layers.forEach((layer, row) => {
    let x = originX + (widestRow - layerWidths[row]) / 2;
    layer.forEach(id => {
      positions.set(id, { x: Math.round(x), y: Math.round(originY + row * rowGap) });
      x += widthOf(id) + gap;
    });
  });

  return positions;
}

/** Edges from a live graph's connections. */
export function edgesFromConnections(connections: Array<{ from: { nodeId: string }; to: { nodeId: string } }>): LayoutEdge[] {
  return connections.map(c => ({ from: c.from.nodeId, to: c.to.nodeId }));
}
