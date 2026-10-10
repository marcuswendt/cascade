/**
 * Which parts of the graph are in focus.
 *
 * Marcus, on a full graph: "With this many wires the graph gets kind of
 * messy." So the picture has two states. With nothing selected every node is
 * at full strength and every wire sits at half, which keeps the boxes in front
 * of the tangle. With a selection, the selected nodes and their own wires come
 * to full, the nodes directly upstream and downstream stay readable, and
 * everything else steps back. Hovering a node previews the same focus, more
 * gently, while nothing is selected.
 *
 * This module only decides roles. The levels themselves are CSS custom
 * properties (`--graph-*` in theme.css), so tuning them never touches logic,
 * and a role change is a class change: nothing here runs per frame.
 */

export type FocusMode = 'select' | 'hover' | null;
export type WireRole = 'idle' | 'focus' | 'faded';
export type NodeEmphasis = 'none' | 'focus' | 'neighbour' | 'faded';

interface WireLike {
  id: string;
  from: { nodeId: string };
  to: { nodeId: string };
}

export interface GraphFocus {
  mode: FocusMode;
  focus: ReadonlySet<string>;
  neighbours: ReadonlySet<string>;
}

const EMPTY: ReadonlySet<string> = new Set();

export const NO_FOCUS: GraphFocus = { mode: null, focus: EMPTY, neighbours: EMPTY };

/**
 * A selection always wins over a hover: the hover is a preview of what a
 * click would show, and once something is selected the question has been
 * asked.
 */
export function computeGraphFocus(
  selection: readonly string[],
  hoveredNodeId: string | null,
  wires: readonly WireLike[]
): GraphFocus {
  let mode: FocusMode = null;
  let focus: ReadonlySet<string> = EMPTY;
  if (selection.length > 0) {
    mode = 'select';
    focus = new Set(selection);
  } else if (hoveredNodeId) {
    mode = 'hover';
    focus = new Set([hoveredNodeId]);
  }
  if (!mode) return NO_FOCUS;

  const neighbours = new Set<string>();
  for (const wire of wires) {
    const fromIn = focus.has(wire.from.nodeId);
    const toIn = focus.has(wire.to.nodeId);
    if (fromIn && !toIn) neighbours.add(wire.to.nodeId);
    if (toIn && !fromIn) neighbours.add(wire.from.nodeId);
  }
  return { mode, focus, neighbours };
}

/** A hovered wire is always in focus, so the ctrl-to-cut affordance finds you. */
export function wireRole(wire: WireLike, focus: GraphFocus, hoveredWireId?: string): WireRole {
  if (wire.id === hoveredWireId) return 'focus';
  if (!focus.mode) return 'idle';
  return focus.focus.has(wire.from.nodeId) || focus.focus.has(wire.to.nodeId) ? 'focus' : 'faded';
}

export function nodeEmphasis(nodeId: string, focus: GraphFocus): NodeEmphasis {
  if (!focus.mode) return 'none';
  if (focus.focus.has(nodeId)) return 'focus';
  if (focus.neighbours.has(nodeId)) return 'neighbour';
  return 'faded';
}
