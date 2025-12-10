import { Annotation } from './Annotation.js';
import { ElementType } from '../../types/element.types.js';

export class PolylineAnnotation extends Annotation {
  points?: { x: number; y: number }[];

  constructor(id: string) {
    super(id, ElementType.POLYLINE);
  }
}

