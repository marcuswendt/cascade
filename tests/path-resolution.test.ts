/**
 * Path Resolution Tests
 * Tests for hierarchical path system: path(), node(), relativePathTo(), children(), isNetwork()
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';
import { SubnetNode } from '@/nodes/core/nodes/SubnetNode';

describe('Path System', () => {
  let graph: Graph;

  beforeEach(() => {
    graph = new Graph();
  });

  describe('Node.path()', () => {
    it('should return "/" for root-level nodes', () => {
      const node = new Node('blur1', 'Blur', graph);
      graph.addElement(node);
      expect(node.path()).toBe('/blur1');
    });

    it('should return full path for nested nodes', () => {
      const subnet = new SubnetNode('effects', graph);
      graph.addElement(subnet);

      const blur = new Node('blur1', 'Blur', graph);
      subnet.addChild(blur);

      expect(blur.path()).toBe('/effects/blur1');
    });

    it('should return deeply nested paths', () => {
      const subnet1 = new SubnetNode('level1', graph);
      graph.addElement(subnet1);

      const subnet2 = new SubnetNode('level2', graph);
      subnet1.addChild(subnet2);

      const subnet3 = new SubnetNode('level3', graph);
      subnet2.addChild(subnet3);

      const node = new Node('deepNode', 'Test', graph);
      subnet3.addChild(node);

      expect(node.path()).toBe('/level1/level2/level3/deepNode');
    });
  });

  describe('Node.node() - relative path resolution', () => {
    let root: SubnetNode;
    let effects: SubnetNode;
    let blur1: Node;
    let blur2: Node;
    let timer1: Node;

    beforeEach(() => {
      // Create structure:
      // / (root)
      //   effects (subnet)
      //     blur1
      //     blur2
      //   timer1
      root = new SubnetNode('root', graph);
      graph.addElement(root);

      effects = new SubnetNode('effects', graph);
      root.addChild(effects);

      blur1 = new Node('blur1', 'Blur', graph);
      blur2 = new Node('blur2', 'Blur', graph);
      effects.addChild(blur1);
      effects.addChild(blur2);

      timer1 = new Node('timer1', 'Timer', graph);
      root.addChild(timer1);
    });

    it('should resolve child paths', () => {
      const found = effects.node('blur1');
      expect(found).toBe(blur1);
    });

    it('should resolve sibling paths with ../', () => {
      const found = blur1.node('../blur2');
      expect(found).toBe(blur2);
    });

    it('should resolve parent paths with ../', () => {
      const found = blur1.node('..');
      expect(found).toBe(effects);
    });

    it('should resolve multiple parent levels with ../../', () => {
      const found = blur1.node('../..');
      expect(found).toBe(root);
    });

    it('should resolve cross-branch paths', () => {
      // From blur1 to timer1
      const found = blur1.node('../../timer1');
      expect(found).toBe(timer1);
    });

    it('should return null for non-existent paths', () => {
      const found = blur1.node('../nonexistent');
      expect(found).toBeNull();
    });

    it('should return null for empty path', () => {
      const found = blur1.node('');
      expect(found).toBeNull();
    });

    it('should handle ./ self-reference (stay at current node)', () => {
      // ./ with no additional path returns the current node
      const found = blur1.node('./');
      expect(found).toBe(blur1);
    });
  });

  describe('Graph.nodeByPath()', () => {
    it('walks every absolute path segment', () => {
      const effects = new SubnetNode('effects', graph);
      const blur = new Node('blur1', 'Blur', graph);
      graph.addElement(effects);
      graph.addElement(blur);
      effects.addChild(blur);

      expect(graph.nodeByPath('/effects/blur1')).toBe(blur);
      expect(graph.nodeByPath('/wrong/blur1')).toBeNull();
      expect(graph.nodeByPath('/blur1')).toBeNull();
    });

    it('returns null when an intermediate segment is not a network', () => {
      const plain = new Node('plain', 'Plain', graph);
      const child = new Node('child', 'Child', graph);
      graph.addElement(plain);
      graph.addElement(child);

      expect(graph.nodeByPath('/plain/child')).toBeNull();
    });
  });

  describe('Graph.reparentElement()', () => {
    it('moves nodes between networks and rejects cycles', () => {
      const outer = new SubnetNode('outer', graph);
      const inner = new SubnetNode('inner', graph);
      const child = new Node('child', 'Plain', graph);
      graph.addElement(outer);
      graph.addElement(inner);
      graph.addElement(child);

      expect(graph.reparentElement(inner, outer)).toBe(true);
      expect(graph.reparentElement(child, inner)).toBe(true);
      expect(inner.children()).toContain(child);

      expect(graph.reparentElement(child, outer)).toBe(true);
      expect(inner.children()).not.toContain(child);
      expect(outer.children()).toContain(child);
      expect(child.parent).toBe(outer);

      expect(graph.reparentElement(outer, inner)).toBe(false);
      expect(graph.reparentElement(child, null)).toBe(true);
      expect(child.parent).toBeNull();
      expect(outer.children()).not.toContain(child);
    });
  });

  describe('Node.relativePathTo()', () => {
    let root: SubnetNode;
    let effects: SubnetNode;
    let utils: SubnetNode;
    let blur1: Node;
    let timer1: Node;

    beforeEach(() => {
      // Create structure:
      // / (root)
      //   effects (subnet)
      //     blur1
      //   utils (subnet)
      //     timer1
      root = new SubnetNode('root', graph);
      graph.addElement(root);

      effects = new SubnetNode('effects', graph);
      root.addChild(effects);

      blur1 = new Node('blur1', 'Blur', graph);
      effects.addChild(blur1);

      utils = new SubnetNode('utils', graph);
      root.addChild(utils);

      timer1 = new Node('timer1', 'Timer', graph);
      utils.addChild(timer1);
    });

    it('should return sibling path', () => {
      const path = blur1.relativePathTo(timer1);
      expect(path).toBe('../../utils/timer1');
    });

    it('should return child path', () => {
      const path = effects.relativePathTo(blur1);
      expect(path).toBe('blur1');
    });

    it('should return parent path', () => {
      const path = blur1.relativePathTo(effects);
      expect(path).toBe('..');
    });

    it('should return same network sibling path', () => {
      const blur2 = new Node('blur2', 'Blur', graph);
      effects.addChild(blur2);

      const path = blur1.relativePathTo(blur2);
      expect(path).toBe('../blur2');
    });
  });

  describe('Network operations', () => {
    it('should return false for isNetwork() on regular nodes', () => {
      const node = new Node('test', 'Test', graph);
      graph.addElement(node);
      expect(node.isNetwork()).toBe(false);
    });

    it('should return true for isNetwork() on SubnetNode', () => {
      const subnet = new SubnetNode('subnet', graph);
      graph.addElement(subnet);
      expect(subnet.isNetwork()).toBe(true);
    });

    it('should return empty array for children() on regular nodes', () => {
      const node = new Node('test', 'Test', graph);
      graph.addElement(node);
      expect(node.children()).toEqual([]);
    });

    it('should return children for SubnetNode', () => {
      const subnet = new SubnetNode('subnet', graph);
      graph.addElement(subnet);

      const child1 = new Node('child1', 'Test', graph);
      const child2 = new Node('child2', 'Test', graph);
      subnet.addChild(child1);
      subnet.addChild(child2);

      expect(subnet.children()).toHaveLength(2);
      expect(subnet.children()).toContain(child1);
      expect(subnet.children()).toContain(child2);
    });
  });

  describe('SubnetNode specific operations', () => {
    let subnet: SubnetNode;
    let node1: Node;
    let node2: Node;

    beforeEach(() => {
      subnet = new SubnetNode('mySubnet', graph);
      graph.addElement(subnet);

      node1 = new Node('node1', 'Test', graph);
      node2 = new Node('node2', 'Test', graph);
      subnet.addChild(node1);
      subnet.addChild(node2);
    });

    it('should set parent reference when adding child', () => {
      expect(node1.parent).toBe(subnet);
      expect(node2.parent).toBe(subnet);
    });

    it('should remove child and clear parent reference', () => {
      subnet.removeChild(node1);
      expect(node1.parent).toBeNull();
      expect(subnet.children()).not.toContain(node1);
      expect(subnet.children()).toContain(node2);
    });

    it('should return last node as outputNode when no cooking node', () => {
      expect(subnet.outputNode()).toBe(node2);
    });

    it('should return cooking node as outputNode', () => {
      node1.cook = true;
      expect(subnet.outputNode()).toBe(node1);
    });

    it('should return null for displayNode when no cooking node', () => {
      expect(subnet.displayNode()).toBeNull();
    });

    it('should return cooking node for displayNode', () => {
      node1.cook = true;
      expect(subnet.displayNode()).toBe(node1);
    });
  });

  describe('Hierarchy removal', () => {
    it('removes a subnet descendants, incident connections, and pending connections', () => {
      const source = new Node('source', 'Source', graph);
      const subnet = new SubnetNode('subnet', graph);
      const nested = new SubnetNode('nested', graph);
      const child = new Node('child', 'Child', graph);
      const target = new Node('target', 'Target', graph);
      for (const node of [source, subnet, nested, child, target]) graph.addElement(node);
      subnet.addChild(nested);
      nested.addChild(child);

      const sourceOut = source.out('value');
      const childIn = child.in('value');
      const childOut = child.out('value');
      const targetIn = target.in('value');
      graph.connect(sourceOut, childIn);
      graph.connect(childOut, targetIn);
      (graph as any)._connectionsToRestore = [
        [['source', 0, 'value'], ['child', 0, 'value']],
        [['target', 0, 'value'], ['source', 0, 'value']],
      ];

      graph.removeElement('subnet');

      expect(graph.elements.map(node => node.id)).toEqual(['source', 'target']);
      expect(graph.connections).toHaveLength(0);
      expect(sourceOut.connections).toHaveLength(0);
      expect(targetIn.connections).toHaveLength(0);
      expect((graph as any)._connectionsToRestore).toEqual([
        [['target', 0, 'value'], ['source', 0, 'value']],
      ]);
      expect(nested.parent).toBeNull();
      expect(child.parent).toBeNull();
    });

    it('detaches a directly removed child and destroys descendants deepest-first', () => {
      const destroyed: string[] = [];
      const subnet = new SubnetNode('subnet', graph);
      const nested = new SubnetNode('nested', graph);
      const child = new Node('child', 'Child', graph);
      for (const node of [subnet, nested, child]) graph.addElement(node);
      subnet.addChild(nested);
      nested.addChild(child);
      child.onDestroy = () => destroyed.push('child');
      nested.onDestroy = () => destroyed.push('nested');

      graph.removeElement('nested');

      expect(subnet.children()).toEqual([]);
      expect(graph.getNode('nested')).toBeNull();
      expect(graph.getNode('child')).toBeNull();
      expect(destroyed).toEqual(['child', 'nested']);
    });
  });

  describe('Cooking exclusivity', () => {
    it('should clear cooking from siblings when setting cooking', () => {
      const subnet = new SubnetNode('subnet', graph);
      graph.addElement(subnet);

      const node1 = new Node('node1', 'Test', graph);
      const node2 = new Node('node2', 'Test', graph);
      const node3 = new Node('node3', 'Test', graph);
      subnet.addChild(node1);
      subnet.addChild(node2);
      subnet.addChild(node3);

      // Set node1 as cooking
      node1.setCook(true);
      expect(node1.cook).toBe(true);
      expect(node2.cook).toBe(false);
      expect(node3.cook).toBe(false);

      // Set node2 as cooking - should clear node1
      node2.setCook(true);
      expect(node1.cook).toBe(false);
      expect(node2.cook).toBe(true);
      expect(node3.cook).toBe(false);

      // Set node3 as cooking - should clear node2
      node3.setCook(true);
      expect(node1.cook).toBe(false);
      expect(node2.cook).toBe(false);
      expect(node3.cook).toBe(true);
    });
  });
});
