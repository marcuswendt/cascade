import { Annotation } from './Annotation.js';
import { ElementType } from '../../types/element.types.js';
import type { Graph } from '../../core/engine/Graph.js';

export class LineAnnotation extends Annotation {
  endPosition?: { x: number; y: number };

  constructor(id: string, graph: Graph) {
    super(id, ElementType.LINE, graph);
  }
}
