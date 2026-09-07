// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import InspectorStack, { COLLAPSE_THRESHOLD } from '@/editor/InspectorStack.svelte';
import { selectedNodesOf } from '@/editor/stores/selectionStore';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';

function graphWithNodes(ids: string[]): { graph: Graph; nodes: Node[] } {
  const graph = new Graph();
  const nodes = ids.map((id) => {
    const node = new Node(id, `project.${id}`, graph);
    graph.addElement(node);
    node.param('gain', 0.25, { type: 'float', min: 0, max: 1, step: 0.01 });
    return node;
  });
  return { graph, nodes };
}

describe('Inspector with several nodes selected', () => {
  it('renders one node exactly as before, with no multi-select chrome', () => {
    const { nodes } = graphWithNodes(['marker-body']);

    const view = render(InspectorStack, { props: { nodes } });

    expect(view.queryByText(/nodes selected/)).toBeNull();
    expect(view.queryByText('marker-body')).toBeNull();
    expect(view.container.querySelector('.stack')).toBeNull();
    expect(view.container.querySelectorAll('.inspector').length).toBe(1);
    expect(view.container.querySelector('.inspector.embedded')).toBeNull();
    // Still the ordinary single-node panel underneath.
    expect(view.getByRole('slider').getAttribute('max')).toBe('1');
  });

  it('renders nothing but the plain panel when nothing is selected', () => {
    const view = render(InspectorStack, { props: { nodes: [] } });

    expect(view.container.querySelector('.stack')).toBeNull();
    expect(view.queryByText(/nodes selected/)).toBeNull();
  });

  it('stacks one section per node, in canvas order rather than click order', () => {
    const { graph, nodes } = graphWithNodes(['marker-exif', 'marker-weather', 'marker-solar']);
    // Clicked back to front: the stack must not follow that.
    const clicked = ['marker-solar', 'marker-exif', 'marker-weather'];

    const resolved = selectedNodesOf(graph, clicked, nodes[2]);
    expect(resolved.map((node) => node.id)).toEqual(['marker-exif', 'marker-weather', 'marker-solar']);

    const view = render(InspectorStack, { props: { nodes: resolved } });

    const headings = Array.from(view.container.querySelectorAll('.section-heading .label')).map(
      (element) => element.textContent?.trim()
    );
    expect(headings).toEqual(['marker-exif', 'marker-weather', 'marker-solar']);
    expect(view.container.querySelector('.summary .count')?.textContent).toBe('3 nodes selected');
    expect(view.container.querySelector('.summary .hint')).toBeNull();
    expect(view.container.querySelectorAll('.inspector.embedded').length).toBe(3);
  });

  it('drops a node the canvas has deselected even while it is still the primary', () => {
    const { graph, nodes } = graphWithNodes(['keep', 'dropped']);

    // Shift-clicking a node out of the selection still reports it as primary.
    const resolved = selectedNodesOf(graph, ['keep'], nodes[1]);

    expect(resolved.map((node) => node.id)).toEqual(['keep']);
  });

  it('falls back to the primary node when the canvas has published nothing', () => {
    const { graph, nodes } = graphWithNodes(['only']);

    expect(selectedNodesOf(graph, [], nodes[0]).map((node) => node.id)).toEqual(['only']);
    expect(selectedNodesOf(graph, ['since-removed'], nodes[0]).map((node) => node.id)).toEqual(['only']);
    expect(selectedNodesOf(graph, [], null)).toEqual([]);
  });

  it('edits the node whose section the control is in, and no other', async () => {
    const { nodes } = graphWithNodes(['first', 'second', 'third']);

    const view = render(InspectorStack, { props: { nodes } });

    const sliders = view.getAllByRole('slider') as HTMLInputElement[];
    expect(sliders.length).toBe(3);

    await fireEvent.input(sliders[1], { target: { value: '0.8' } });

    expect(nodes[1].parameters.find((p) => p.name === 'gain')?.value).toBeCloseTo(0.8);
    expect(nodes[0].parameters.find((p) => p.name === 'gain')?.value).toBeCloseTo(0.25);
    expect(nodes[2].parameters.find((p) => p.name === 'gain')?.value).toBeCloseTo(0.25);
  });

  it('gives every stacked control a node-scoped element id', () => {
    // Two nodes of the same kind share every prop name, so an id keyed by
    // parameter name alone made the second section's wheel handler reach into
    // the first section's input through document.getElementById.
    const graph = new Graph();
    const nodes = ['destroy-erode', 'destroy-dilate'].map((id) => {
      const node = new Node(id, 'project.destroy', graph);
      graph.addElement(node);
      node.defineProp('radius', { type: 'float', value: 2, min: 0, max: 10 });
      return node;
    });

    const view = render(InspectorStack, { props: { nodes } });

    const ids = Array.from(view.container.querySelectorAll('[id^="prop-"]')).map(
      (element) => element.id
    );
    expect(ids.length).toBeGreaterThanOrEqual(2);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some((id) => id.includes('destroy-erode'))).toBe(true);
    expect(ids.some((id) => id.includes('destroy-dilate'))).toBe(true);
  });

  it('keeps sections open up to the threshold and collapses them past it', async () => {
    const atThreshold = graphWithNodes(
      Array.from({ length: COLLAPSE_THRESHOLD }, (_, index) => `marker-${index}`)
    );
    const open = render(InspectorStack, { props: { nodes: atThreshold.nodes } });
    expect(open.container.querySelectorAll('.inspector.embedded').length).toBe(COLLAPSE_THRESHOLD);
    expect(open.queryByText(/collapsed/)).toBeNull();
    open.unmount();

    const overThreshold = graphWithNodes(
      Array.from({ length: COLLAPSE_THRESHOLD + 1 }, (_, index) => `node-${index}`)
    );
    const shut = render(InspectorStack, { props: { nodes: overThreshold.nodes } });

    expect(shut.container.querySelectorAll('.section-heading').length).toBe(COLLAPSE_THRESHOLD + 1);
    expect(shut.container.querySelectorAll('.inspector.embedded').length).toBe(0);
    expect(shut.container.querySelector('.summary .count')?.textContent).toBe(
      `${COLLAPSE_THRESHOLD + 1} nodes selected`
    );
    expect(shut.container.querySelector('.summary .hint')?.textContent).toBe(
      'collapsed, open one to edit it'
    );

    // Collapsed is a default, not a lock.
    await fireEvent.click(shut.container.querySelectorAll('.section-heading')[3] as HTMLElement);
    expect(shut.container.querySelectorAll('.inspector.embedded').length).toBe(1);
  });
});
