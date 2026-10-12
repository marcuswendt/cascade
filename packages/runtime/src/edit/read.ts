/**
 * A graph as an agent reads it: nodes with their stored parameters, wires in
 * the same `a.out -> b.in` spelling the CLI takes, and each subnet's ports.
 *
 * Read from the document alone, so it answers instantly and shows exactly
 * what is stored — not a cooked value, and not a default the file does not
 * contain. Use `cascade inspect` for definitions.
 */

import { moduleOf, parentOf, positionOf, readWire, subnetPorts, wireLabel, SUBNET, type EditableDocument } from "./document.js";
import type { Point } from "./layout.js";

export interface GraphReadNode {
  readonly id: string;
  readonly module: string;
  readonly parent: string | null;
  readonly position: Point;
  readonly comment?: string;
  readonly props?: Readonly<Record<string, unknown>>;
  readonly inputs?: unknown;
  /** For a subnet: its ports, named `input_<n>` / `output_<n>`, with the label each carries. */
  readonly ports?: { readonly inputs: readonly string[]; readonly outputs: readonly string[] };
}

export interface GraphRead {
  readonly name: string | null;
  readonly nodes: readonly GraphReadNode[];
  readonly wires: readonly string[];
  /** Ids of the top-level nodes, in file order: the graph's first screen. */
  readonly top: readonly string[];
}

export function readGraph(document: EditableDocument, options: { in?: string } = {}): GraphRead {
  const scope = options.in ?? null;
  const inScope = new Set(scope === null ? document.nodes.map((node) => node.id) : descendants(document, scope));
  const nodes = document.nodes.filter((node) => inScope.has(node.id)).map((node): GraphReadNode => {
    const children = document.nodes.filter((child) => parentOf(child) === node.id);
    const labelled = (prefix: string, indexProp: string, nameProp: string) => (port: { name: string; index: number }) => {
      const boundary = children.find((child) =>
        Number(child.props?.[indexProp]) === port.index && moduleOf(child) === `cascade.core.${prefix}`);
      const label = boundary?.comment || boundary?.props?.[nameProp];
      return label ? `${port.name} (${label})` : port.name;
    };
    const ports = moduleOf(node) === SUBNET ? subnetPorts(children) : null;
    return {
      id: node.id,
      module: moduleOf(node),
      parent: parentOf(node),
      position: positionOf(node),
      ...(typeof node.comment === "string" && node.comment ? { comment: node.comment } : {}),
      ...(node.props && Object.keys(node.props).length ? { props: node.props } : {}),
      ...(node.inputs !== undefined ? { inputs: node.inputs } : {}),
      ...(ports ? {
        ports: {
          inputs: ports.inputs.map(labelled("Input", "inputIndex", "inputName")),
          outputs: ports.outputs.map(labelled("Output", "outputIndex", "outputName")),
        },
      } : {}),
    };
  });
  const wires = (document.connections ?? [])
    .map(readWire)
    .filter((wire) => wire && inScope.has(wire.from.node) && inScope.has(wire.to.node))
    .map((wire) => wireLabel(wire!));
  const metadata = document.metadata as { name?: unknown } | undefined;
  return {
    name: typeof metadata?.name === "string" ? metadata.name : null,
    nodes,
    wires,
    top: nodes.filter((node) => node.parent === scope).map((node) => node.id),
  };
}

function descendants(document: EditableDocument, id: string): string[] {
  if (!document.nodes.some((node) => node.id === id)) throw new Error(`No node "${id}"`);
  const result: string[] = [];
  const queue = [id];
  while (queue.length) {
    const current = queue.shift()!;
    for (const child of document.nodes) {
      if (parentOf(child) === current) {
        result.push(child.id);
        queue.push(child.id);
      }
    }
  }
  return result;
}
