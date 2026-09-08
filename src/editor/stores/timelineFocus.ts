/**
 * Which parameter the Timeline should be looking at.
 *
 * Marcus, 2026-09-08: *"in Houdini you can alt-click on a parameter to set a
 * keyframe. you can also bring up a channel editor by right-clicking on a
 * parameter."* Right-click is the second gesture — it opens the animation
 * editor scoped to the parameter you clicked, rather than to the whole graph.
 *
 * A store rather than a prop because the Inspector and the Timeline are
 * separate dockview panels with no parent in common; a panel mounted by
 * dockview cannot be handed props by the component that wants to talk to it.
 */
import { writable } from 'svelte/store';

export interface TimelineFocusRequest {
  readonly nodeId: string;
  readonly param: string;
  /** Bumped per request so asking twice for the same parameter still fires. */
  readonly nonce: number;
}

export const timelineFocus = writable<TimelineFocusRequest | null>(null);

let nonce = 0;

/** Ask the Timeline to select this parameter's track. */
export function requestTimelineFocus(nodeId: string, param: string): void {
  nonce += 1;
  timelineFocus.set({ nodeId, param, nonce });
}
