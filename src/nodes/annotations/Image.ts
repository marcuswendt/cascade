import { Annotation } from './Annotation.js';

export class ImageAnnotation extends Annotation {
  src?: string;

  constructor(id: string) {
    super(id, 'image');
  }
}

