import { Node } from '../Node.js';
import type { Graph } from '../Graph.js';
import type { OutputPort } from '../../types/node.types.js';

/**
 * Annotation style configuration
 */
export interface AnnotationStyle {
  fontSize?: number;
  fontWeight?: 'normal' | 'bold' | '600' | '700';
  fontStyle?: 'normal' | 'italic';
  textAlign?: 'left' | 'center' | 'right';
  color?: string;
  backgroundColor?: string;
  padding?: number;
  borderRadius?: number;
  borderLeft?: string;
  strokeWidth?: number;
  strokeColor?: string;
}

/**
 * Base class for all annotation types
 *
 * Annotations are visual elements on the canvas that don't execute code.
 * They can optionally have ports for data flow visualization.
 */
export class Annotation extends Node {
  // Marker property for reliable type checking (survives HMR and serialization)
  readonly isAnnotation: true = true;

  // Annotation-specific properties
  size?: { width: number; height: number };
  style?: AnnotationStyle;
  caption?: string;
  containedElements?: string[];

  constructor(id: string, type: string, graph: Graph) {
    super(id, type, graph);
  }

  /**
   * Annotations always have exactly one output at index 0
   */
  getOutput(): OutputPort | null {
    return this.getOutputPort(0);
  }

  /**
   * Annotations don't execute - override to no-op
   */
  async execute(): Promise<void> {
    // Annotations are visual-only, no execution needed
  }
}
