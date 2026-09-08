import { Orientation, type SerializedDockview } from 'dockview';

/**
 * Fold bookkeeping for dockview groups — the pure half.
 *
 * Folding a group means shrinking it to a hairline strip and remembering the
 * size it had, so that unfolding returns the layout somebody arranged rather
 * than a default. All the arithmetic that decides *what size comes back* lives
 * here, with no dockview instance and no DOM, because that is the part where a
 * bug silently destroys a layout: a fold that records the folded size restores
 * an 8px panel forever, and the user's only reading of that is "the timeline is
 * gone".
 */

export type ResizeAxis = 'width' | 'height';

export interface FoldRecord {
  /** The size the group had along `axis` before it was folded. */
  size: number;
  /** The group's own minimum constraint before it was folded. */
  minimum: number;
  axis: ResizeAxis;
}

/** The folded strip, in pixels. Marcus asked for 5–10px for the timeline. */
export const FOLDED_SIZE = 8;

/**
 * The smallest size a fold is ever allowed to restore to. A group can arrive at
 * the fold already dragged down to nothing (or be folded twice through two
 * different affordances), and recording that as the restore size is how folding
 * becomes destructive. Anything at or below the strip is treated as "no usable
 * size was known" and replaced.
 */
export const MIN_RESTORE_SIZE = 80;

/** Used when nothing usable was known at all. */
export const DEFAULT_RESTORE_SIZE = 200;

export type FoldMap = Map<string, FoldRecord>;

const AXES: ResizeAxis[] = ['width', 'height'];

/**
 * The size a fold should remember, given whatever the group reported.
 *
 * Rejects a size that is missing, non-finite, or already collapsed — in every
 * one of those cases the honest answer is "big enough to see", not the number
 * that was measured.
 */
export function sanitizeRestoreSize(size: unknown, fallback = DEFAULT_RESTORE_SIZE): number {
  const value = typeof size === 'number' && Number.isFinite(size) ? size : NaN;
  if (!Number.isFinite(value)) return fallback;
  if (value <= FOLDED_SIZE * 2) return Math.max(fallback, MIN_RESTORE_SIZE);
  return Math.round(value);
}

/** The minimum constraint a fold should remember. */
export function sanitizeRestoreMinimum(minimum: unknown): number {
  const value = typeof minimum === 'number' && Number.isFinite(minimum) ? minimum : 0;
  return Math.max(0, Math.round(value));
}

export function isFolded(map: FoldMap, groupId: string): boolean {
  return map.has(groupId);
}

/**
 * Record a fold. **Idempotent by design**: folding a group that is already
 * folded keeps the original record, so a second click (or a double-click on the
 * tab racing the header button) cannot overwrite the remembered size with the
 * strip size.
 */
export function fold(
  map: FoldMap,
  groupId: string,
  measured: { size?: number; minimum?: number; axis: ResizeAxis },
): FoldMap {
  if (map.has(groupId)) return map;
  const next = new Map(map);
  next.set(groupId, {
    size: sanitizeRestoreSize(measured.size),
    minimum: sanitizeRestoreMinimum(measured.minimum),
    axis: measured.axis,
  });
  return next;
}

/**
 * Drop a fold and report what to restore. `restore` is null when the group was
 * not folded, which the caller must read as "do nothing" rather than "restore
 * to a default" — resizing a group nobody folded is the other way to lose a
 * layout.
 */
export function unfold(map: FoldMap, groupId: string): { map: FoldMap; restore: FoldRecord | null } {
  const record = map.get(groupId);
  if (!record) return { map, restore: null };
  const next = new Map(map);
  next.delete(groupId);
  return { map: next, restore: record };
}

export function forget(map: FoldMap, groupId: string): FoldMap {
  if (!map.has(groupId)) return map;
  const next = new Map(map);
  next.delete(groupId);
  return next;
}

export function serializeFolds(map: FoldMap): Record<string, FoldRecord> {
  return Object.fromEntries(map);
}

