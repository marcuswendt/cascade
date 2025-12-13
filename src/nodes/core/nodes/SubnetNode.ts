/**
 * SubnetNode - Network container for organizing nodes hierarchically
 * A subnet is a node that can contain child nodes, creating a nested graph
 */

import { Node } from '../../Node.js';
import type { Graph } from '../../Graph.js';
import type { InputPort, OutputPort } from '@/types/node.types';

export const nodeMetadata = {
  type: 'Subnet',
  name: 'Subnet',
  icon: 'Folder',
  description: 'Network container for organizing nodes',
  category: 'network'
};

export class SubnetNode extends Node {
  constructor(id: string, graph: Graph) {
    super(id, 'Subnet', graph);
  }

  protected setup(): void {
    // Ports are dynamically created based on child Input/Output nodes
    // Start with no ports - they'll be synced when children are added
    this.onUpdate = () => this.update();
    this.onReady = () => {
      this.syncPorts();
      this.update();
    };
  }

  /**
   * Override: Subnets are networks and can contain children
   */
  isNetwork(): boolean {
    return true;
  }

  /**
   * Add a child node to this subnet
   */
  addChild(node: Node): void {
    node.parent = this;
    this._children.push(node);
    // Sync ports when Input/Output nodes are added
    if (node.type === 'Input' || node.type === 'Output') {
      this.syncPorts();
    }
  }

  /**
   * Remove a child node from this subnet
   */
  removeChild(node: Node): void {
    const index = this._children.indexOf(node);
    if (index !== -1) {
      const wasInputOutput = node.type === 'Input' || node.type === 'Output';
      this._children.splice(index, 1);
      node.parent = null;
      // Sync ports when Input/Output nodes are removed
      if (wasInputOutput) {
        this.syncPorts();
      }
    }
  }

  /**
   * Sync input/output ports based on child Input/Output nodes
   */
  syncPorts(): void {
    // Find all Input nodes and determine required input ports
    const inputNodes = this._children.filter(n => n.type === 'Input');
    const maxInputIndex = inputNodes.reduce((max, node) => {
      const idx = (node as any).inputIndex ?? 0;
      return Math.max(max, idx);
    }, -1);

    // Find all Output nodes and determine required output ports
    const outputNodes = this._children.filter(n => n.type === 'Output');
    const maxOutputIndex = outputNodes.reduce((max, node) => {
      const idx = (node as any).outputIndex ?? 0;
      return Math.max(max, idx);
    }, -1);

    // Sync input ports
    const requiredInputs = maxInputIndex + 1;
    const currentInputs = this.inputs.length;

    // Add missing input ports
    for (let i = currentInputs; i < requiredInputs; i++) {
      const port = this.in(`input_${i}`, null);
      // When input value changes, update any Input nodes referencing this index
      port.onChange = (value: any) => {
        this._children
          .filter(n => n.type === 'Input' && (n as any).inputIndex === i)
          .forEach(n => n.markDirty());
      };
    }

    // Hide excess input ports (don't remove to preserve connections)
    for (let i = requiredInputs; i < currentInputs; i++) {
      if (this.inputs[i]) {
        this.inputs[i].options = { ...this.inputs[i].options, hidden: true };
      }
    }
    // Unhide needed ports
    for (let i = 0; i < requiredInputs; i++) {
      if (this.inputs[i]) {
        this.inputs[i].options = { ...this.inputs[i].options, hidden: false };
      }
    }

    // Sync output ports - only create if there are Output nodes
    const requiredOutputs = maxOutputIndex + 1; // 0 if no Output nodes
    const currentOutputs = this.outputs.length;

    // Add missing output ports
    for (let i = currentOutputs; i < requiredOutputs; i++) {
      this.out(`output_${i}`);
    }

    // Hide excess output ports
    for (let i = requiredOutputs; i < currentOutputs; i++) {
      if (this.outputs[i]) {
        this.outputs[i].options = { ...this.outputs[i].options, hidden: true };
      }
    }
    // Unhide needed ports
    for (let i = 0; i < requiredOutputs; i++) {
      if (this.outputs[i]) {
        this.outputs[i].options = { ...this.outputs[i].options, hidden: false };
      }
    }

    // Trigger reactivity
    this.inputs = [...this.inputs];
    this.outputs = [...this.outputs];
  }

  /**
   * Get the node that defines this subnet's output
   * Priority: Output node > cooking node > last node
   */
  outputNode(): Node | null {
    // 1. Check for explicit Output node
    const outputNode = this._children.find(n => n.type === 'Output');
    if (outputNode) return outputNode;

    // 2. Use cooking node
    const cookingNode = this._children.find(n => n.cook);
    if (cookingNode) return cookingNode;

    // 3. Fall back to last node
    return this._children.length > 0 ? this._children[this._children.length - 1] : null;
  }

  /**
   * Get the cooking (display) node in this subnet
   */
  displayNode(): Node | null {
    return this._children.find(n => n.cook) ?? null;
  }

  /**
   * Get all Input nodes inside this subnet
   */
  indirectInputs(): Node[] {
    return this._children.filter(n => n.type === 'Input');
  }

  private update(): void {
    // Update each output based on corresponding Output nodes
    const outputNodes = this._children.filter(n => n.type === 'Output');

    // Group output nodes by their outputIndex
    const outputByIndex = new Map<number, Node>();
    for (const node of outputNodes) {
      const idx = (node as any).outputIndex ?? 0;
      outputByIndex.set(idx, node);
    }

    // Update each output port
    for (let i = 0; i < this.outputs.length; i++) {
      const outNode = outputByIndex.get(i);
      if (outNode && outNode.inputs.length > 0) {
        const value = outNode.inputs[0].value;
        this.outputs[i].setValue(value);

        // Set preview from first output
        if (i === 0 && (value instanceof HTMLCanvasElement || value instanceof HTMLImageElement)) {
          this.preview = value;
        }
      } else if (i === 0) {
        // Fallback for first output: use cooking node if no Output node
        const cookingNode = this._children.find(n => n.cook);
        if (cookingNode && cookingNode.outputs.length > 0) {
          this.outputs[i].setValue(cookingNode.outputs[0].value);
          if (cookingNode.preview) {
            this.preview = cookingNode.preview;
          }
        } else {
          this.outputs[i].setValue(null);
        }
      } else {
        this.outputs[i].setValue(null);
      }
    }

    // Clear preview if no outputs set it
    if (this.outputs.length === 0 || !outputByIndex.has(0)) {
      const cookingNode = this._children.find(n => n.cook);
      if (!cookingNode?.preview) {
        this.preview = null;
      }
    }
  }
}
