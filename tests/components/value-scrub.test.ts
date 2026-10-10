// @vitest-environment jsdom
import { fireEvent, render, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import CoreValue from '@/editor/components/CoreValue.svelte';
import Inspector from '@/editor/Inspector.svelte';
import InspectorStack from '@/editor/InspectorStack.svelte';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';
import { expressionEngine } from '@/engine/expressions/index';

/**
 * Houdini's middle-drag scrub, plus the label drag a Mac trackpad needs.
 * Marcus, 2026-10-10: vec2/vec3 parameters had only text boxes.
 */
async function drag(target: Element, init: MouseEventInit, dx: number, mods: MouseEventInit = {}) {
  await fireEvent.mouseDown(target, { clientX: 100, ...init });
  for (let step = 1; step <= 5; step++) {
    await fireEvent.mouseMove(window, { clientX: 100 + (dx * step) / 5, ...mods });
  }
  await fireEvent.mouseUp(window, { clientX: 100 + dx, button: init.button ?? 0 });
}

function vec2(onChange = vi.fn(), options: Record<string, unknown> = {}) {
  const view = render(CoreValue, {
    props: { type: 'vec2', value: [-0.1, 0], port: { name: 'offset', options }, onChange },
  });
  return { view: within(view.container as HTMLElement), onChange };
}

describe('scrubbing a vector component', () => {
  it('middle-drag on the field changes that component', async () => {
    const { view, onChange } = vec2();
    const x = view.getByLabelText('X');
    const down = new MouseEvent('mousedown', { button: 1, bubbles: true, cancelable: true, clientX: 100 });
    x.dispatchEvent(down);
    // No autoscroll, no paste.
    expect(down.defaultPrevented).toBe(true);
    for (let step = 1; step <= 5; step++) await fireEvent.mouseMove(window, { clientX: 100 + step * 10 });
    await fireEvent.mouseUp(window, { button: 1 });
    const last = onChange.mock.calls.at(-1)![0];
    expect(last[0]).toBeCloseTo(0.4);
    expect(last[1]).toBe(0);
  });

  it('left-drag on the X label scrubs; shift is coarser and cmd finer', async () => {
    const plain = vec2();
    await drag(plain.view.getByText('X'), { button: 0 }, 50);
    const coarse = vec2();
    await drag(coarse.view.getByText('X'), { button: 0 }, 50, { shiftKey: true });
    const fine = vec2();
    await drag(fine.view.getByText('X'), { button: 0 }, 50, { metaKey: true });
    const delta = (mock: ReturnType<typeof vi.fn>) => mock.mock.calls.at(-1)![0][0] - -0.1;
    expect(delta(plain.onChange)).toBeCloseTo(0.5);
    expect(delta(coarse.onChange)).toBeCloseTo(5);
    expect(delta(fine.onChange)).toBeCloseTo(0.05);
  });

  it('Y scrubs independently of X', async () => {
    const { view, onChange } = vec2();
    await drag(view.getByText('Y'), { button: 0 }, -20);
    const last = onChange.mock.calls.at(-1)![0];
    expect(last[0]).toBeCloseTo(-0.1);
    expect(last[1]).toBeCloseTo(-0.2);
  });

  it('a plain left-drag on the field does not scrub; alt-drag does', async () => {
    const plain = vec2();
    await drag(plain.view.getByLabelText('X'), { button: 0 }, 50);
    expect(plain.onChange).not.toHaveBeenCalled();
    const alt = vec2();
    await drag(alt.view.getByLabelText('X'), { button: 0, altKey: true }, 50);
    expect(alt.onChange).toHaveBeenCalled();
  });

  it('clamps to a declared range and Escape restores the start', async () => {
    const ranged = vec2(vi.fn(), { min: -1, max: 1 });
    await drag(ranged.view.getByText('X'), { button: 0 }, 2000);
    expect(ranged.onChange.mock.calls.at(-1)![0][0]).toBe(1);

    const cancelled = vec2();
    await fireEvent.mouseDown(cancelled.view.getByText('X'), { button: 0, clientX: 0 });
    await fireEvent.mouseMove(window, { clientX: 40 });
    await fireEvent.mouseMove(window, { clientX: 80 });
    // Writes are one per frame; let one land so there is something to undo.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(cancelled.onChange.mock.calls.at(-1)![0][0]).toBeCloseTo(0.7);
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(cancelled.onChange.mock.calls.at(-1)![0][0]).toBeCloseTo(-0.1);
  });
});

describe('scrubbing in the Inspector', () => {
  function sketch() {
    const graph = new Graph();
    const node = new Node('render-composite', 'project.render-composite', graph);
    graph.addElement(node);
    node.param('scale', 1, { type: 'float', min: 0, max: 3, step: 0.01 });
    node.param('offset', [-0.1, 0], { type: 'vec2' });
    expressionEngine.setGraph(graph);
    return node;
  }

  it('dragging a scalar name scrubs it, with one undo entry per drag', async () => {
    const node = sketch();
    const onRecordHistory = vi.fn();
    const view = render(Inspector, { props: { node, onRecordHistory } });
    await drag(view.getByText('scale'), { button: 0 }, 100);
    const scale = node.parameters.find(p => p.name === 'scale')!.value as number;
    expect(scale).toBeCloseTo(2);
    expect(onRecordHistory).toHaveBeenCalledTimes(1);
  });

  it('middle-dragging a vec2 component writes the parameter', async () => {
    const node = sketch();
    const view = render(Inspector, { props: { node } });
    await drag(view.getByLabelText('Y'), { button: 1 }, 30);
    const offset = node.parameters.find(p => p.name === 'offset')!.value as number[];
    expect(offset[0]).toBeCloseTo(-0.1);
    expect(offset[1]).toBeCloseTo(0.3);
  });

  it('clearing the node tears the scrub labels down without reading a null id', async () => {
    const node = sketch();
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => errors.push(event.error);
    window.addEventListener('error', onError);
    const view = render(InspectorStack, { props: { nodes: [node] } });
    expect(view.container.querySelector(".parameter-bound .parameter-name")?.textContent).toBe("scale");
    await view.rerender({ nodes: [] });
    window.removeEventListener('error', onError);
    expect(errors).toEqual([]);
    expect(view.queryByText('scale')).toBeNull();
  });
});
