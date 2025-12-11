import { Node, type AnnotationStyle } from '../../core/engine/Node.js';
import type { Graph } from '../../core/engine/Graph.js';
import type { OutputPort } from '../../types/node.types.js';

// Re-export for convenience
export type { AnnotationStyle };

/**
 * Base class for all annotation types
 *
 * Annotations are visual elements on the canvas that don't execute code.
 * They can optionally have ports for data flow visualization.
 */
export class Annotation extends Node {
  constructor(id: string, type: string, graph: Graph) {
    super(id, type, graph, 'annotation');
  }

  /**
   * Annotations always have exactly one output at index 0
   */
  getOutput(): OutputPort | null {
    return this.getOutputPort(0);
  }
}
