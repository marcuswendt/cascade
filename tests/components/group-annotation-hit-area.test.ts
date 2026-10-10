// @vitest-environment jsdom
import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import GroupAnnotationUI from '@/editor/annotations/GroupAnnotationUI.svelte';
import { GroupAnnotation } from '@/nodes/annotations/Group';
import { Graph } from '@/nodes/Graph';

describe('group annotation hit area', () => {
  it('lets contained nodes receive pointer events while its header and resize controls remain interactive', () => {
    const graph = new Graph();
    const annotation = new GroupAnnotation('reasoning', graph) as GroupAnnotation & { content: string };
    annotation.content = 'Reasoning';
    annotation.size = { width: 700, height: 500 };

    const view = render(GroupAnnotationUI, {
      props: { annotation, isSelected: true },
    });
    const group = view.getByRole('button', { name: 'Group annotation' });
    const header = view.getByText('Reasoning');
    const resize = view.getByRole('button', { name: 'Resize southeast' });

    expect(getComputedStyle(group).pointerEvents).toBe('none');
    expect(getComputedStyle(header).pointerEvents).toBe('auto');
    expect(getComputedStyle(resize).pointerEvents).toBe('auto');
  });
});
