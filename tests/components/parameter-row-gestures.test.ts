// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import Inspector from '@/editor/Inspector.svelte';
import NumberInput from '@/editor/components/NumberInput.svelte';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';
import { expressionEngine } from '@/engine/expressions/index';

/**
 * The three gestures, on a parameter declared the way every sketch declares
 * one. They were all built against `props` and unreachable from `param()`.
 */
function sketchNode() {
  const graph = new Graph();
  const node = new Node('logo-1', 'project.field-io-gradient-logo', graph);
  graph.addElement(node);
  node.param('angle', 0, { min: -180, max: 180, step: 0.5, type: 'float' });
  expressionEngine.setGraph(graph);
  expressionEngine.setFps(25);
  expressionEngine.setFrame(1);
  return node;
}

describe('a sketch parameter in the Inspector', () => {
  it('offers the keyed marker and the sigma on a param() declaration', () => {
    const node = sketchNode();
    const view = render(Inspector, { props: { node } });
    expect(view.getByTitle(/Key at the current frame/)).toBeTruthy();
    expect(view.getByTitle('Add expression')).toBeTruthy();
  });

  it('keys on alt-click and deletes on ctrl-click, one action per gesture', async () => {
    const node = sketchNode();
    const view = render(Inspector, { props: { node } });
    const row = view.getByTitle(/Key at the current frame/).closest('.parameter') as HTMLElement;

    await fireEvent.click(row, { altKey: true });
    expect(node.parm('angle')!.keys()).toHaveLength(1);

    // Alt-click sets rather than toggles: a second one updates the key.
    node.setParameter('angle', 42);
    await fireEvent.click(row, { altKey: true });
    expect(node.parm('angle')!.keys()).toHaveLength(1);
    expect(node.parm('angle')!.keys()[0].value).toBe(42);

    await fireEvent.click(row, { ctrlKey: true });
    expect(node.parm('angle')!.hasChannel()).toBe(false);
  });

  it('treats a ctrl-click contextmenu as the delete, not as the channel editor', async () => {
    const node = sketchNode();
    const view = render(Inspector, { props: { node } });
    const row = view.getByTitle(/Key at the current frame/).closest('.parameter') as HTMLElement;
    node.parm('angle')!.setKey(1, 5);

    // macOS raises contextmenu for ctrl-click. It must delete the key and NOT
    // open the Timeline — one physical gesture, one action.
    await fireEvent.contextMenu(row, { ctrlKey: true });
    expect(node.parm('angle')!.hasChannel()).toBe(false);
  });

  it('routes an expression typed into the value field onto the parameter', async () => {
    const node = sketchNode();
    const view = render(Inspector, { props: { node } });
    const field = view.container.querySelector('input[type="text"]') as HTMLInputElement;

    await fireEvent.input(field, { target: { value: '$T * 0.25' } });
    await fireEvent.blur(field);

    expect(node.parm('angle')!.expression()).toBe('$T * 0.25');
    expect(node.isTimeDependent).toBe(true);
    // And it reaches the value the sketch reads.
    expressionEngine.setFrame(26);
    expect(node.param('angle', 0, { type: 'float' }).value).toBeCloseTo(0.25, 6);
  });
});

describe('the value field itself', () => {
  /** By type, because the slider beside it shows the same value. */
  function textField(view: { container: HTMLElement }): HTMLInputElement {
    return view.container.querySelector('input[type="text"]') as HTMLInputElement;
  }

  function mount(overrides: Record<string, unknown> = {}) {
    const onValueChange = vi.fn();
    const onExpressionChange = vi.fn();
    const view = render(NumberInput, {
      props: {
        prop: { value: 1, params: { min: 0, max: 10, step: 0.5 }, ...overrides },
        id: 'field',
        onValueChange,
        onExpressionChange,
      },
    });
    return { view, onValueChange, onExpressionChange };
  }

  it('is text, so the characters of an expression can be typed at all', () => {
    const { view } = mount();
    const field = textField(view);
    expect(field.type).toBe('text');
    expect(field.getAttribute('inputmode')).toBe('decimal');
  });

  it('commits a number and hands anything else to the expression callback', async () => {
    const { view, onValueChange, onExpressionChange } = mount();
    const field = textField(view);

    await fireEvent.input(field, { target: { value: '2.5' } });
    expect(onValueChange).toHaveBeenLastCalledWith(2.5);
    expect(onExpressionChange).not.toHaveBeenCalled();

    await fireEvent.input(field, { target: { value: 'ch("../sine-1/value")' } });
    // Nothing is committed while it is being typed.
    expect(onValueChange).toHaveBeenCalledTimes(1);
    await fireEvent.blur(field);
    expect(onExpressionChange).toHaveBeenCalledWith('ch("../sine-1/value")');
  });

  it('keeps arrow-key stepping, which came free with type="number"', async () => {
    const { view, onValueChange } = mount();
    const field = textField(view);

    await fireEvent.keyDown(field, { key: 'ArrowUp' });
    expect(onValueChange).toHaveBeenLastCalledWith(1.5);
    await fireEvent.keyDown(field, { key: 'ArrowDown', shiftKey: true });
    // Ten steps down from 1.5, clamped at the declared minimum.
    expect(onValueChange).toHaveBeenLastCalledWith(0);
  });

  it('still renders the slider for a bounded parameter', () => {
    const { view, onValueChange } = mount();
    const slider = view.getByRole('slider') as HTMLInputElement;
    fireEvent.input(slider, { target: { value: '7' } });
    expect(onValueChange).toHaveBeenLastCalledWith(7);
  });
});
