import { Annotation } from './Annotation.js';
import type { Graph } from '../Graph.js';

export class ImageAnnotation extends Annotation {
  src?: string;

  constructor(id: string, graph: Graph) {
    super(id, 'Image', graph);
  }
}
