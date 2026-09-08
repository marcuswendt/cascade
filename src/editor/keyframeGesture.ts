/**
 * Keying a parameter from the Inspector.
 *
 * The engine could key a parameter and the dope sheet could show and move
 * keys, and nothing anywhere could *create* one — the gesture fell between two
 * agent briefs, one told "engine, no UI" and the other "no key insert from the
 * panel". Marcus found it by asking how to set a keyframe. This is that gesture.
 *
 * Houdini's convention: alt-click a parameter to key it at the current frame,
 * alt-click again to remove that key. A visible marker alongside, because the
 * other half of the question is knowing *which* parameters are animated —
 * Houdini colours them, and a keyed parameter that looks identical to a plain
 * one is only half a feature.
 */
import type { Node } from '@/nodes/Node';

export type KeyState =
  /** No channel on this parameter. */
  | 'none'
  /** Keyed, but not at the frame the playhead is on. */
  | 'keyed'
  /** Keyed, with a key exactly here. */
  | 'keyed-here';

type Parm = {
  hasChannel?: () => boolean;
  keys?: () => ReadonlyArray<{ frame: number }>;
  setKey?: (frame?: number, value?: number, interpolation?: string) => void;
  deleteKey?: (frame: number) => void;
};

/** Feature-detected, so an older Node without the channel API degrades to
 *  'none' and an inert marker rather than throwing in a panel render. */
function parmOf(node: Node, key: string): Parm | null {
  const parm = (node as any).parm?.(key);
  return parm && typeof parm === 'object' ? (parm as Parm) : null;
}

function currentFrame(node: Node): number {
  const frame = (node as any).currentFrame?.();
  return Number.isFinite(frame) ? Math.round(frame as number) : 1;
}

export function keyState(node: Node, key: string): KeyState {
  const parm = parmOf(node, key);
  if (!parm?.hasChannel?.()) return 'none';
  const keys = parm.keys?.() ?? [];
  if (!keys.length) return 'none';
  const here = currentFrame(node);
  return keys.some((k) => Math.round(k.frame) === here) ? 'keyed-here' : 'keyed';
}

/**
 * Set a key at the playhead, replacing one already there.
 *
 * Alt-click, and deliberately not a toggle. Marcus, 2026-09-08: Houdini has a
 * separate gesture for deletion, and he is right that it is the better shape —
 * while scrubbing you cannot be certain whether a key sits exactly on this
 * frame, so a toggle sometimes sets and sometimes deletes depending on
 * something you cannot see. Set always sets; re-keying updates the value, which
 * is what you want after nudging a slider.
 */
export function setKeyAtPlayhead(node: Node, key: string): 'set' | 'unavailable' {
  const parm = parmOf(node, key);
  if (!parm?.setKey) return 'unavailable';

  // Which value to key, and this is subtler than it looks.
  //
  // `setKey()` with no arguments keys the *evaluated* value — and once a
  // channel exists, evaluating resolves the channel, so the evaluated value is
  // the sampled one. Re-keying a parameter you had just edited would therefore
  // write back the old key's value and silently discard the edit. Caught by a
  // test asserting the obvious workflow: nudge a value, key it.
  //
  // So: standing on a key, key the *raw* value, because a raw value that
  // differs from the sampled one is exactly an edit waiting to be committed.
  // Anywhere else, key the evaluated value, which is what the field is showing
  // and what you would expect to pin.
  if (keyState(node, key) === 'keyed-here') {
    const raw = (node as any).props?.[key]?.value;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      parm.setKey(currentFrame(node), raw);
      return 'set';
    }
  }
  parm.setKey();
  return 'set';
}

/**
 * Delete the key at the playhead. Ctrl-click.
 *
 * Reports `absent` rather than pretending, because deleting nothing and
 * deleting something must be distinguishable to a caller that wants to say so.
 */
export function deleteKeyAtPlayhead(node: Node, key: string): 'removed' | 'absent' | 'unavailable' {
  const parm = parmOf(node, key);
  if (!parm?.deleteKey) return 'unavailable';
  if (keyState(node, key) !== 'keyed-here') return 'absent';
  parm.deleteKey(currentFrame(node));
  return 'removed';
}

/**
 * Toggle — what the diamond button does. A single visible affordance should
 * both set and clear; the modifier gestures are the explicit pair.
 */
export function toggleKeyAtPlayhead(node: Node, key: string): 'set' | 'removed' | 'unavailable' {
  if (keyState(node, key) === 'keyed-here') {
    const removed = deleteKeyAtPlayhead(node, key);
    return removed === 'removed' ? 'removed' : 'unavailable';
  }
  return setKeyAtPlayhead(node, key);
}

/** True when this parameter can be keyed at all — numbers only for now. */
export function isKeyable(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}
