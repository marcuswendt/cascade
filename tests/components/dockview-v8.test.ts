// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { activePanelId, groupResizeAxis } from '@/editor/dockview/dockview-store.svelte';
import { createSvelteRenderer, resolvePanelParams } from '@/editor/dockview/renderer';

describe('Dockview v8 integration', () => {
  it('reads the active panel from the v7+ event payload', () => {
    expect(activePanelId({ panel: { id: 'viewer-main' }, origin: 'user' } as never)).toBe('viewer-main');
    expect(activePanelId({ panel: undefined, origin: 'api' } as never)).toBeNull();
  });

  it('fills the content area reported by Dockview v8 without header compensation', () => {
    const renderer = createSvelteRenderer({ id: 'unknown', type: 'unknown' as never, title: 'Unknown' });

    renderer.init({ api: { id: 'invalid', title: 'Invalid' }, params: {} } as never);

    expect(renderer.element.style.width).toBe('100%');
    expect(renderer.element.style.height).toBe('100%');
    expect(renderer.element.style.overflow).toBe('hidden');
  });

  it('derives the public resize axis from a serialized layout', () => {
    const grid = {
      orientation: 0,
      root: {
        type: 'branch',
        data: [
          { type: 'leaf', data: { id: 'left' } },
          {
            type: 'branch',
            data: [
              { type: 'leaf', data: { id: 'top' } },
              { type: 'leaf', data: { id: 'bottom' } },
            ],
          },
        ],
      },
    };

    expect(groupResizeAxis(grid as never, 'left')).toBe('width');
    expect(groupResizeAxis(grid as never, 'bottom')).toBe('height');
    expect(groupResizeAxis(grid as never, 'missing')).toBeNull();
  });

  it('restores project-owned panel parameters from a saved layout', () => {
    const params = resolvePanelParams(
      { id: 'project:assets', type: 'project:assets', title: 'Assets' },
      {
        api: { id: 'project:assets:source', title: 'Asset Browser' },
        params: { projectPanelName: 'assets', sourceNodeId: 'source' },
      } as never,
    );

    expect(params).toEqual({
      id: 'project:assets:source',
      type: 'project:assets',
      title: 'Asset Browser',
      projectPanelName: 'assets',
      sourceNodeId: 'source',
    });
  });
});
