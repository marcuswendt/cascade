import { Annotation } from './Annotation.js';

export class PolylineAnnotation extends Annotation {
  points?: { x: number; y: number }[];

  constructor(id: string) {
    super(id, 'polyline');
  }
}

