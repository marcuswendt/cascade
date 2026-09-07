/**
 * The host binding for expression evaluation.
 *
 * The expression engine needs to read parameters off neighbouring nodes and to
 * follow inputs, but it must not know what a node *is* — that is what kept it
 * pinned to Studio's compatibility `Graph`/`Node`. A host supplies a scope; the
 * engine stays neutral and works unchanged in a headless cook.
 */

/** The minimum a node must offer to be addressable from an expression. */
export interface Node {
  id: string;
}

export interface ExpressionScope<TNode = Node> {
  /**
   * Resolve a channel path relative to a node, e.g. `./radius`,
   * `../blur1/amount`, `/root/node/value`. Return null when it does not
   * resolve — the engine turns that into 0 / '' / [] per accessor.
   */
  resolveParam(from: TNode, path: string): { value: unknown } | null;

  /** True if a node exists at the path, relative to `from`. */
  nodeExists(from: TNode, path: string): boolean;

  /** The node connected to `from`'s input at `index`, if any. */
  inputNode(from: TNode, index: number): TNode | null;
}
