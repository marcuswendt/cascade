// @vitest-environment jsdom
import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import TimelinePanel from '@/editor/panels/TimelinePanel.svelte';

// The ruler measures itself with bind:clientWidth, which Svelte implements
// with a ResizeObserver — jsdom has none, so the panel would fail to mount
// here for a reason that does not exist in a browser.
class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as any).ResizeObserver ??= StubResizeObserver;

function channelParm(keys: Array<{ frame: number; value: number }>) {
  return {
    hasChannel: () => keys.length > 0,
    keys: () => [...keys],
    setKey: () => {},
    deleteKey: () => {},
  };
}

const params = { id: 'timeline-main', type: 'timeline' as const, title: 'Timeline' };

describe('TimelinePanel', () => {
  it('renders the transport and an empty dope sheet for an unkeyed graph', () => {
    const graph = { nodes: [], execute: async () => {} };
    const view = render(TimelinePanel, {
      props: { panelId: 'timeline-main', panelParams: params, graph: graph as any },
    });
    expect(view.getByLabelText('Play')).toBeTruthy();
    expect(view.getByLabelText('Step forward')).toBeTruthy();
    expect(view.getByLabelText('Current frame')).toBeTruthy();
    expect(view.getByText(/No keyed parameters/)).toBeTruthy();
  });

  it('lists one row per keyed parameter', async () => {
    const graph = {
      nodes: [{
        id: 'circle',
        path: () => '/circle',
        props: { radius: { value: 1 }, colour: { value: 2 } },
        parm: (name: string) => (name === 'radius' ? channelParm([{ frame: 3, value: 8 }]) : null),
      }],
      execute: async () => {},
    };
    const view = render(TimelinePanel, {
      props: { panelId: 'timeline-main', panelParams: params, graph: graph as any },
    });
    expect(view.getByTitle('/circle/radius')).toBeTruthy();
    expect(view.getByText('1 channel · drag a key to move it in time')).toBeTruthy();
  });
});
