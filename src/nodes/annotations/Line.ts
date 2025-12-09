import { Annotation } from './Annotation.js';

export class LineAnnotation extends Annotation {
  endPosition?: { x: number; y: number };

  constructor(id: string) {
    super(id, 'line');
  }
}

