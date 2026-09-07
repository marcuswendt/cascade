// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { collectTracks, moveKey, normalizeKey, readKeys } from '@/editor/panels/timeline/channels';

/** A node shaped like the real one, with only the channel API under test. */
function node(id: string, params: Record<string, any>) {
  return {
    id,
    path: () => `/${id}`,
    props: Object.fromEntries(Object.keys(params).map(name => [name, { value: 0 }])),
    parm: (name: string) => params[name] ?? null,
  };
}

function channelParm(keys: Array<{ frame: number; value: number; interpolation?: string }>) {
  const state = [...keys];
  return {
    state,
    hasChannel: () => state.length > 0,
    keys: () => [...state],
    setKey: (frame: number, value: number, interpolation?: string) => {
      const at = state.findIndex(k => k.frame === frame);
      const key = { frame, value, interpolation };
      if (at >= 0) state[at] = key; else state.push(key);
    },
    deleteKey: (frame: number) => {
      const at = state.findIndex(k => k.frame === frame);
      if (at >= 0) state.splice(at, 1);
    },
  };
}

describe('reading channels defensively', () => {
  it('returns nothing for a parm with no channel API at all', () => {
    expect(readKeys({ eval: () => 1 })).toEqual([]);
    expect(readKeys(null)).toEqual([]);
  });

  it('returns nothing when hasChannel says there is none', () => {
    expect(readKeys({ hasChannel: () => false, keys: () => [{ frame: 1, value: 2 }] })).toEqual([]);
  });

  it('sorts keys by frame and carries interpolation through', () => {
    const keys = readKeys(channelParm([
      { frame: 9, value: 1, interpolation: 'linear' },
      { frame: 2, value: 5 },
    ]));
    expect(keys.map(k => k.frame)).toEqual([2, 9]);
    expect(keys[1].interpolation).toBe('linear');
  });

  it('survives a channel that throws', () => {
    expect(readKeys({ keys: () => { throw new Error('mid-retarget'); } })).toEqual([]);
  });

  it('accepts the alternate key spellings rather than rendering an empty sheet', () => {
    expect(normalizeKey({ f: 3, v: 7 })).toEqual({ frame: 3, value: 7, interpolation: undefined });
    expect(normalizeKey({ time: 4, value: 1 })?.frame).toBe(4);
    expect(normalizeKey({ value: 1 })).toBeNull();
    expect(normalizeKey('nope')).toBeNull();
  });
});

describe('collecting tracks from a graph', () => {
  it('produces one row per keyed parameter and skips unkeyed ones', () => {
    const graph = {
      nodes: [
        node('circle', { radius: channelParm([{ frame: 1, value: 0 }]), colour: { eval: () => 1 } }),
        node('noise', { amount: channelParm([{ frame: 5, value: 2 }, { frame: 1, value: 0 }]) }),
      ],
    };
    const tracks = collectTracks(graph as any);
    expect(tracks.map(t => `${t.nodeId}/${t.param}`)).toEqual(['circle/radius', 'noise/amount']);
    expect(tracks[1].keys.map(k => k.frame)).toEqual([1, 5]);
    expect(tracks[0].nodePath).toBe('/circle');
  });

  it('renders nothing rather than failing when the channel API is absent', () => {
    const graph = { nodes: [node('circle', { radius: { eval: () => 1 } })] };
    expect(collectTracks(graph as any)).toEqual([]);
    expect(collectTracks(undefined)).toEqual([]);
    expect(collectTracks({ nodes: [{ id: 'bare' }] } as any)).toEqual([]);
  });
});

describe('moving a key in time', () => {
  it('sets the key at the new frame and deletes the old one', () => {
    const radius = channelParm([{ frame: 4, value: 12, interpolation: 'constant' }]);
    const graph = { nodes: [node('circle', { radius })] };
    expect(moveKey(graph as any, 'circle', 'radius', 4, 20)).toBe(true);
    expect(radius.state).toEqual([{ frame: 20, value: 12, interpolation: 'constant' }]);
  });

  it('prefers a moveKey fast path when the channel offers one', () => {
    const moved: number[][] = [];
    const parm = { ...channelParm([{ frame: 4, value: 1 }]), moveKey: (a: number, b: number) => moved.push([a, b]) };
    const graph = { nodes: [node('circle', { radius: parm })] };
    expect(moveKey(graph as any, 'circle', 'radius', 4, 9)).toBe(true);
    expect(moved).toEqual([[4, 9]]);
  });

  it('reports false rather than pretending when the channel cannot move keys', () => {
    const graph = { nodes: [node('circle', { radius: { hasChannel: () => true, keys: () => [{ frame: 4, value: 1 }] } })] };
    expect(moveKey(graph as any, 'circle', 'radius', 4, 9)).toBe(false);
    expect(moveKey(graph as any, 'ghost', 'radius', 4, 9)).toBe(false);
  });

  it('treats a move to the same frame as a no-op success', () => {
    expect(moveKey({ nodes: [] } as any, 'circle', 'radius', 4, 4)).toBe(true);
  });
});
