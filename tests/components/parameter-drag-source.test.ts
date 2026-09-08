// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it, beforeEach } from 'vitest';
import Inspector from '@/editor/Inspector.svelte';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';
import { expressionEngine } from '@/engine/expressions/index';

/**
 * A parameter label is a drag source carrying its expression address, so a
 * path can be dragged into the agent console rather than typed out. The node
 * name already did this; the parameter did not, which meant the console's drop
 * handler had exactly one thing in the whole interface it could accept.
 */
function sketchNode() {
  const graph = new Graph();
  const node = new Node('logo-1', 'project.field-io-gradient-logo', graph);
  graph.addElement(node);
  node.param('angle', 0, { min: -180, max: 180, step: 0.5, type: 'float' });
  expressionEngine.setGraph(graph);
  return node;
}

/** jsdom has no DataTransfer, and fireEvent will not invent one. */
function fakeDataTransfer() {
  const store = new Map<string, string>();
  return {
    types: [] as string[],
    effectAllowed: 'none',
    dropEffect: 'none',
    setData: (format: string, value: string) => void store.set(format, value),
    getData: (format: string) => store.get(format) ?? '',
  };
}

describe('dragging a parameter for its path', () => {
  it('carries NODE/parm, the address ch() takes', () => {
    const node = sketchNode();
    const view = render(Inspector, { props: { node } });
    const label = view.getByText('angle');
    expect(label.getAttribute('draggable')).toBe('true');

    const dataTransfer = fakeDataTransfer();
    fireEvent.dragStart(label, { dataTransfer });
    expect(dataTransfer.getData('text/plain')).toBe('logo-1/angle');
  });

  it('uses the node id at drag time, not one captured when the row rendered', () => {
    // Renaming a node with the Inspector open would otherwise hand out a path
    // that resolves to nothing.
    const node = sketchNode();
    const view = render(Inspector, { props: { node } });
    node.id = 'logo-renamed';

    const dataTransfer = fakeDataTransfer();
    fireEvent.dragStart(view.getByText('angle'), { dataTransfer });
    expect(dataTransfer.getData('text/plain')).toBe('logo-renamed/angle');
  });

  it('leaves the click gestures working', () => {
    // A draggable label must still be a label: a drag needs movement, so a
    // plain alt-click has to reach the keyframe handler as before.
    const node = sketchNode();
    const view = render(Inspector, { props: { node } });
    const label = view.getByText('angle');
    expect(() => fireEvent.click(label, { altKey: true })).not.toThrow();
    expect(node.parm('angle').hasChannel()).toBe(true);
  });
});
