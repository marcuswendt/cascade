/**
 * Per-node viewport memory.
 *
 * Marcus's ruling, 2026-09-09: *"local storage for the view stage"*, and each
 * node *"should remember the view settings last used and restore them if
 * possible."*
 *
 * The half worth testing is the failure behaviour, not the happy path. A
 * viewport that forgets a camera is a small disappointment; one that throws
 * while mounting shows nothing at all, and both storage directions can throw —
 * a read in a private window with site data blocked, a write on quota.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultView } from '../src/editor/viewport/viewCamera';
import { forgetView, loadView, saveView, viewKey } from '../src/editor/viewport/viewMemory';

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  } as Storage;
}

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeStorage());
});

describe('the view key', () => {
  it('scopes by project, node and port', () => {
    // Node ids are unique within a graph only, so two projects both have a
    // `node-1` — keying on the node alone hands one project's camera to
    // another's first node.
    expect(viewKey('a', 'node-1', 'geometry')).not.toBe(viewKey('b', 'node-1', 'geometry'));
    // And one node's two outputs are different pictures at different scales:
    // pop.Simulate emits both `geometry` and `trails`.
    expect(viewKey('a', 'node-1', 'geometry')).not.toBe(viewKey('a', 'node-1', 'trails'));
  });

  it('is null without a node, and a null key is a no-op everywhere', () => {
    expect(viewKey('a', null, 'geometry')).toBeNull();
    expect(loadView(null)).toBeNull();
    expect(() => saveView(null, defaultView(true))).not.toThrow();
    expect(() => forgetView(null)).not.toThrow();
  });
});

describe('remembering a view', () => {
  it('round-trips a view through storage', () => {
    const key = viewKey('p', 'n', 'geometry');
    const view = { ...defaultView(false), yaw: 42, orthoWidth: 9.5 };
    saveView(key, view);
    expect(loadView(key)).toEqual(view);
  });

  it('a node with nothing remembered reads as null, so detection can run', () => {
    // This is the branch the whole detect-once mechanism hangs off: a remembered
    // view wins, and only its absence triggers a measurement.
    expect(loadView(viewKey('p', 'fresh', 'geometry'))).toBeNull();
  });

  it('forgetting one view leaves the others', () => {
    const a = viewKey('p', 'a', 'out');
    const b = viewKey('p', 'b', 'out');
    saveView(a, defaultView(true));
    saveView(b, defaultView(false));
    forgetView(a);
    expect(loadView(a)).toBeNull();
    expect(loadView(b)).not.toBeNull();
  });

  it('evicts the oldest views rather than growing without bound', () => {
    // Unbounded this grows with every node ever selected and eventually throws
    // on a write, which would surface as a viewport that silently stopped
    // remembering.
    // Distinct touch times, set BEFORE each save, or eviction order is
    // undefined and the assertion below passes or fails by luck.
    vi.useFakeTimers();
    for (let index = 0; index < 260; index += 1) {
      vi.setSystemTime(new Date(1_000_000 + index * 10));
      saveView(viewKey('p', `node-${index}`, 'out'), { ...defaultView(true), yaw: index });
    }
    vi.useRealTimers();
    const table = JSON.parse(localStorage.getItem('cascade.viewport.views.v1')!);
    expect(Object.keys(table).length).toBeLessThanOrEqual(200);
    // The newest survives; the oldest is gone.
    expect(loadView(viewKey('p', 'node-259', 'out'))).not.toBeNull();
    expect(loadView(viewKey('p', 'node-0', 'out'))).toBeNull();
  });
});

describe('storage that throws', () => {
  it('a read that throws reads as no memory, not as a crash', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {},
    } as unknown as Storage);
    expect(loadView(viewKey('p', 'n', 'out'))).toBeNull();
  });

  it('a write that throws is swallowed — a quota is not a viewport failure', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    } as unknown as Storage);
    expect(() => saveView(viewKey('p', 'n', 'out'), defaultView(true))).not.toThrow();
  });

  it('corrupt stored JSON reads as no memory', () => {
    localStorage.setItem('cascade.viewport.views.v1', '{ not json');
    expect(loadView(viewKey('p', 'n', 'out'))).toBeNull();
    // And a later save repairs the table rather than failing forever.
    saveView(viewKey('p', 'n', 'out'), defaultView(true));
    expect(loadView(viewKey('p', 'n', 'out'))).not.toBeNull();
  });

  it('a stored value that is not an object reads as no memory', () => {
    localStorage.setItem('cascade.viewport.views.v1', '"a string"');
    expect(loadView(viewKey('p', 'n', 'out'))).toBeNull();
  });
});