/**
 * Rebuild the map from whatever localStorage or a `.cascade` document carried.
 * Every field is checked: a corrupt record is dropped rather than applied,
 * because a bad axis or a NaN size would be pushed straight into
 * `setSize`/`setConstraints` and wedge the grid.
 */
export function deserializeFolds(raw: unknown): FoldMap {
  const map: FoldMap = new Map();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return map;
  for (const [groupId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!groupId || !value || typeof value !== 'object') continue;
    const record = value as Partial<FoldRecord>;
    if (!AXES.includes(record.axis as ResizeAxis)) continue;
    if (typeof record.size !== 'number' || !Number.isFinite(record.size)) continue;
    map.set(groupId, {
      size: sanitizeRestoreSize(record.size),
      minimum: sanitizeRestoreMinimum(record.minimum),
      axis: record.axis as ResizeAxis,
    });
  }
  return map;
}

/**
 * Every leaf group in a serialized layout, with its size and the axis it is
 * sized along.
 *
 * The axis alternates with depth: a `HORIZONTAL` root lays its children out as
 * columns, so they are sized by *width*, and a branch inside one of those
 * columns lays its own children out as rows, sized by *height*. The default
 * layout is the proof — its three top-level sizes add up to the grid width, and
 * the two inside the left column add up to the grid height.
 *
 * NOTE this does not agree with `groupResizeAxis` in dockview-store, which
 * flips one level too early and so reports 'height' for a top-level column. Its
 * test passes because it is written against `orientation: 0`, and dockview's
 * `Orientation` is a string enum — so the test only ever exercises the vertical
 * branch and the real case is unchecked. Folding sets a real size on a real
 * group and cannot use the wrong axis, so it uses this.
 */
export function layoutGroupSizes(
  grid: SerializedDockview['grid'],
): { id: string; size: number; axis: ResizeAxis }[] {
  const found: { id: string; size: number; axis: ResizeAxis }[] = [];
  const push = (node: any, axis: ResizeAxis) => {
    const id = node?.data?.id;
    if (typeof id === 'string') found.push({ id, size: Number(node.size) || 0, axis });
  };
  const visit = (node: any, childAxis: ResizeAxis): void => {
    if (node?.type !== 'branch' || !Array.isArray(node.data)) return;
    const grandchildAxis: ResizeAxis = childAxis === 'width' ? 'height' : 'width';
    for (const child of node.data) {
      if (child?.type === 'leaf') push(child, childAxis);
      else visit(child, grandchildAxis);
    }
  };

  const rootAxis: ResizeAxis = grid?.orientation === Orientation.HORIZONTAL ? 'width' : 'height';
  if (grid?.root?.type === 'leaf') push(grid.root, rootAxis);
  else visit(grid?.root, rootAxis);
  return found;
}

/** The axis one group is sized along, from a serialized layout. */
export function foldAxis(grid: SerializedDockview['grid'], groupId: string): ResizeAxis | null {
  return layoutGroupSizes(grid).find((group) => group.id === groupId)?.axis ?? null;
}

/**
 * Adopt groups that arrive already at strip size with no fold record.
 *
 * dockview serialises the *size* of a folded group into the layout JSON, but
 * the record of what it was before lives here — so a layout that travels
 * without its records (a `.cascade` document opened on another machine,
 * localStorage cleared for one key and not the other) would present a hairline
 * group with no memory and no visible control. That is the one failure mode
 * that loses a panel for good, so on load anything already at strip size is
 * treated as folded, given a sane restore size, and gets the strip's own
 * unfold affordance back.
 */
export function adoptOrphanFolds(grid: SerializedDockview['grid'], map: FoldMap): FoldMap {
  let next = map;
  for (const group of layoutGroupSizes(grid)) {
    if (group.size > FOLDED_SIZE * 2) continue;
    if (next.has(group.id)) continue;
    next = fold(next, group.id, { size: undefined, minimum: 0, axis: group.axis });
  }
  return next;
}
