import { Annotation } from './Annotation.js';
import { ElementType } from '../../types/element.types.js';

export class ImageAnnotation extends Annotation {
  src?: string;

  constructor(id: string) {
    super(id, ElementType.IMAGE);
  }
}

