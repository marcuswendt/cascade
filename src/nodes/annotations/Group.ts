import { Annotation } from './Annotation.js';
import { ElementType } from '../../types/element.types.js';

export class GroupAnnotation extends Annotation {
  constructor(id: string) {
    super(id, ElementType.GROUP);
  }
}

