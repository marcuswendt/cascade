import { describe, expect, it } from 'vitest';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';
import { GroupAnnotation } from '@/nodes/annotations/Group';
import { SubnetNode } from '@/nodes/core/nodes/SubnetNode';
import '@/nodes/core';

function addGroup(graph: Graph, id: string, members: string[] = []): GroupAnnotation {
  const group = new GroupAnnotation(id, graph);
  group.containedElements = members;
  graph.addElement(group);
  return group;
}

function addNode(graph: Graph, id: string): Node {
  const node = new Node(id, 'Test', graph);
  graph.addElement(node);
  return node;
}

describe('Graph group ownership', () => {
  it('round-trips membership without changing the document format', () => {
    const graph = Graph.fromJSON({
      version: '0.2',
      nodes: [
        { id: 'subnet', module: 'cascade.core.Subnet', source: 'stdlib', position: [0, 0] },
        { id: 'member', module: 'local.Member', source: 'embedded', parent: 'subnet', position: [1, 2] },
      ],
      annotations: [{ id: 'group', type: 'Group', parent: 'subnet', position: [3, 4], containedElements: ['member'] }],
      connections: [],
    });

    expect(graph.getGroupMembers('group')).toEqual(['member']);
    const serialized = graph.toJSON();
    expect(serialized.annotations).toContainEqual(expect.objectContaining({
      id: 'group',
      containedElements: ['member'],
    }));

    graph.getAnnotation('group')!.containedElements!.push('later-edit');
    expect(serialized.annotations.find((annotation: any) => annotation.id === 'group').containedElements)
      .toEqual(['member']);
  });

  it('traverses nested groups in authored order and tolerates malformed cycles', () => {
    const graph = new Graph();
    addNode(graph, 'a');
    addNode(graph, 'b');
    addGroup(graph, 'outer', ['a', 'inner', 'a']);
    addGroup(graph, 'inner', ['b', 'outer']);

    expect(graph.getGroupMembers('outer', false)).toEqual(['a', 'inner']);
    expect(graph.getGroupMembers('outer')).toEqual(['a', 'inner', 'b']);
    expect(graph.getGroupMembers('missing')).toEqual([]);
  });

  it('transfers a member between its single owner and removes ownership', () => {
    const graph = new Graph();
    const node = addNode(graph, 'member');
    const first = addGroup(graph, 'first', ['member']);
    const second = addGroup(graph, 'second');

    expect(graph.assignToGroup([node.id, node.id], second.id)).toBe(true);
    expect(first.containedElements).toEqual([]);
    expect(second.containedElements).toEqual(['member']);

    expect(graph.assignToGroup(['member'], null)).toBe(true);
    expect(second.containedElements).toEqual([]);
  });

  it('rejects missing, cyclic, and cross-network assignments atomically', () => {
    const graph = new Graph();
    const subnet = new SubnetNode('subnet', graph);
    graph.addElement(subnet);
    const rootNode = addNode(graph, 'root-node');
    const nestedNode = addNode(graph, 'nested-node');
    const outer = addGroup(graph, 'outer', ['inner']);
    const inner = addGroup(graph, 'inner');
    graph.reparentElement(nestedNode, subnet);
    const before = () => [
      [...(outer.containedElements ?? [])],
      [...(inner.containedElements ?? [])],
    ];

    const original = before();
    expect(graph.assignToGroup(['missing'], outer.id)).toBe(false);
    expect(before()).toEqual(original);
    expect(graph.assignToGroup([nestedNode.id], outer.id)).toBe(false);
    expect(before()).toEqual(original);
    expect(graph.assignToGroup([outer.id], inner.id)).toBe(false);
    expect(before()).toEqual(original);
    expect(graph.assignToGroup([rootNode.id], 'missing-group')).toBe(false);
    expect(before()).toEqual(original);
  });

  it('cleans ownership on reparent, delete, and rename while keeping group contents alive', () => {
    const graph = new Graph();
    const subnet = new SubnetNode('subnet', graph);
    graph.addElement(subnet);
    const first = addNode(graph, 'first');
    const second = addNode(graph, 'second');
    const group = addGroup(graph, 'group', ['first', 'second']);

    expect(graph.renameElement('first', 'renamed')).toBe(true);
    expect(group.containedElements).toEqual(['renamed', 'second']);

    expect(graph.reparentElement(second, subnet)).toBe(true);
    expect(group.containedElements).toEqual(['renamed']);

    graph.removeElement('renamed');
    expect(group.containedElements).toEqual([]);

    expect(graph.assignToGroup(['second'], null)).toBe(true);
    graph.reparentElement(second, null);
    expect(graph.assignToGroup(['second'], group.id)).toBe(true);
    graph.removeElement(group.id);
    expect(graph.getElement('second')).toBe(second);
  });
});
