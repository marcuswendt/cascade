import { Annotation } from './Annotation.js';
import type { Graph } from '../Graph.js';

export class LineAnnotation extends Annotation {
  endPosition?: { x: number; y: number };

  constructor(id: string, graph: Graph) {
    super(id, 'Line', graph);
  }
}
