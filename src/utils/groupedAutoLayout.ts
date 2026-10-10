import { layoutTopDown, type LayoutEdge } from './autoLayout';

export interface GroupedLayoutElement {
  id: string;
  width: number;
  height: number;
  /** Standalone notes belong near the graph, but not in its dependency ranks. */
  decorative?: boolean;
}

export interface GroupedLayoutGroup {
  id: string;
  members: string[];
}

export interface GroupedLayoutResult {
  positions: Map<string, { x: number; y: number }>;
  groupSizes: Map<string, { width: number; height: number }>;
}

type Point = { x: number; y: number };
type Size = { width: number; height: number };
type Unit = Size & {
  id: string;
  positions: Map<string, Point>;
  groupSizes: Map<string, Size>;
};

const INTERNAL_X = 28;
const INTERNAL_TOP = 52;
const INTERNAL_BOTTOM = 28;
const INTERNAL_GAP_X = 70;
const INTERNAL_GAP_Y = 92;
const GROUP_GAP_X = 150;
const GROUP_GAP_Y = 170;
const DECORATION_GAP = 70;

function gridPositions(units: Unit[], horizontalGap: number, verticalGap: number): Map<string, Point> {
  const positions = new Map<string, Point>();
  if (!units.length) return positions;
  const columns = Math.min(3, Math.ceil(Math.sqrt(units.length)));
  const columnWidths = Array.from({ length: columns }, () => 0);
  const rows = Math.ceil(units.length / columns);
  const rowHeights = Array.from({ length: rows }, () => 0);
  units.forEach((unit, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    columnWidths[column] = Math.max(columnWidths[column], unit.width);
    rowHeights[row] = Math.max(rowHeights[row], unit.height);
  });
  const xs = columnWidths.map((_, index) =>
    columnWidths.slice(0, index).reduce((sum, width) => sum + width, 0) + index * horizontalGap
  );
  const ys = rowHeights.map((_, index) =>
    rowHeights.slice(0, index).reduce((sum, height) => sum + height, 0) + index * verticalGap
  );
  units.forEach((unit, index) => positions.set(unit.id, {
    x: xs[index % columns],
    y: ys[Math.floor(index / columns)],
  }));
  return positions;
}

/** Lay out units with the existing crossing-minimising order, then make rows tall enough for groups. */
function placeUnits(
  units: Unit[],
  edges: LayoutEdge[],
  horizontalGap: number,
  verticalGap: number,
  maxRowWidth = Infinity,
): Map<string, Point> {
  if (!units.length) return new Map();
  const ids = new Set(units.map(unit => unit.id));
  const localEdges = edges.filter(edge => ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to);
  if (!localEdges.length) return gridPositions(units, horizontalGap, verticalGap);

  const sizes = new Map(units.map(unit => [unit.id, unit]));
  const preliminary = layoutTopDown(
    units.map(unit => unit.id),
    localEdges,
    {
      widths: new Map(units.map(unit => [unit.id, unit.width])),
      nodeGap: horizontalGap,
      rowGap: 1,
      originX: 0,
      originY: 0,
    },
  );
  const rowKeys = [...new Set([...preliminary.values()].map(point => point.y))].sort((a, b) => a - b);
  const result = new Map<string, Point>();
  let y = 0;
  for (const key of rowKeys) {
    const members = [...preliminary]
      .filter(([, point]) => point.y === key)
      .sort((a, b) => a[1].x - b[1].x)
      .map(([id]) => sizes.get(id)!);
    let row: Unit[] = [];
    let rowWidth = 0;
    const flush = () => {
      if (!row.length) return;
      let x = Number.isFinite(maxRowWidth) ? Math.max(0, (maxRowWidth - rowWidth) / 2) : 0;
      for (const unit of row) {
        result.set(unit.id, { x, y });
        x += unit.width + horizontalGap;
      }
      y += Math.max(...row.map(unit => unit.height)) + verticalGap;
      row = [];
      rowWidth = 0;
    };
    for (const unit of members) {
      const nextWidth = rowWidth + (row.length ? horizontalGap : 0) + unit.width;
      if (row.length && nextWidth > maxRowWidth) flush();
      row.push(unit);
      rowWidth += (row.length > 1 ? horizontalGap : 0) + unit.width;
    }
    flush();
  }
  return result;
}

function bounds(units: Unit[], positions: Map<string, Point>): Size {
  return {
    width: Math.max(0, ...units.map(unit => (positions.get(unit.id)?.x ?? 0) + unit.width)),
    height: Math.max(0, ...units.map(unit => (positions.get(unit.id)?.y ?? 0) + unit.height)),
  };
}

/**
 * Group-aware top-down layout.
 *
 * Groups are recursively arranged and measured first, then treated as single
 * nodes in the outer dependency graph. This keeps the normal DAG flow while
 * preventing a cleanup pass from scattering members out of their frames.
 */
