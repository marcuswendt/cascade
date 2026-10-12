/**
 * Seeds: one number per graph, one derived number per node, the same in every
 * host.
 *
 * A node that wants randomness gets `context.seed` and `context.random` from
 * whichever host cooks it — the headless runtime here, Studio through its
 * definition adapter — and both compute them with these functions. So the
 * same graph draws the same dots headless and in Studio, and changing the
 * graph's `seed` reshuffles every node at once while each keeps its own
 * stream (doc/PRODUCTION_READINESS.md, item 5).
 *
 * The node id is part of the derivation, not its position: ids are stable
 * across edits, so adding a node never reshuffles its neighbours.
 */

/** The graph seed when a document does not state one. */
export const DEFAULT_GRAPH_SEED = 0;

/** A document's `seed`, as an unsigned 32-bit integer; the default when absent
 *  or not an integer. */
export function graphSeed(document: Readonly<{ seed?: unknown }> | null | undefined): number {
  const value = document?.seed;
  return typeof value === "number" && Number.isInteger(value) ? value >>> 0 : DEFAULT_GRAPH_SEED;
}

/**
 * A node's seed: FNV-1a over `<graph seed>:<node id>`, finished with
 * MurmurHash3's avalanche so neighbouring ids give unrelated seeds.
 */
export function nodeSeed(seedOfGraph: number, nodeId: string): number {
  const text = `${seedOfGraph >>> 0}:${nodeId}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/** Mulberry32: a small, fast stream of floats in [0, 1) from one seed. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}
