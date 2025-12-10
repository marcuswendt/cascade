import { Node } from '../../core/engine/Node.js';
import type { OutputPort } from '../../types/node.types.js';

/**
 * Base class for all annotation types
 */
export class Annotation extends Node {
  size?: { width: number; height: number };
  style?: {
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
  };
  caption?: string;
  containedElements?: string[];

  constructor(id: string, type: string) {
    super(id, 'annotation', type);
  }

  /**
   * Annotations always have exactly one output at index 0
   */
  getOutput(): OutputPort | null {
    return this.getOutputPort(0);
  }
}

