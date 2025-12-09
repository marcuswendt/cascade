import type { InputPort, OutputPort } from '../../types/node.types.js';

/**
 * Base class for all canvas elements (computations and annotations)
 */
export abstract class Node {
  id: string;
  type: string;
  position: { x: number; y: number };
  inputs: InputPort[] = [];
  outputs: OutputPort[] = [];

  constructor(id: string, type: string) {
    this.id = id;
    this.type = type;
    this.position = { x: 0, y: 0 };
  }

  /**
   * Get an input port by index
   */
  getInputPort(index: number): InputPort | null {
    if (index < 0 || index >= this.inputs.length) {
      return null;
    }
    return this.inputs[index];
  }

  /**
   * Get an output port by index
   */
  getOutputPort(index: number): OutputPort | null {
    if (index < 0 || index >= this.outputs.length) {
      return null;
    }
    return this.outputs[index];
  }

  /**
   * Get a port by ID
   */
  getPort(portId: string): InputPort | OutputPort | null {
    const input = this.inputs.find(p => p.id === portId);
    if (input) return input;
    const output = this.outputs.find(p => p.id === portId);
    return output || null;
  }
}

