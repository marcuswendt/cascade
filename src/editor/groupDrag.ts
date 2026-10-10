import type { Graph, CanvasAnnotation } from '@/nodes/Graph';

type Point = { x: number; y: number };
export interface GroupDrag {
  roots: string[];
  items: Array<{ id: string; position: Point; endPosition?: Point; points?: Point[] }>;
}

/** Snapshot once per gesture; shared descendants move exactly once. */
export function captureGroupDrag(graph: Graph, selected: Iterable<string>): GroupDrag {
  const ids = [...new Set(selected)].filter(id => graph.getElement(id));
  const descendants = new Set(ids.flatMap(id => graph.getGroupMembers(id)));
  const roots = ids.filter(id => !descendants.has(id));
  const all = new Set([...ids, ...descendants]);
  return { roots, items: [...all].map(id => {
    const element = graph.getElement(id)! as CanvasAnnotation;
    return {
      id, position: { ...element.position },
      endPosition: element.type === 'Line' && element.endPosition ? { ...element.endPosition } : undefined,
      points: element.type === 'Polyline' ? element.points?.map(point => ({ ...point })) : undefined,
    };
  }) };
}

/** Mutate graph-owned instances, never replace them with plain object copies. */
export function moveGroupDrag(graph: Graph, drag: GroupDrag, delta: Point): void {
  const translate = (point: Point) => ({ x: point.x + delta.x, y: point.y + delta.y });
  for (const item of drag.items) {
    const element = graph.getElement(item.id) as CanvasAnnotation | undefined;
    if (!element) continue;
    element.position = translate(item.position);
    if (item.endPosition) element.endPosition = translate(item.endPosition);
    if (item.points) element.points = item.points.map(translate);
  }
}

/** Smallest enclosing frame wins; equal-size overlaps prefer the frontmost frame. */
export function findDropGroup(graph: Graph, id: string, center: Point, moving: ReadonlySet<string>): string | null {
  const element = graph.getElement(id);
  if (!element) return null;
  let target: string | null = null;
  let area = Infinity;
  for (const group of graph.annotations) {
    if (group.type !== 'Group' || moving.has(group.id) || group.parent?.id !== element.parent?.id) continue;
    const width = group.size?.width ?? 300;
    const height = group.size?.height ?? 200;
    const { x, y } = group.position;
    if (center.x >= x && center.x <= x + width && center.y >= y + 28 && center.y <= y + height && width * height <= area) {
      target = group.id;
      area = width * height;
    }
  }
  return target;
}
