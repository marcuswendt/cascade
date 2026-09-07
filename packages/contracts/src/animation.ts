/**
 * Animation as it appears in a document.
 *
 * A parameter can be a literal, an expression, or a keyframe channel. All
 * three serialise in one place — the node's `props` map — because a channel
 * that lived in a timeline object would need a registry of targets, and that
 * registry goes stale the moment a node is renamed.
 *
 * A prop with neither an expression nor a channel is still written as a bare
 * value, which is what every existing file on disk contains. The object form
 * appears only when there is something to say beyond the value.
 */

export type CascadeInterpolation = "constant" | "linear" | "smooth";

/** One key. `frame` may be fractional. Interpolation governs the segment that
 *  LEAVES this key, and is omitted when it is the default (`smooth`). */
export interface CascadeSerializedKeyframe {
  readonly frame: number;
  readonly value: number;
  readonly interpolation?: CascadeInterpolation;
}

/** Keys are written in frame order and hold at most one key per frame. A
 *  reader must tolerate neither being true and normalise. */
export interface CascadeSerializedChannel {
  readonly keys: readonly CascadeSerializedKeyframe[];
}

/**
 * The object form of a prop. Written when the parameter carries an expression,
 * a channel, or both.
 *
 * Both is legal, and the resolution order is fixed: **the channel wins and the
 * expression is kept but inert.** Discarding an author's expression because
 * they keyed the parameter is the worse failure of the two — the expression is
 * still there to go back to, and deleting the channel restores it.
 */
export interface CascadeSerializedProp {
  readonly value: unknown;
  readonly expression?: string;
  readonly channel?: CascadeSerializedChannel;
}
