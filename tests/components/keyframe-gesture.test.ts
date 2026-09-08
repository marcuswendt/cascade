// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isKeyable, keyState, toggleKeyAtPlayhead } from '@/editor/keyframeGesture';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';

/**
 * The gesture that was missing: the engine could key a parameter and the dope
 * sheet could show keys, and nothing could create one. These tests pin the
 * toggle semantics, because "alt-click again removes the key" is the half a
 * reimplementation would get wrong.
 */
function keyable() {
  const graph = new Graph();
  const node = new Node('sine-1', 'project.sine', graph);
  graph.addElement(node);
  node.addParm('angle', { value: 30 } as any);
  return node;
}

describe('keying a parameter from the Inspector', () => {
  it('sets a key at the playhead, then removes it when toggled again', () => {
    const node = keyable();
    expect(keyState(node, 'angle')).toBe('none');

    expect(toggleKeyAtPlayhead(node, 'angle')).toBe('set');
    expect(keyState(node, 'angle')).toBe('keyed-here');
    // Keyed at the current value, which is what alt-click has to mean.
    expect(node.parm('angle')!.keys()[0].value).toBe(30);

    expect(toggleKeyAtPlayhead(node, 'angle')).toBe('removed');
    expect(keyState(node, 'angle')).toBe('none');
  });

  it('reports keyed-elsewhere distinctly from keyed-here', () => {
    const node = keyable();
    node.parm('angle')!.setKey(50, 90);
    // The playhead is at frame 1, the key is at 50 — animated, but not here.
    expect(keyState(node, 'angle')).toBe('keyed');
  });

  it('is inert rather than throwing when the parameter cannot be keyed', () => {
    const graph = new Graph();
    const node = new Node('plain-1', 'project.plain', graph);
    graph.addElement(node);
    // No such parameter at all.
    expect(keyState(node, 'missing')).toBe('none');
    expect(toggleKeyAtPlayhead(node, 'missing')).toBe('unavailable');
  });

  it('only offers to key numbers, for now', () => {
    expect(isKeyable(0.5)).toBe(true);
    expect(isKeyable('soft')).toBe(false);
    expect(isKeyable([0, 1])).toBe(false);
    expect(isKeyable(Number.NaN)).toBe(false);
  });
});
