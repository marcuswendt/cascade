/**
 * A counter that changes whenever the graph's STRUCTURE does — ports appearing,
 * wires binding, nodes moving.
 *
 * Node components are keyed by id, so they survive a re-render of the list and
 * their internal reads of `node.inputs`, `node.outputs` and `node.position`
 * never re-evaluate. Those are plain mutable arrays and objects that a node's
 * own code pushes to while it cooks, which Svelte cannot observe. The result
 * was nodes drawn with missing ports and wires that only appeared once you
 * selected the node and forced it to redraw.
 *
 * So anything that changes structure bumps this, and the node's reactive
 * statements reference it. Cheap: one number, and nothing recomputes while the
 * graph is still.
 */
import { writable } from 'svelte/store';

export const graphStructure = writable(0);

export function bumpGraphStructure(): void {
  graphStructure.update(n => n + 1);
}
