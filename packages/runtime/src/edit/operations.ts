/**
 * The edit vocabulary as data.
 *
 * Every CLI editing command parses to one of these and every MCP editing tool
 * takes one, so the two surfaces share names, fields and behaviour. The names
 * are the graph's own (node, connect, set, subnet), not a second vocabulary.
 */

import type { GraphEditor } from "./graphEditor.js";
import type { Point } from "./layout.js";
import type { Interpolation } from "./parameters.js";

export type GraphEditOperation =
  | {
      readonly op: "node.add";
      readonly module: string;
      readonly id?: string;
      /** Subnet to create the node in. */
      readonly in?: string;
      readonly position?: Point;
      readonly set?: Readonly<Record<string, unknown>>;
      /** `set` values are command-line text, read by each parameter's type. */
      readonly fromText?: boolean;
      readonly comment?: string;
    }
  | { readonly op: "node.remove"; readonly id: string; readonly recursive?: boolean }
  | { readonly op: "connect"; readonly from: string; readonly to: string; readonly layout?: boolean }
  | { readonly op: "disconnect"; readonly from?: string; readonly to: string }
  | {
      readonly op: "set";
      /** `node.param` */
      readonly target: string;
      readonly value?: unknown;
      readonly fromText?: boolean;
      readonly expression?: string | null;
      readonly keys?: readonly { frame: number; value: number }[];
      readonly removeKeys?: readonly number[];
      readonly interpolation?: Interpolation;
      readonly unset?: boolean;
    }
  | { readonly op: "subnet.create"; readonly nodes: readonly string[]; readonly id?: string; readonly label?: string }
  | { readonly op: "subnet.move"; readonly nodes: readonly string[]; readonly to: string | null }
  | { readonly op: "subnet.dissolve"; readonly id: string };

export const GRAPH_EDIT_OPERATIONS = [
  "node.add",
  "node.remove",
  "connect",
  "disconnect",
  "set",
  "subnet.create",
  "subnet.move",
  "subnet.dissolve",
] as const;

/** Apply one operation and return what it changed, in JSON-ready form. */
export function applyOperation(editor: GraphEditor, operation: GraphEditOperation): Record<string, unknown> {
  switch (operation.op) {
    case "node.add":
      return editor.addNode({
        module: operation.module,
        ...(operation.id ? { id: operation.id } : {}),
        ...(operation.in ? { parent: operation.in } : {}),
        ...(operation.position ? { position: operation.position } : {}),
        ...(operation.set ? { props: operation.set } : {}),
        ...(operation.fromText ? { fromText: true } : {}),
        ...(operation.comment ? { comment: operation.comment } : {}),
      });
    case "node.remove":
      return editor.removeNode(operation.id, { recursive: operation.recursive === true });
    case "connect":
      return editor.connect(operation.from, operation.to, { layout: operation.layout !== false });
    case "disconnect":
      return operation.from ? editor.disconnect(operation.from, operation.to) : editor.disconnect(operation.to);
    case "set": {
      const { op: _op, target, ...change } = operation;
      return editor.setParameter(target, change);
    }
    case "subnet.create":
      return editor.createSubnet({
        nodes: operation.nodes,
        ...(operation.id ? { id: operation.id } : {}),
        ...(operation.label ? { label: operation.label } : {}),
      });
    case "subnet.move":
      return editor.moveNodes(operation.nodes, operation.to === "root" ? null : operation.to);
    case "subnet.dissolve":
      return editor.dissolveSubnet(operation.id);
    default: {
      const unknown = (operation as { op?: unknown }).op;
      throw new Error(`Unknown edit operation ${JSON.stringify(unknown)}; expected one of ${GRAPH_EDIT_OPERATIONS.join(", ")}`);
    }
  }
}
