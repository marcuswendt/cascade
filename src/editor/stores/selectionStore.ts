import { writable } from 'svelte/store';
import type { Graph } from '@/nodes/Graph';
import type { Node } from '@/nodes/Node';

/**
 * The ids of every node the canvas currently has selected.
 *
 * Selection is local state inside Canvas, and the only thing that ever left it
 * was the one primary node on `nodeSelect`. So `Node.selected` was read in two
 * places in App and written in none, and every consumer outside the canvas saw
 * a selection of exactly one. This store is the canvas publishing the whole
 * set, in the same idiom as propUpdateStore: a panel reads it directly rather
 * than a second selection signal being threaded up through App and back down.
 *
 * Ids are in click order. Anything that renders them should resolve through
 * `selectedNodesOf`, which puts them back into canvas order.
 */
export const selectedNodeIds = writable<string[]>([]);

/**
 * Publish the set, but only when it actually changed — the canvas republishes
 * on interactions that do not move the selection at all.
 */
export function setSelectedNodeIds(ids: string[]): void {
  selectedNodeIds.update((current) => {
    if (current.length === ids.length && current.every((id, index) => id === ids[index])) return current;
    return [...ids];
  });
}

/**
 * Every selected node, in canvas order.
 *
 * Order is the order `graph.nodes` yields, deliberately not the order the nodes
 * were clicked: a stacked inspector has to stay put as the selection grows,
 * rather than reshuffling under the pointer with every shift-click.
 *
 * The published set wins where there is one. The primary node is only a
 * fallback, deliberately: it lags the set by design — shift-clicking a node out
 * of the selection still reports it as the primary — so folding it in
 * unconditionally would leave a deselected node showing in the panel.
 */
export function selectedNodesOf(
  graph: Graph | null | undefined,
  ids: readonly string[],
  primary: Node | null | undefined
): Node[] {
  if (!graph) return primary ? [primary] : [];

  const chosen = new Set(ids);
  if (chosen.size > 0) {
    const published = graph.nodes.filter((n) => chosen.has(n.id));
    if (published.length > 0) return published;
  }

  // Nothing published yet, or every published node has since been removed.
  // Fall back to the flag and the primary, which is exactly the expression the
  // rest of the editor used before the canvas published anything at all.
  const flagged = graph.nodes.filter((n) => (n as any).selected || n.id === primary?.id);
  if (flagged.length > 0) return flagged;
  return primary ? [primary] : [];
}
