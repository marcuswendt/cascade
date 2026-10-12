/**
 * Where an agent-created node goes on the canvas.
 *
 * Not a graph layout. Studio has one (`src/utils/autoLayout.ts`) and running it
 * on every agent edit would move every node the author placed by hand, which
 * is the opposite of a minimal diff. This places ONE node, among siblings that
 * stay where they are, so that opening Studio after an agent session shows the
 * new node next to what it is wired to and in line with the existing flow.
 *
 * The flow is read from the graph rather than assumed. Studio draws inputs on
 * top and outputs on the bottom, so a fresh graph flows down; but a graph
 * whose stages step diagonally (cloud-plots' top level) should get its next
 * stage on the same diagonal. The step is the median offset between wired
 * siblings, so one odd wire does not set the direction.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Studio's own spacing (`autoLayout.ts`): rows 190 apart, columns 260. */
export const DEFAULT_STEP: Point = Object.freeze({ x: 0, y: 190 });
const COLUMN_GAP = 260;
const ROW_GAP = 190;
/** Where Studio's layout starts an empty canvas. */
const ORIGIN: Point = Object.freeze({ x: 40, y: 40 });
/** Two nodes closer than this overlap on screen. A node is about 200 x 100. */
const CLEARANCE: Point = Object.freeze({ x: 210, y: 120 });
const MAX_LANES = 24;

/**
 * The direction and distance from a node to the one it feeds, measured as the
 * component-wise median over the given wires. Falls back to Studio's downward
 * flow when nothing is wired yet, and ignores steps too short to be a layout
 * decision (two nodes stacked by accident).
 */
export function flowStep(wires: readonly { from: Point; to: Point }[]): Point {
  const deltas = wires
    .map(({ from, to }) => ({ x: to.x - from.x, y: to.y - from.y }))
    .filter((delta) => Math.hypot(delta.x, delta.y) >= 60);
  if (!deltas.length) return DEFAULT_STEP;
  const step = { x: median(deltas.map((d) => d.x)), y: median(deltas.map((d) => d.y)) };
  // The sideways part of the step is kept only when every wire agrees on it,
  // as on a staircase of stages. A fan-in (two sources side by side feeding
  // one node) has sideways parts of both signs, and averaging them would tilt
  // the whole flow for no reason.
  const down = Math.abs(step.y) >= Math.abs(step.x);
  const across = deltas.map((d) => (down ? d.x : d.y));
  const agree = across.every((value) => Math.sign(value) === Math.sign(across[0]!) && Math.abs(value - median(across)) <= Math.abs(median(across)) * 0.25);
  if (agree) return step;
  return down ? { x: 0, y: step.y } : { x: step.x, y: 0 };
}

export interface PlacementRequest {
  /** Where the other nodes on the same canvas already are. */
  readonly siblings: readonly Point[];
  /** Positions of the nodes wired into the new node. */
  readonly upstream: readonly Point[];
  /** Positions of the nodes the new node feeds. */
  readonly downstream: readonly Point[];
  readonly step: Point;
}

/**
 * One free position: a step past what feeds the node, or a step before what it
 * feeds, or a staging lane beside the graph when it is wired to nothing yet. If that spot
 * is taken it moves sideways across the flow, alternating sides, until it is
 * clear — so a second consumer of the same node lands beside the first.
 */
export function placeNode({ siblings, upstream, downstream, step }: PlacementRequest): Point {
  const anchor = anchorFor(siblings, upstream, downstream, step);
  const lane = laneStep(step);
  for (let attempt = 0; attempt <= MAX_LANES * 2; attempt += 1) {
    const offset = attempt === 0 ? 0 : (attempt % 2 === 1 ? 1 : -1) * Math.ceil(attempt / 2);
    const candidate = round({ x: anchor.x + lane.x * offset, y: anchor.y + lane.y * offset });
    if (!siblings.some((other) => overlaps(other, candidate))) return candidate;
  }
  return round(anchor);
}

/** True when a node at `point` would sit on top of an existing one. */
export function isOccupied(siblings: readonly Point[], point: Point): boolean {
  return siblings.some((other) => overlaps(other, point));
}

function anchorFor(
  siblings: readonly Point[],
  upstream: readonly Point[],
  downstream: readonly Point[],
  step: Point,
): Point {
  const unit = normalise(step);
  if (upstream.length) {
    // Beside the average of its inputs, but past the furthest of them, so a
    // node fed from two rows never lands between them.
    return add(alongFlow(mean(upstream), unit, Math.max(...upstream.map((p) => dot(p, unit)))), step);
  }
  if (downstream.length) {
    return subtract(alongFlow(mean(downstream), unit, Math.min(...downstream.map((p) => dot(p, unit)))), step);
  }
  if (!siblings.length) return ORIGIN;
  // Wired to nothing yet: a staging lane beside the graph, at the start of the
  // flow. Parking it in the flow would take the very slot the next wire wants;
  // here it waits until `connect` moves it into place, and anything left in
  // the lane reads as not wired yet.
  const lane = laneStep(step);
  const across = normalise(lane);
  const furthest = Math.max(...siblings.map((p) => dot(p, across)));
  const start = Math.min(...siblings.map((p) => dot(p, unit)));
  return {
    x: across.x * furthest + unit.x * start + lane.x,
    y: across.y * furthest + unit.y * start + lane.y,
  };
}

/** Across the flow: columns for a downward graph, rows for a sideways one. */
function laneStep(step: Point): Point {
  return Math.abs(step.y) >= Math.abs(step.x) ? { x: COLUMN_GAP, y: 0 } : { x: 0, y: ROW_GAP };
}

/** Move `point` along `unit` until its projection onto `unit` equals `target`. */
function alongFlow(point: Point, unit: Point, target: number): Point {
  const shift = target - dot(point, unit);
  return { x: point.x + unit.x * shift, y: point.y + unit.y * shift };
}

function overlaps(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < CLEARANCE.x && Math.abs(a.y - b.y) < CLEARANCE.y;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function mean(points: readonly Point[]): Point {
  return {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  };
}

function normalise(p: Point): Point {
  const length = Math.hypot(p.x, p.y) || 1;
  return { x: p.x / length, y: p.y / length };
}

const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const round = (p: Point): Point => ({ x: Math.round(p.x), y: Math.round(p.y) });
