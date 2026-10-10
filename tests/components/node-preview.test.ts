// @vitest-environment jsdom
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';

const { ensureNodePreviewSetting, enabledPreviewStore } = vi.hoisted(() => ({
  ensureNodePreviewSetting: vi.fn(() => Promise.resolve()),
  enabledPreviewStore: {
    subscribe(run: (value: boolean) => void) {
      run(true);
      return () => {};
    },
  },
}));

vi.mock('@/editor/stores/nodePreview', () => ({
  nodePreviews: enabledPreviewStore,
  ensureNodePreviewSetting,
}));

import NodeUI from '@/editor/NodeUI.svelte';

beforeAll(() => {
  Object.defineProperty(globalThis, 'OffscreenCanvas', {
    configurable: true,
    value: class OffscreenCanvas {},
  });
});

function noteNode(): { graph: Graph; node: Node } {
  const graph = new Graph();
  const node = new Node('market-observation', 'project.Note', graph);
  node.out<string>('note', 'param', { type: 'string' }).setValue('Clients are consolidating software internally.');
  return { graph, node };
}

describe('inline node previews', () => {
  beforeEach(() => ensureNodePreviewSetting.mockClear());

  it('shows the first output through a compact, read-only CoreValue', async () => {
    const { node } = noteNode();
    const { getByLabelText, getByDisplayValue, queryByText } = render(NodeUI, { props: { node } });

    await waitFor(() => expect(getByLabelText('Preview of note')).toBeTruthy());
    const value = getByDisplayValue('Clients are consolidating software internally.') as HTMLInputElement;
    expect(value.disabled).toBe(true);
    expect(queryByText('market-observation')).toBeNull();
    expect(ensureNodePreviewSetting).toHaveBeenCalledOnce();
  });

  it('shows the compact node id footer only while the preview node is selected', async () => {
    const { node } = noteNode();
    const { getByText } = render(NodeUI, { props: { node, selected: true } });
    expect(getByText('market-observation').closest('.preview-label')).toBeTruthy();
  });

  it('refreshes the rendered value when the scheduler publishes a cook change', async () => {
    const { node } = noteNode();
    const { getByDisplayValue, rerender } = render(NodeUI, { props: { node, cookRevision: 0 } });

    await waitFor(() => expect(getByDisplayValue('Clients are consolidating software internally.')).toBeTruthy());
    node.outputs[0].value = 'The observation has changed.';
    await rerender({ node, cookRevision: 1 });

    await waitFor(() => expect(getByDisplayValue('The observation has changed.')).toBeTruthy());
  });

  it('drags from card surfaces but leaves renderer controls interactive', async () => {
    const { node } = noteNode();
    const { container, getByLabelText, getByDisplayValue } = render(NodeUI, { props: { node } });

    const preview = await waitFor(() => getByLabelText('Preview of note'));
    await fireEvent.mouseDown(preview);
    expect(container.querySelector('.node.dragging')).toBeTruthy();
    await fireEvent.mouseUp(preview);

    await fireEvent.mouseDown(getByDisplayValue('Clients are consolidating software internally.'));
    expect(container.querySelector('.node.dragging')).toBeNull();
  });

  it('hides variadic source labels on unselected preview cards', async () => {
    const graph = new Graph();
    const source = new Node('raw-observation', 'project.Source', graph);
    const node = new Node('synthesis', 'project.Synthesis', graph);
    graph.addElement(source);
    graph.addElement(node);
    const output = source.out('observation', 'param', { type: 'string' });
    node.setVariadic('', { type: 'string' });
    node.out('note', 'param', { type: 'string' }).setValue('A developing opinion');
    graph.connect(output, node.inputs[0]);

    const view = render(NodeUI, { props: { node, selected: false } });
    expect(view.queryByText('raw-observation')).toBeNull();

    await view.rerender({ node, selected: true });
    expect(view.getByText('raw-observation')).toBeTruthy();
  });
});
