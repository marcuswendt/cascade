/**
 * One revision store per node, bumped when a drag moves it.
 *
 * A drag used to publish each frame by copying `graph.nodes`, which in Svelte 4
 * hands every NodeUI a "changed" object prop and re-renders all of them: about
 * 9 ms per pointer move at 100 nodes, for one node that moved. A NodeUI reads
 * its position through its own store instead, so a drag re-renders the nodes
 * it moves and nothing else. The canvas publishes the whole graph once, when
 * the drag ends.
 */
import { writable, type Readable, type Writable } from 'svelte/store';

const revisions = new Map<string, Writable<number>>();

/** The motion revision of one node; subscribe to re-read its position. */
export function nodeMotion(id: string): Readable<number> {
  let store = revisions.get(id);
  if (!store) {
    store = writable(0);
    revisions.set(id, store);
  }
  return store;
}

/** Tell exactly these nodes that they moved. */
export function bumpNodeMotion(ids: Iterable<string>): void {
  for (const id of ids) revisions.get(id)?.update(n => n + 1);
}
