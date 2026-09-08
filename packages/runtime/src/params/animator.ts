/**
 * Resolving a graph's bound parameters at a frame.
 *
 * `resolvePropBinding` answers "what is this one parameter worth" and owns the
 * order. This is the layer above it: a graph's worth of parameters, an
 * expression engine bound to that graph, and the frame they are all resolved
 * at. The deterministic runtime had neither half — it read `saved.value` and
 * stopped — so a definition-v1 prop carrying `$T` or a drawn curve rendered as
 * a constant offline while the same document animated in Studio.
 *
 * It is generic over the node rather than importing the runtime's own, so this
 * file has no dependency on `runtime.ts` and can be exercised on its own.
 *
 * Resolution is LAZY and cycle-guarded, which is not a detail: `ch('../a/x')`
 * may name a parameter that is itself an expression, and resolving in node
 * order would hand out last frame's value for half the graph depending on
 * where the reference pointed. Pulling on demand gives the same answer
 * whatever order the nodes are in, which is the whole promise of the word
 * deterministic.
 */

import { ExpressionEvaluator } from "../expressions/evaluator.js";
import type { ExpressionScope } from "../expressions/scope.js";
import { isBoundProp, resolvePropBinding } from "./resolve.js";
import type { PropBinding } from "./resolve.js";

/** The minimum a node must be for its parameters to be resolvable. */
export interface AnimatableNode {
  readonly id: string;
  /** Resolved values, written by `resolveAll`. */
  readonly props: Record<string, unknown>;
  readonly inputs: Record<string, unknown>;
  /** Only the props that carry an expression or a channel. */
  readonly bindings: Record<string, PropBinding>;
}

export interface PropAnimatorTopology<TNode extends AnimatableNode> {
  readonly nodes: readonly TNode[];
  node(id: string): TNode | undefined;
  /** The node feeding `node`'s data input at `index`, for `opinput()`. */
  inputNode(node: TNode, index: number): TNode | null;
  /** A failed expression. The parameter has already fallen back to its stored
   *  value; this is so the host can say so rather than render a wrong number
   *  in silence. */
  report?(nodeId: string, propName: string, error: string): void;
}

export class PropAnimator<TNode extends AnimatableNode> {
  private readonly evaluator: ExpressionEvaluator<TNode>;
  private readonly resolving = new Set<string>();

  constructor(private readonly topology: PropAnimatorTopology<TNode>) {
    this.evaluator = new ExpressionEvaluator<TNode>(this.scope());
  }

  /** True when any parameter in the graph is bound at all — so a host can skip
   *  the whole pass, and a graph with no animation costs nothing. */
  get animated(): boolean {
    return this.topology.nodes.some((node) =>
      Object.values(node.bindings).some((binding) => isBoundProp(binding)),
    );
  }

  setFrame(frame: number): void {
    this.evaluator.setFrame(frame);
  }

  setFps(fps: number): void {
    this.evaluator.setFps(fps);
  }

  /** Write every bound parameter's value at the current frame into `props`. */
  resolveAll(): void {
    for (const node of this.topology.nodes)
      for (const name of Object.keys(node.bindings)) this.resolve(node, name);
  }

  /**
   * One parameter, at the current frame.
   *
   * Re-entry returns the stored value rather than throwing: a parameter whose
   * expression refers back to itself is an author's mistake, and the render
   * that names it is more use than the one that dies.
   */
  private resolve(node: TNode, name: string): unknown {
    const binding = node.bindings[name];
    if (!binding) return node.props[name];

    const key = `${node.id}.${name}`;
    if (this.resolving.has(key)) return binding.value;
    this.resolving.add(key);
    try {
      const resolved = resolvePropBinding(binding, {
        frame: this.evaluator.fframe,
        evaluateExpression: (expression) =>
          this.evaluator.evaluate(expression, node),
      });
      if (resolved.error) this.topology.report?.(node.id, name, resolved.error);
      node.props[name] = resolved.value;
      return resolved.value;
    } finally {
      this.resolving.delete(key);
    }
  }

  /**
   * The host binding the expression engine reads through.
   *
   * A path names a parameter — `./radius`, `../blur1/amount`,
   * `/root/blur1/amount` — and the last segment is always the parameter, the
   * one before it the node. Anything a graph does not have resolves to null,
   * which the engine turns into 0 / '' / [] per accessor rather than an
   * exception: one broken reference must not take a render down.
   */
  private scope(): ExpressionScope<TNode> {
    return {
      resolveParam: (from, path) => {
        const segments = split(path);
        if (!segments.length) return null;
        const name = segments[segments.length - 1];
        const owner = this.owner(from, segments.slice(0, -1));
        if (!owner) return null;
        // Through `resolve`, so a reference to a keyed or expressed parameter
        // reads what it is worth at this frame rather than what it was saved
        // as. Reading the stored value here is the bug that makes `ch()` look
        // like it works until somebody keys the parameter it points at.
        if (owner.bindings[name]) return { value: this.resolve(owner, name) };
        if (name in owner.props) return { value: owner.props[name] };
        if (name in owner.inputs) return { value: owner.inputs[name] };
        return null;
      },
      nodeExists: (from, path) => {
        const segments = split(path);
        if (!segments.length) return false;
        const last = segments[segments.length - 1];
        if (last === "..") return true;
        return last === from.id || !!this.topology.node(last);
      },
      inputNode: (from, index) => this.topology.inputNode(from, index),
    };
  }

  /** The node a path's leading segments name, or `from` when they name none. */
  private owner(from: TNode, segments: readonly string[]): TNode | undefined {
    for (let i = segments.length - 1; i >= 0; i--) {
      if (segments[i] === "..") continue;
      return this.topology.node(segments[i]);
    }
    return from;
  }
}

/** Path segments, with the no-ops (`.`, empty, a trailing root slash) dropped
 *  but `..` kept, because it is the one that means something. */
function split(path: string): string[] {
  return String(path ?? "")
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".");
}
