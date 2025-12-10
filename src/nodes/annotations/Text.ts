import { Annotation } from './Annotation.js';
import { ElementType } from '../../types/element.types.js';

export class TextAnnotation extends Annotation {
  content?: string;

  constructor(id: string) {
    super(id, ElementType.TEXT);
  }
}