export function layoutTopDownGrouped(
  elements: GroupedLayoutElement[],
  edges: LayoutEdge[],
  groups: GroupedLayoutGroup[],
  origin: Point = { x: 40, y: 40 },
): GroupedLayoutResult {
  const elementMap = new Map(elements.map(element => [element.id, element]));
  const groupMap = new Map(groups.map(group => [group.id, group]));
  const known = new Set([...elementMap.keys(), ...groupMap.keys()]);

  // One visual owner per item. assignToGroup maintains this invariant; using
  // the last valid declaration also makes malformed imported files stable.
  const owner = new Map<string, string>();
  for (const group of groups) {
    for (const member of group.members) if (known.has(member) && member !== group.id) owner.set(member, group.id);
  }

  const leaf = (element: GroupedLayoutElement): Unit => ({
    id: element.id,
    width: Math.max(40, element.width),
    height: Math.max(30, element.height),
    positions: new Map([[element.id, { x: 0, y: 0 }]]),
    groupSizes: new Map(),
  });

  const topChild = (id: string, ancestor: string | null): string | null => {
    let current = id;
    const seen = new Set<string>();
    while (owner.has(current) && !seen.has(current)) {
      seen.add(current);
      const parent = owner.get(current)!;
      if (parent === ancestor) return current;
      current = parent;
    }
    return ancestor === null ? current : null;
  };

  const projectedEdges = (ancestor: string | null): LayoutEdge[] => {
    const unique = new Set<string>();
    const result: LayoutEdge[] = [];
    for (const edge of edges) {
      const from = topChild(edge.from, ancestor);
      const to = topChild(edge.to, ancestor);
      if (!from || !to || from === to) continue;
      const key = `${from}\u0000${to}`;
      if (unique.has(key)) continue;
      unique.add(key);
      result.push({ from, to });
    }
    return result;
  };

  const building = new Set<string>();
  const buildGroup = (id: string): Unit => {
    if (building.has(id)) return { id, width: 220, height: 120, positions: new Map(), groupSizes: new Map() };
    building.add(id);
    const group = groupMap.get(id)!;
    const childIds = group.members.filter(member => owner.get(member) === id && known.has(member));
    const children = childIds.flatMap(member => {
      if (groupMap.has(member)) return [buildGroup(member)];
      const element = elementMap.get(member);
      return element ? [leaf(element)] : [];
    });
    const childPositions = placeUnits(children, projectedEdges(id), INTERNAL_GAP_X, INTERNAL_GAP_Y);
    const childBounds = bounds(children, childPositions);
    const width = Math.max(220, childBounds.width + INTERNAL_X * 2);
    const height = Math.max(120, childBounds.height + INTERNAL_TOP + INTERNAL_BOTTOM);
    const positions = new Map<string, Point>([[id, { x: 0, y: 0 }]]);
    const groupSizes = new Map<string, Size>([[id, { width, height }]]);
    for (const child of children) {
      const placed = childPositions.get(child.id)!;
      const offset = { x: INTERNAL_X + placed.x, y: INTERNAL_TOP + placed.y };
      for (const [member, point] of child.positions) positions.set(member, { x: point.x + offset.x, y: point.y + offset.y });
      for (const [member, size] of child.groupSizes) groupSizes.set(member, size);
    }
    building.delete(id);
    return { id, width, height, positions, groupSizes };
  };

  const roots: Unit[] = [];
  for (const group of groups) if (!owner.has(group.id)) roots.push(buildGroup(group.id));
  for (const element of elements) if (!owner.has(element.id) && !element.decorative) roots.push(leaf(element));

  const rootPositions = placeUnits(roots, projectedEdges(null), GROUP_GAP_X, GROUP_GAP_Y, 1850);
  const decorations = elements.filter(element => element.decorative && !owner.has(element.id)).map(leaf);
  const decorationWidth = Math.max(0, ...decorations.map(decoration => decoration.width));
  const graphOffsetX = decorations.length ? decorationWidth + GROUP_GAP_X : 0;
  const positions = new Map<string, Point>();
  const groupSizes = new Map<string, Size>();
  for (const root of roots) {
    const placed = rootPositions.get(root.id)!;
    for (const [id, point] of root.positions) positions.set(id, {
      x: point.x + placed.x + origin.x + graphOffsetX,
      y: point.y + placed.y + origin.y,
    });
    for (const [id, size] of root.groupSizes) groupSizes.set(id, size);
  }

  // Standalone captions and images are not graph ranks. Keep them in a clear
  // left margin so they do not make a top-to-bottom graph unnecessarily tall.
  if (decorations.length) {
    let y = origin.y;
    for (const decoration of decorations) {
      positions.set(decoration.id, {
        x: origin.x,
        y,
      });
      y += decoration.height + DECORATION_GAP;
    }
  }

  return { positions, groupSizes };
}
