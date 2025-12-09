import { Annotation } from './Annotation.js';

export class TextAnnotation extends Annotation {
  content?: string;

  constructor(id: string) {
    super(id, 'text');
  }
}

