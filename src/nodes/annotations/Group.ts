import { Annotation } from './Annotation.js';
import { ElementType } from '../../types/element.types.js';
import type { Graph } from '../../core/engine/Graph.js';

export class GroupAnnotation extends Annotation {
  constructor(id: string, graph: Graph) {
    super(id, ElementType.GROUP, graph);
  }
}
