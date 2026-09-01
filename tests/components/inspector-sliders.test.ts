// @vitest-environment jsdom
import { render } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
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
    const coreValueSource = readFileSync('src/editor/components/CoreValue.svelte', 'utf8');
    expect(coreValueSource).toMatch(/\.slider-row \.slider-number\s*\{[^}]*flex:\s*0 0 52px/s);
    expect(view.getByText('contribution').getAttribute('title')).toBe('contribution · float');
    expect(view.queryByText('float')).toBeNull();
  });

  it('shows the current value beneath an action parameter button', () => {
    const graph = new Graph();
    const node = new Node('picker', 'project.picker', graph);
    graph.addElement(node);
    node.param('selection', 7, {
      type: 'int',
      action: 'panel:picker',
      label: 'Choose item',
      promotable: false,
    });

    const view = render(Inspector, { props: { node } });
    expect(view.getByRole('button', { name: 'Choose item' })).toBeTruthy();
    const value = view.getByRole('spinbutton') as HTMLInputElement;
    expect(value.value).toBe('7');
    expect(value.disabled).toBe(true);
  });
});
