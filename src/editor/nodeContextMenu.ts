/**
 * Shape of a single row in the node right-click menu.
 *
 * The menu component is deliberately dumb: it lays out and navigates whatever
 * rows it is handed, and every action lives in the caller (Canvas.svelte), so
 * the menu never needs a reference to the graph, the selection, or the panels.
 *
 * `separatorBefore` rather than a separator item, because a separator is a
 * property of the boundary between two groups — modelling it as its own row
 * means the keyboard navigation has to know how to skip it.
 */
export interface NodeContextMenuItem {
  /** Stable key for the {#each}; also useful in tests. */
  readonly id: string;
  readonly label: string;
  /** Draw a divider above this row. */
  readonly separatorBefore?: boolean;
  /** Destructive styling. Does not change behaviour. */
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly run: () => void;
}

/**
 * "3 nodes" / "1 node" — the menu labels state the size of the selection they
 * act on, because right-clicking one node of a multi-selection otherwise looks
 * like it will act on that node alone.
 */
export function countLabel(count: number, singular: string): string {
  return count === 1 ? `1 ${singular}` : `${count} ${singular}s`;
}
