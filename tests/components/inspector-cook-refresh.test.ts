// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Inspector from '@/editor/Inspector.svelte';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';

const shown = (row: HTMLElement) =>
  row.textContent + [...row.querySelectorAll('input, textarea')].map(e => (e as HTMLInputElement).value).join(' ');

describe('Inspector after a cook', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('updates output values in place instead of remounting the rows', async () => {
    const graph = new Graph();
    const node = new Node('source', 'project.source', graph);
    graph.addElement(node);
    const output = node.out('label', 'param', { type: 'string' });
    output.setValue('first');

    const view = render(Inspector, { props: { node } });
    await vi.advanceTimersByTimeAsync(450);
    await fireEvent.click(view.getByRole('button', { name: /Outputs/ }));
    const row = view.container.querySelector('.port-editor') as HTMLElement;
    expect(shown(row)).toContain('first');

    // A cook: the value changes and the counter moves, with no assignment Svelte sees.
    output.setValue('second');
    node.cookInfo.cookCount += 1;
    await vi.advanceTimersByTimeAsync(450);
    await tick();

    const after = view.container.querySelector('.port-editor') as HTMLElement;
    expect(after).toBe(row);
    expect(shown(after)).toContain('second');
  });
});
