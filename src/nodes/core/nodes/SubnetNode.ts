/**
 * SubnetNode - Network container for organizing nodes hierarchically
 * A subnet is a node that can contain child nodes, creating a nested graph
 */

import { Node } from '../../Node.js';
import type { Graph } from '../../Graph.js';
import type { OutputPort } from '@/types/node.types';

export const nodeMetadata = {
  type: 'Subnet',
  name: 'Subnet',
  icon: 'Folder',
  description: 'Network container for organizing nodes',
  category: 'network'
};

export class SubnetNode extends Node {
  private output!: OutputPort<any>;

  constructor(id: string, graph: Graph) {
    super(id, 'Subnet', graph);
  }

  protected setup(): void {
    // Subnet has one input (passed to internal Input nodes)
    this.in('input', null);

    // Subnet has one output (from internal Output node or cooking node)
    this.output = this.out('output');

    this.onUpdate = () => this.update();
    this.onReady = () => this.update();
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
  }

  /**
   * Remove a child node from this subnet
   */
  removeChild(node: Node): void {
    const index = this._children.indexOf(node);
    if (index !== -1) {
      this._children.splice(index, 1);
      node.parent = null;
    }
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
    const cookingNode = this._children.find(n => n.cooking);
    if (cookingNode) return cookingNode;

    // 3. Fall back to last node
    return this._children.length > 0 ? this._children[this._children.length - 1] : null;
  }

  /**
   * Get the cooking (display) node in this subnet
   */
  displayNode(): Node | null {
    return this._children.find(n => n.cooking) ?? null;
  }

  /**
   * Get all Input nodes inside this subnet
   */
  indirectInputs(): Node[] {
    return this._children.filter(n => n.type === 'Input');
  }

  private update(): void {
    // Get output from the output node
    const outNode = this.outputNode();
    if (outNode && outNode.outputs.length > 0) {
      this.output.setValue(outNode.outputs[0].value);

      // Pass through preview
      if (outNode.preview) {
        this.preview = outNode.preview;
      }
    } else {
      this.output.setValue(null);
      this.preview = null;
    }
  }
}
