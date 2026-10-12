/**
 * The `.cascade` document as plain, mutable JSON — the shape the editor works
 * on — and the small vocabulary for reading it: wires, ports, positions and
 * key order.
 *
 * The editor deliberately edits the parsed JSON rather than a model built from
 * it. A model would have to re-serialise every node on save, and every field it
 * did not know about (a colour, a promotion, a key some other tool wrote) would
 * either be dropped or reordered. Editing in place means a command touches the
 * keys it is about and nothing else, which is what makes the diff minimal.
 */

import type { NodeDefinition } from "@cascade/contracts";
import { canConnectTypes } from "@cascade/contracts";
import type { Point } from "./layout.js";

export type JsonObject = Record<string, unknown>;

export interface EditableNode extends JsonObject {
  id: string;
  module?: string;
  type?: string;
  parent?: string;
  props?: JsonObject;
}

export interface EditableDocument extends JsonObject {
  nodes: EditableNode[];
  connections?: unknown[];
  annotations?: JsonObject[];
}

export const SUBNET = "cascade.core.Subnet";
export const INPUT = "cascade.core.Input";
export const OUTPUT = "cascade.core.Output";

/** One end of a wire: a node, a port name, and the port's index on that node. */
export interface Endpoint {
  readonly node: string;
  readonly port: string;
  readonly index: number;
}

export interface Wire {
  readonly from: Endpoint;
  readonly to: Endpoint;
}

export type WireStyle = "tuple" | "object";

/**
 * Read either connection form. Studio writes `[[id, index, name], [id, index,
 * name]]`; the contracts also allow `{ source, target }`. Anything else is
 * reported as `null`, never guessed at.
 */
export function readWire(raw: unknown): Wire | null {
  if (Array.isArray(raw) && raw.length === 2 && Array.isArray(raw[0]) && Array.isArray(raw[1])) {
    const [from, to] = raw as [unknown[], unknown[]];
    if (typeof from[0] !== "string" || typeof to[0] !== "string") return null;
    return {
      from: { node: from[0], index: Number(from[1] ?? 0), port: String(from[2] ?? "") },
      to: { node: to[0], index: Number(to[1] ?? 0), port: String(to[2] ?? "") },
    };
  }
  if (raw && typeof raw === "object" && "source" in raw && "target" in raw) {
    const { source, target } = raw as { source: { nodeId: string; outputName: string }; target: { nodeId: string; inputName: string } };
    return {
      from: { node: source.nodeId, port: source.outputName, index: 0 },
      to: { node: target.nodeId, port: target.inputName, index: 0 },
    };
  }
  return null;
}

export function writeWire(wire: Wire, style: WireStyle): unknown {
  if (style === "object") {
    return {
      source: { nodeId: wire.from.node, outputName: wire.from.port },
      target: { nodeId: wire.to.node, inputName: wire.to.port },
    };
  }
  return [
    [wire.from.node, wire.from.index, wire.from.port],
    [wire.to.node, wire.to.index, wire.to.port],
  ];
}

/** Whichever form the file already uses, so a new wire looks like its neighbours. */
export function wireStyleOf(document: EditableDocument): WireStyle {
  const first = document.connections?.[0];
  return first && !Array.isArray(first) ? "object" : "tuple";
}

/** `a.out -> b.in`: the same spelling the CLI takes. */
export function wireLabel(wire: Wire): string {
  return `${wire.from.node}.${wire.from.port} -> ${wire.to.node}.${wire.to.port}`;
}

export function sameEndpoint(a: Endpoint, b: Endpoint): boolean {
  return a.node === b.node && a.port === b.port;
}

export function moduleOf(node: EditableNode): string {
  return String(node.module ?? node.type ?? "");
}

export function parentOf(node: EditableNode): string | null {
  return typeof node.parent === "string" && node.parent ? node.parent : null;
}

export function positionOf(node: EditableNode): Point {
  const position = node.position;
  if (Array.isArray(position)) return { x: Number(position[0]) || 0, y: Number(position[1]) || 0 };
  if (position && typeof position === "object") {
    const { x, y } = position as { x?: unknown; y?: unknown };
    return { x: Number(x) || 0, y: Number(y) || 0 };
  }
  return { x: 0, y: 0 };
}

