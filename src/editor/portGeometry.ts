import { writable, type Readable } from 'svelte/store';

/**
 * Where each port sits inside its node, so a wire end is arithmetic.
 *
 * A wire end used to be read from the DOM on every canvas render: two
 * `getBoundingClientRect` per end, so a 180-wire graph made ~1,200 layout
 * reads per drag move (~11 ms at 100 nodes). A port's place inside its node
 * only changes when the node's box or its port set does, so it is measured
 * then, once, as an offset from the node's top-left in graph units. A wire
 * end is then `node.position + offset`, through drag, pan and zoom alike.
 *
 * Measurement is driven by one ResizeObserver over every node root (size:
 * a label, a preview image arriving, the variadic list growing) and by
 * `invalidate` from the node itself (port set: same size, different ports).
 * Both are batched into one measuring pass per frame, after which
 * `revision` bumps once so the wires re-derive.
 */

export interface PortOffset { dx: number; dy: number }

interface NodeEntry {
  element: HTMLElement;
  /** Port id → dot centre relative to the node's top-left, graph units. */
  ports: Map<string, PortOffset>;
  width: number;
  height: number;
  measured: boolean;
}

/** The centre of a port's dot, in the element's own layout: `.port-dot` or
 *  the variadic `.port-pill`, falling back to the port box itself. */
function portAnchor(port: HTMLElement): HTMLElement {
  return port.querySelector<HTMLElement>('.port-dot, .port-pill') ?? port;
}

/**
 * Measure one node root's ports. Pure apart from the reads, and exported so a
 * test can drive it with stubbed rects.
 *
 * Every port element names its own id; a variadic group's single pill also
 * stands for each id in `data-variadic-ports`, because all of that group's
 * wires land on the pill.
 */
export function measurePorts(root: HTMLElement, zoom: number): { ports: Map<string, PortOffset>; width: number; height: number } {
  const scale = zoom > 0 ? zoom : 1;
  const box = root.getBoundingClientRect();
  const ports = new Map<string, PortOffset>();
  for (const port of root.querySelectorAll<HTMLElement>('[data-port-id]')) {
    const r = portAnchor(port).getBoundingClientRect();
    const offset = {
      dx: (r.left + r.width / 2 - box.left) / scale,
      dy: (r.top + r.height / 2 - box.top) / scale,
    };
    const id = port.dataset.portId;
    if (id) ports.set(id, offset);
    const group = port.dataset.variadicPorts;
    if (group) for (const member of group.split(',')) if (member && !ports.has(member)) ports.set(member, offset);
  }
  return { ports, width: box.width / scale, height: box.height / scale };
}

export class PortGeometry {
  private readonly entries = new Map<string, NodeEntry>();
  private readonly dirty = new Set<string>();
  private readonly byElement = new WeakMap<Element, string>();
  private observer: ResizeObserver | null = null;
  private frame: number | null = null;
  private readonly bump = writable(0);
  private count = 0;

  /** Bumps once per measuring pass that changed anything. */
  readonly revision: Readable<number> = { subscribe: this.bump.subscribe };

