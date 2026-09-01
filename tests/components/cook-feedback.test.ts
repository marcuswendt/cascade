// @vitest-environment jsdom
import { render } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import CookStatusStrip from '@/editor/CookStatusStrip.svelte';
import NodeUI from '@/editor/NodeUI.svelte';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';

function nodeWithState(state: Node['cookState']): Node {
  const graph = new Graph();
  const node = new Node('render-frame', 'project.RenderFrame', graph);
  node.cookState = state;
  return node;
}

describe('cook feedback', () => {
  it('uses a dedicated event that cannot collide with bubbled native clicks', () => {
    const source = readFileSync('src/editor/NodeUI.svelte', 'utf8');
    expect(source).toContain("dispatch('nodeClick', { event: e })");
    expect(source).not.toContain("dispatch('click', { event: e })");
  });

  it('draws stale, cooking, and persistent error states from Node.cookState', () => {
    const stale = render(NodeUI, { props: { node: nodeWithState('stale') } });
    expect(stale.container.querySelector('.node.stale')?.getAttribute('data-cook-state')).toBe('stale');
    stale.unmount();

    const cooking = render(NodeUI, { props: { node: nodeWithState('cooking') } });
    expect(cooking.container.querySelector('.node.cooking')?.getAttribute('data-cook-state')).toBe('cooking');
    cooking.unmount();

    const errorNode = nodeWithState('error');
    errorNode.error = new Error('Renderer failed');
    const failed = render(NodeUI, { props: { node: errorNode } });
    expect(failed.container.querySelector('.node.error')?.getAttribute('data-cook-state')).toBe('error');
    expect(failed.getByText('Renderer failed')).toBeTruthy();
  });

  it('keeps authored fill and selection as independent visual channels', () => {
    const node = nodeWithState('cooking') as Node & { color: string };
    node.color = '#123456';
    const { container } = render(NodeUI, { props: { node, selected: true } });

    expect(container.querySelector('.node.selected.cooking')).toBeTruthy();
    expect(container.querySelector('.body')?.getAttribute('style')).toContain('#123456');
  });

  it('distinguishes cold loading from scheduled and active cooking', () => {
    const currentNode = nodeWithState('cooking');
    const loading = render(CookStatusStrip, {
      props: {
        loading: true,
        status: { phase: 'idle', total: 0, completed: 0, currentNode: null, startedAt: null, elapsed: 0 }
      }
    });
    expect(loading.getByText('Loading graph')).toBeTruthy();
    expect(loading.container.querySelector('[data-phase="loading"]')).toBeTruthy();
    loading.unmount();

    const cooking = render(CookStatusStrip, {
      props: {
        loading: false,
        status: { phase: 'cooking', total: 22, completed: 6, currentNode, startedAt: 1, elapsed: 425 }
      }
    });
    expect(cooking.getByText('Cooking 7 of 22')).toBeTruthy();
    expect(cooking.getByText('render-frame')).toBeTruthy();
    expect(cooking.container.querySelector('time')?.textContent).toContain('ms');
  });
});
