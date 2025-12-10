import { Annotation } from './Annotation.js';
import { ElementType } from '../../types/element.types.js';

export class LineAnnotation extends Annotation {
  endPosition?: { x: number; y: number };

  constructor(id: string) {
    super(id, ElementType.LINE);
  }
}

