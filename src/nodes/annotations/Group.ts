import { Annotation } from './Annotation.js';
import type { Graph } from '../Graph.js';

export class GroupAnnotation extends Annotation {
  constructor(id: string, graph: Graph) {
    super(id, 'Group', graph);
  }
}
