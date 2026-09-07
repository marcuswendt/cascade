// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import ExpressionInput from '@/editor/components/ExpressionInput.svelte';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';

/**
 * Setting or clearing an expression mutates `node.props` in place, which Svelte
 * cannot observe. The component takes an `onValueChange` prop for exactly that
 * and never called it, so both actions changed the model and left the panel
 * rendering the old state — indistinguishable from the feature not working.
 *
 * svelte-check had been reporting `onValueChange` as an unused export the whole
 * time. These tests exist so it cannot quietly become unused again.
 */
function setup(expression?: string) {
  const graph = new Graph();
  const node = new Node('sine-1', 'project.sine', graph);
  graph.addElement(node);
  // `addParm` is what actually populates node.props; `param()` is the
  // cook-time declaration helper and does not by itself give parm() something
  // to find.
  node.addParm('amplitude', { value: 45, params: { min: 0, max: 100 } } as any);
  // Set the expression *before* capturing the prop: setExpression replaces
  // node.props[name] with a new object, so a reference taken earlier is stale.
  if (expression) node.parm('amplitude')!.setExpression(expression);
  const prop: any = node.props.amplitude;
  const onValueChange = vi.fn();
  const result = render(ExpressionInput, { prop, propKey: 'amplitude', node, onValueChange });
  return { ...result, node, onValueChange };
}

describe('ExpressionInput tells the panel when the binding changes', () => {
  it('notifies on removing an expression, and the model forgets it', async () => {
    const { getByTitle, node, onValueChange } = setup('$T * 40');
    expect(node.parm('amplitude')!.hasExpression()).toBe(true);

    await fireEvent.click(getByTitle('Remove expression'));

    expect(node.parm('amplitude')!.hasExpression()).toBe(false);
    expect(onValueChange).toHaveBeenCalledTimes(1);
  });

  it('offers a way in when there is no expression yet', () => {
    // It was there before this fix, at opacity 0 until the row was hovered —
    // so the only way to find out a parameter could hold an expression was to
    // already know. The button must exist and be reachable.
    const { getByTitle } = setup();
    expect(getByTitle('Add expression')).toBeTruthy();
  });
});
