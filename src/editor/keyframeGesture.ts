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
 * Toggle a key at the playhead. Returns what it did, so a caller can report
 * rather than guess — a gesture that silently does nothing is the thing this
 * whole file exists to stop.
 */
export function toggleKeyAtPlayhead(node: Node, key: string): 'set' | 'removed' | 'unavailable' {
  const parm = parmOf(node, key);
  if (!parm?.setKey || !parm.deleteKey) return 'unavailable';

  if (keyState(node, key) === 'keyed-here') {
    parm.deleteKey(currentFrame(node));
    return 'removed';
  }
  // No arguments: key the current frame at the current evaluated value, which
  // is what alt-click means and what setKey() was written for.
  parm.setKey();
  return 'set';
}

/** True when this parameter can be keyed at all — numbers only for now. */
export function isKeyable(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}
