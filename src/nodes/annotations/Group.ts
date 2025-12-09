import { Annotation } from './Annotation.js';

export class GroupAnnotation extends Annotation {
  constructor(id: string) {
    super(id, 'group');
  }
}