  /** `zoom` is read at measuring time: offsets are stored zoom-free. */
  constructor(private readonly zoom: () => number) {
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver((records) => {
        // A ResizeObserver callback runs after layout, so the reads below are
        // free of forced layout; measure the batch right here.
        for (const record of records) {
          const id = this.byElement.get(record.target);
          if (id) this.dirty.add(id);
        }
        this.flush();
      });
    }
  }

  /** Start tracking a node root. Its first ResizeObserver report measures it. */
  track(id: string, element: HTMLElement): void {
    const previous = this.entries.get(id);
    if (previous && previous.element !== element) this.observer?.unobserve(previous.element);
    this.entries.set(id, { element, ports: previous?.ports ?? new Map(), width: previous?.width ?? 0, height: previous?.height ?? 0, measured: false });
    this.byElement.set(element, id);
    this.observer?.observe(element);
    this.invalidate(id);
  }

  untrack(id: string, element: HTMLElement): void {
    const entry = this.entries.get(id);
    this.observer?.unobserve(element);
    if (entry?.element === element) {
      this.entries.delete(id);
      this.dirty.delete(id);
    }
  }

  /** The node's ports changed without its size necessarily changing. */
  invalidate(id: string): void {
    if (!this.entries.has(id)) return;
    this.dirty.add(id);
    if (this.frame === null && typeof requestAnimationFrame !== 'undefined') {
      this.frame = requestAnimationFrame(() => {
        this.frame = null;
        this.flush();
      });
    }
  }

  /** Measure every dirty node now. */
  flush(): void {
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
    if (this.dirty.size === 0) return;
    let changed = false;
    const zoom = this.zoom();
    for (const id of this.dirty) {
      const entry = this.entries.get(id);
      if (!entry || !entry.element.isConnected) continue;
      const next = measurePorts(entry.element, zoom);
      if (!entry.measured || !samePorts(entry.ports, next.ports)) changed = true;
      entry.ports = next.ports;
      entry.width = next.width;
      entry.height = next.height;
      entry.measured = true;
    }
    this.dirty.clear();
    if (changed) this.bump.set(++this.count);
  }

  /** Offset of a port inside its node, or null when not (yet) known. */
  offset(id: string, portId: string): PortOffset | null {
    return this.entries.get(id)?.ports.get(portId) ?? null;
  }

  /** True once the node has been measured and is not waiting on a re-measure. */
  isCurrent(id: string): boolean {
    const entry = this.entries.get(id);
    return !!entry && entry.measured && !this.dirty.has(id);
  }

  /** Node box in graph units, as of its last measure. */
  size(id: string): { width: number; height: number } | null {
    const entry = this.entries.get(id);
    return entry?.measured ? { width: entry.width, height: entry.height } : null;
  }

  /**
   * Debug check: every tracked port's computed centre against the DOM.
   * Returns the worst disagreement in screen pixels. Reads layout; never call
   * it from a hot path.
   */
  verify(position: (id: string) => { x: number; y: number } | null, toScreen: (p: { x: number; y: number }) => { x: number; y: number }): { worstPx: number; ports: number; mismatches: Array<{ id: string; portId: string; px: number }> } {
    let worstPx = 0, ports = 0;
    const mismatches: Array<{ id: string; portId: string; px: number }> = [];
    for (const [id, entry] of this.entries) {
      const at = position(id);
      if (!at || !entry.element.isConnected) continue;
      for (const port of entry.element.querySelectorAll<HTMLElement>('[data-port-id]')) {
        const portId = port.dataset.portId!;
        const offset = entry.ports.get(portId);
        if (!offset) continue;
        const r = portAnchor(port).getBoundingClientRect();
        const computed = toScreen({ x: at.x + offset.dx, y: at.y + offset.dy });
        const px = Math.hypot(computed.x - (r.left + r.width / 2), computed.y - (r.top + r.height / 2));
        ports++;
        if (px > worstPx) worstPx = px;
        if (px > 1) mismatches.push({ id, portId, px });
      }
    }
    return { worstPx, ports, mismatches };
  }

  destroy(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.frame !== null && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.frame);
    this.frame = null;
    this.entries.clear();
    this.dirty.clear();
  }
}

function samePorts(a: Map<string, PortOffset>, b: Map<string, PortOffset>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, p] of a) {
    const q = b.get(id);
    if (!q || Math.abs(q.dx - p.dx) > 0.01 || Math.abs(q.dy - p.dy) > 0.01) return false;
  }
  return true;
}

/**
 * Annotation output ports, from the same arithmetic the annotation templates
 * use to place them: bottom centre of the annotation's declared size.
 */
export function annotationPortOffset(annotation: { type?: string; size?: { width?: number; height?: number | string } | null }): PortOffset {
  if (annotation.type === 'Image') {
    const width = annotation.size?.width || 200;
    const height = (annotation.size?.height as number) || 150;
    return { dx: width / 2, dy: height };
  }
  const width = annotation.size?.width || 540;
  const height = typeof annotation.size?.height === 'number' ? annotation.size.height : 60;
  return { dx: width / 2, dy: height };
}

export const PORT_GEOMETRY_CONTEXT = Symbol('portGeometry');

/** Svelte action: `use:trackPorts={{ geometry, id, key }}`. `key` changes when
 *  the node's port layout may have changed without a resize. */
export function trackPorts(element: HTMLElement, params: { geometry: PortGeometry | null; id: string; key: string }) {
  let current = params;
  current.geometry?.track(current.id, element);
  return {
    update(next: typeof params) {
      if (next.geometry !== current.geometry || next.id !== current.id) {
        current.geometry?.untrack(current.id, element);
        next.geometry?.track(next.id, element);
      } else if (next.key !== current.key) {
        next.geometry?.invalidate(next.id);
      }
      current = next;
    },
    destroy() {
      current.geometry?.untrack(current.id, element);
    },
  };
}
