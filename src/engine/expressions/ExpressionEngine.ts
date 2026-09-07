/**
 * Expression Engine for Cascade — Studio binding
 *
 * The engine itself now lives in the neutral runtime
 * (`@cascade/runtime/expressions`), so a headless cook can evaluate a
 * parameter expression with the same code Studio uses. What remains here is the
 * binding to Studio's compatibility `Graph`/`Node`: path resolution, input
 * lookup, and graph-wide path validation.
 *
 * Expressions have access to:
 * - Channel functions: ch(), chs(), chv()
 * - Time variables: $F / $FF / $T / $FPS, with time, frame, fframe, fps as aliases
 * - Math utilities: fit(), clamp(), lerp(), noise(), etc.
 * - Node queries: opexist(), opinput()
 */

import { ExpressionEvaluator } from '@cascade/runtime/expressions';
import type {
  CompiledExpression as RuntimeCompiledExpression,
  ExpressionContext as RuntimeExpressionContext,
  ExpressionScope,
  PathWarning
} from '@cascade/runtime/expressions';
import type { Node } from '../../nodes/Node.js';
import type { Graph } from '../../nodes/Graph.js';

/** Expression context passed to evaluated expressions */
export type ExpressionContext = RuntimeExpressionContext<Node>;

/** Compiled expression ready for evaluation */
export type CompiledExpression = RuntimeCompiledExpression<Node>;

export type { PathWarning };

/**
 * Expression Engine - compiles and evaluates expressions against a Studio graph
 */
export class ExpressionEngine extends ExpressionEvaluator<Node> {
  private graph: Graph | null = null;

  constructor() {
    super();
    const scope: ExpressionScope<Node> = {
      resolveParam: (from, path) => this.resolveNodePath(from, path),
      nodeExists: (from, path) => from.node(path) !== null,
      inputNode: (from, index) => this.resolveInput(from, index)
    };
    this.setScope(scope);
  }

  /**
   * Set the graph reference for node lookups
   */
  setGraph(graph: Graph): void {
    this.graph = graph;
  }

  /**
   * Resolve a path to get the parameter value
   */
  private resolveNodePath(fromNode: Node, path: string): { value: unknown } | null {
    // Parse path: could be node path or node/param path
    const lastSlash = path.lastIndexOf('/');

    if (lastSlash === -1 || path.startsWith('./')) {
      // Relative to current node - it's a param name
      const paramName = path.replace('./', '');
      const prop = fromNode.props[paramName];
      return prop ? { value: prop.value } : null;
    }

    // Try to resolve as node/param
    const nodePath = path.substring(0, lastSlash) || '.';
    const paramName = path.substring(lastSlash + 1);

    const targetNode = fromNode.node(nodePath);
    if (!targetNode) return null;

    const prop = targetNode.props[paramName];
    return prop ? { value: prop.value } : null;
  }

  /**
   * Get input node by index
   */
  private resolveInput(node: Node, index: number): Node | null {
    if (!this.graph) return null;

    const inputPort = node.inputs[index];
    if (!inputPort || inputPort.connections.length === 0) return null;

    const conn = inputPort.connections[0];
    return this.graph.getNode(conn.from.nodeId);
  }

  /**
   * Validate all expression paths in the graph
   * Returns list of broken paths with their locations
   */
  validateAllPaths(): PathWarning[] {
    if (!this.graph) return [];

    const warnings: PathWarning[] = [];

    for (const node of this.graph.nodes) {
      for (const [propKey, prop] of Object.entries(node.props)) {
        if (!prop.expression) continue;

        // Extract paths from expression
        const paths = this.extractDependencies(prop.expression);

        for (const path of paths) {
          if (!this.validatePath(node, path)) {
            warnings.push({
              nodeId: node.id,
              nodePath: node.path(),
              propName: propKey,
              expression: prop.expression,
              brokenPath: path
            });
          }
        }
      }
    }

    return warnings;
  }
}

// Global singleton instance
export const expressionEngine = new ExpressionEngine();
