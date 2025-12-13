import { Annotation } from './Annotation.js';
import type { Graph } from '../Graph.js';

export class PolylineAnnotation extends Annotation {
  points?: { x: number; y: number }[];

  constructor(id: string, graph: Graph) {
    super(id, 'Polyline', graph);
  }
}
