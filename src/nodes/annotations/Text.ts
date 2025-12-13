import { Annotation } from './Annotation.js';
import type { Graph } from '../Graph.js';

export class TextAnnotation extends Annotation {
  content?: string;

  constructor(id: string, graph: Graph) {
    super(id, 'Text', graph);
  }
}
