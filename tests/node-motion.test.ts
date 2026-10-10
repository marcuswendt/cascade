import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { bumpNodeMotion, nodeMotion } from '@/editor/stores/nodeMotion';

/**
 * A drag tells exactly the nodes it moves, so only their NodeUIs re-render;
 * the rest of the canvas hears nothing until the drag ends.
 */
describe('node motion stores', () => {
  it('notifies only the nodes that moved', () => {
    const heard: string[] = [];
    const stops = ['a', 'b', 'c'].map(id => {
      let first = true;
      return nodeMotion(id).subscribe(() => { if (first) first = false; else heard.push(id); });
    });
    bumpNodeMotion(['b']);
    bumpNodeMotion(['b', 'c']);
    expect(heard).toEqual(['b', 'b', 'c']);
    expect(get(nodeMotion('a'))).toBe(0);
    stops.forEach(stop => stop());
  });

  it('returns one store per node', () => {
    expect(nodeMotion('same')).toBe(nodeMotion('same'));
  });
});