/** Keep whichever shape the node already uses; Studio's `[x, y]` otherwise. */
export function setPosition(node: EditableNode, point: Point): void {
  const position = node.position;
  const value = position && typeof position === "object" && !Array.isArray(position)
    ? { x: point.x, y: point.y }
    : [point.x, point.y];
  setOrderedKey(node, "position", value, NODE_KEY_ORDER);
}

/**
 * The key order Studio writes a node in (`Graph.nodeToJSON`). A key the editor
 * adds goes where Studio would have put it, so a node edited by the CLI and
 * then saved by Studio does not reorder.
 */
export const NODE_KEY_ORDER = [
  "id", "module", "type", "position", "source", "file", "code", "comment", "color",
  "parent", "params", "promotions", "inputs", "props", "bypass", "cook", "state",
] as const;

/**
 * Set a key without moving any other. An existing key keeps its place; a new
 * one is inserted before the first key that Studio writes after it, or at the
 * end when it is not one Studio knows.
 */
export function setOrderedKey(target: JsonObject, key: string, value: unknown, order: readonly string[]): void {
  if (key in target) {
    target[key] = value;
    return;
  }
  const rank = order.indexOf(key);
  const entries = Object.entries(target);
  const at = rank === -1 ? -1 : entries.findIndex(([name]) => {
    const other = order.indexOf(name);
    return other > rank;
  });
  if (at === -1) {
    target[key] = value;
    return;
  }
  for (const [name] of entries) delete target[name];
  entries.splice(at, 0, [key, value]);
  for (const [name, entry] of entries) target[name] = entry;
}

// ---------------------------------------------------------------------------
// Ports

export interface PortInfo {
  readonly name: string;
  readonly index: number;
  readonly kind: "data" | "trigger";
  readonly type: string;
  readonly variadic: boolean;
}

export interface NodePorts {
  readonly inputs: readonly PortInfo[];
  readonly outputs: readonly PortInfo[];
}

/** Ports in declaration order, which is the order Studio indexes them in. */
export function portsFromDefinition(definition: NodeDefinition): NodePorts {
  const list = (record: Readonly<Record<string, unknown>> | undefined): PortInfo[] =>
    Object.entries(record ?? {}).map(([name, port], index) => {
      const value = port as { kind?: string; type?: string; variadic?: boolean };
      return {
        name,
        index,
        kind: value.kind === "trigger" ? "trigger" : "data",
        type: value.type ?? "any",
        variadic: value.variadic === true,
      };
    });
  return {
    inputs: list(definition.inputs as Readonly<Record<string, unknown>> | undefined),
    outputs: list(definition.outputs as Readonly<Record<string, unknown>> | undefined),
  };
}

/**
 * A subnet's ports are not declared anywhere: they are its `Input` and
 * `Output` children, named `input_<n>` and `output_<n>`. The runtime derives
 * them the same way (`indexedBoundaryPorts` in runtime.ts); this mirrors it so
 * the editor and the runtime agree on what a subnet exposes.
 */
export function subnetPorts(children: readonly EditableNode[]): NodePorts {
  const boundary = (module: string, indexProp: string, prefix: string): PortInfo[] => {
    const found = children
      .filter((child) => moduleOf(child) === module)
      .map((child) => ({ index: integer(child.props?.[indexProp]), type: String(child.props?.dataType || "any") }))
      .filter((entry) => entry.index >= 0);
    const max = found.length ? Math.max(...found.map((entry) => entry.index)) : -1;
    return Array.from({ length: max + 1 }, (_, index) => ({
      name: `${prefix}_${index}`,
      index,
      kind: "data" as const,
      type: found.find((entry) => entry.index === index)?.type ?? "any",
      variadic: false,
    }));
  };
  return {
    inputs: boundary(INPUT, "inputIndex", "input"),
    outputs: boundary(OUTPUT, "outputIndex", "output"),
  };
}

export function typesConnect(from: PortInfo | undefined, to: PortInfo | undefined): boolean {
  if (!from || !to) return true;
  if (from.kind !== to.kind) return false;
  return from.kind === "trigger" || canConnectTypes(from.type, to.type);
}

export function integer(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isInteger(number) ? number : -1;
}

/** Deep equality for JSON values, insensitive to key order. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const other = b as unknown[];
    return a.length === other.length && a.every((value, index) => jsonEqual(value, other[index]));
  }
  const left = a as JsonObject;
  const right = b as JsonObject;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => key in right && jsonEqual(left[key], right[key]));
}
