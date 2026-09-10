/**
 * Which end of a connection gesture is the source.
 *
 * A user asked for backwards wiring on 2026-09-10: *"being able to connect
 * 'backwards' (eg. drag from circle divisions pip to an input pip) would also
 * be great, as I find with these kinda things you often expand in both
 * directions as you build out."*
 *
 * A graph edge has a direction and a gesture does not. Dragging output→input
 * and input→output describe the same edge, so the fix is to decide which end is
 * which **before** the code that builds the connection, and leave that code
 * believing what it always believed.
 *
 * ## Why this is its own module
 *
 * The two gestures live in different handlers in `Canvas.svelte` — mouse-up
 * after a drag, and click-then-click — and the work after them is substantial:
 * finding the first free port in a variadic group, auto-creating an
 * `Input` node when the drop lands on a subnet, fanning several selected nodes
 * into one variadic input. Reversing by adding a second branch to each would be
 * two more copies of all that, drifting apart. One resolver, tested on its own,
 * with the handlers calling it.
 */

export interface ConnectionEndpoint {
  readonly nodeId: string;
  readonly portId: string;
  readonly portType: 'input' | 'output';
  /**
   * The port's variadic group, when it has one.
   *
   * Carried because a reversed gesture makes the *starting* port the target, and
   * a target that belongs to a variadic group needs its base name to find the
   * first free port. On a forward gesture that comes off the dropped element's
   * `data-variadic-base`; on a reversed one that element is an output and has
   * none, so it has to have been captured when the drag began.
   */
  readonly variadicBase?: string | null;
}

export interface ResolvedConnection {
  readonly source: ConnectionEndpoint;
  readonly target: ConnectionEndpoint;
  /** True when the gesture ran input→output and was swapped. */
  readonly reversed: boolean;
}

/**
 * Put the output first, or refuse.
 *
 * Returns `null` for anything that is not one output and one input on two
 * different nodes — output to output, input to input, a port to itself. Those
 * are not edges, and answering `null` rather than throwing keeps a mis-drag a
 * no-op, which is what a mis-drag should be.
 */
export function resolveConnection(
  started: ConnectionEndpoint,
  dropped: ConnectionEndpoint,
): ResolvedConnection | null {
  if (started.nodeId === dropped.nodeId) return null;
  if (started.portType === dropped.portType) return null;
  const reversed = started.portType === 'input';
  return reversed
    ? { source: dropped, target: started, reversed: true }
    : { source: started, target: dropped, reversed: false };
}

/**
 * Whether a gesture may begin on this port.
 *
 * An output always may. An **unconnected** input may, which is the change: it
 * used to do nothing at all, because inputs were claimed for the disconnect
 * gesture and that gesture requires an existing wire. A *connected* input keeps
 * the disconnect meaning — pulling a wire off is the more useful reading of
 * dragging from a port that has one, and there is no other way to do it.
 */
export function canStartConnection(
  portType: 'input' | 'output',
  connectionCount: number,
): boolean {
  return portType === 'output' || connectionCount === 0;
}
