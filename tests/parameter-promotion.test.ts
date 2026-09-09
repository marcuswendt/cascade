/**
 * Promoting a child's parameter to its container.
 *
 * Marcus, 2026-09-09, deciding where a force's settings live: *"keep the force
 * settings on the inside, but allow to promote parameters to the level above
 * with 1 click."*
 *
 * The design decision these tests pin down is that **promotion is
 * presentation**: the value stays on the child, and the container only records
 * which of its children's parameters to display. A real parameter on the
 * container writing through would be a second copy of the value with an order
 * to resolve between them — which is the mess props already are, and doing it
 * again for promotion is the thing to avoid.
 *
 * So what is asserted is that there is exactly one value, that it survives a
 * save and reload, and that a promotion pointing at a deleted child is inert
 * rather than a load failure.
 */
import { describe, expect, it } from 'vitest';

import { Graph } from '../src/nodes/Graph';
import { Node } from '../src/nodes/Node';

function container(graph: Graph, id: string): Node {
  const node = new Node(id, 'project.Container');
  graph.addElement(node);
  return node;
}

function child(graph: Graph, id: string, parent: Node, value = 1): Node {
  const node = new Node(id, 'project.Force');
  node.parent = parent;
  node.param('amplitude', value, { type: 'float' });
  graph.addElement(node);
  return node;
}

describe('promoting a parameter to the level above', () => {
  it('records the promotion on the container, not a copy of the value', () => {
    const graph = new Graph();
    const parent = container(graph, 'loop');
    const force = child(graph, 'noise', parent, 6);

    force.setPromotedToParent('amplitude', true);

    expect(parent.promotions).toEqual([{ nodeId: 'noise', param: 'amplitude' }]);
    // The container gains no parameter of its own: one value, on the child.
    expect(parent.parameters.find(p => p.name === 'amplitude')).toBeUndefined();
    expect(force.parameters.find(p => p.name === 'amplitude')?.value).toBe(6);
  });

  it('is one click each way', () => {
    const graph = new Graph();
    const parent = container(graph, 'loop');
    const force = child(graph, 'noise', parent);

    expect(force.isPromotedToParent('amplitude')).toBe(false);
    force.setPromotedToParent('amplitude', true);
    expect(force.isPromotedToParent('amplitude')).toBe(true);
    force.setPromotedToParent('amplitude', false);
    expect(force.isPromotedToParent('amplitude')).toBe(false);
    expect(parent.promotions).toEqual([]);
  });

  it('promoting twice does not duplicate the entry', () => {
    const graph = new Graph();
    const parent = container(graph, 'loop');
    const force = child(graph, 'noise', parent);
    force.setPromotedToParent('amplitude', true);
    force.setPromotedToParent('amplitude', true);
    expect(parent.promotions).toHaveLength(1);
  });

  it('two children can promote the same parameter name', () => {
    // Two noise forces in one container is the ordinary case, and a promotion
    // keyed on the name alone would collapse them into one control.
    const graph = new Graph();
    const parent = container(graph, 'loop');
    const first = child(graph, 'noise-1', parent, 2);
    const second = child(graph, 'noise-2', parent, 9);
    first.setPromotedToParent('amplitude', true);
    second.setPromotedToParent('amplitude', true);
    expect(parent.promotions).toHaveLength(2);
    expect(parent.promotions.map(entry => entry.nodeId)).toEqual(['noise-1', 'noise-2']);
  });

  it('a node with no parent is a no-op rather than a throw', () => {
    // The button is only rendered for a child, so this is a stale-UI guard —
    // and a guard that throws turns a stale UI into a crash.
    const graph = new Graph();
    const orphan = new Node('loose', 'project.Force');
    orphan.param('amplitude', 1, { type: 'float' });
    graph.addElement(orphan);
    expect(() => orphan.setPromotedToParent('amplitude', true)).not.toThrow();
    expect(orphan.isPromotedToParent('amplitude')).toBe(false);
  });
});

describe('promotions across a save and reload', () => {
  it('survives a round trip', () => {
    const graph = new Graph();
    const parent = container(graph, 'loop');
    const force = child(graph, 'noise', parent, 6);
    force.setPromotedToParent('amplitude', true);

    const saved = JSON.parse(JSON.stringify(graph.toJSON()));
    const node = saved.nodes.find((entry: any) => entry.id === 'loop');
    expect(node.promotions).toEqual([{ nodeId: 'noise', param: 'amplitude' }]);

    const reloaded = Graph.fromJSON(saved);
    const reloadedParent = reloaded.elements.find((element: any) => element?.id === 'loop') as Node;
    expect(reloadedParent.promotions).toEqual([{ nodeId: 'noise', param: 'amplitude' }]);
  });

  it('writes nothing when nothing is promoted', () => {
    // A file records decisions rather than restating every default — the same
    // rule `params` follows.
    const graph = new Graph();
    const parent = container(graph, 'loop');
    child(graph, 'noise', parent);
    const saved = JSON.parse(JSON.stringify(graph.toJSON()));
    const node = saved.nodes.find((entry: any) => entry.id === 'loop');
    expect('promotions' in node).toBe(false);
  });

  it('a promotion naming a missing child loads without failing', () => {
    // Deleting a node inside a container must not make the file unopenable, and
    // must not leave a broken control on the outside of it either.
    const graph = new Graph();
    const parent = container(graph, 'loop');
    const force = child(graph, 'noise', parent);
    force.setPromotedToParent('amplitude', true);
    const saved = JSON.parse(JSON.stringify(graph.toJSON()));
    saved.nodes = saved.nodes.filter((entry: any) => entry.id !== 'noise');

    const reloaded = Graph.fromJSON(saved);
    const reloadedParent = reloaded.elements.find((element: any) => element?.id === 'loop') as Node;
    expect(reloadedParent.promotions).toHaveLength(1);
    // Inert: resolving it finds no child, which is what the Inspector filters on.
    expect(reloaded.elements.find((element: any) => element?.id === 'noise')).toBeUndefined();
  });

  it('drops a malformed entry rather than trusting the file', () => {
    const graph = new Graph();
    container(graph, 'loop');
    const saved = JSON.parse(JSON.stringify(graph.toJSON()));
    const node = saved.nodes.find((entry: any) => entry.id === 'loop');
    node.promotions = [
      { nodeId: 'noise', param: 'amplitude' },
      { nodeId: 'noise' },
      { param: 'amplitude' },
      null,
    ];
    const reloaded = Graph.fromJSON(saved);
    const reloadedParent = reloaded.elements.find((element: any) => element?.id === 'loop') as Node;
    expect(reloadedParent.promotions).toEqual([{ nodeId: 'noise', param: 'amplitude' }]);
  });
});
