// @vitest-environment jsdom
import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Inspector from '@/editor/Inspector.svelte';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';

describe('Inspector parameter sliders', () => {
  it('renders a range control for bounded custom-node parameters', () => {
    const graph = new Graph();
    const node = new Node('signal-depth', 'project.signal-depth', graph);
    graph.addElement(node);
    node.parameters.push({
      name: 'contribution',
      value: 0.3,
      defaultValue: 0.3,
      dataType: 'any',
      promoted: false,
      options: {},
    });

    node.param('contribution', 0.4, {
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
    });

    const view = render(Inspector, { props: { node } });
    expect(view.getByRole('slider').getAttribute('min')).toBe('0');
    expect(view.getByRole('slider').getAttribute('max')).toBe('1');
  });
});
