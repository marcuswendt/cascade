/**
 * Keyframe channels, neutral runtime.
 *
 * A channel is the third way a parameter becomes a value, beside a literal and
 * an expression. It is an ordered list of keys and a rule for what happens
 * between them, and it is sampled — never pushed. The host asks for the value
 * at a frame; nothing here holds a clock, a graph or a node, which is what
 * keeps the whole thing deterministic and testable on its own.
 *
 * `sin($T)` and a drawn curve are the same shape: one written, one drawn.
 *
 * Every function here is pure. A channel is treated as immutable — `setKey`
 * and `deleteKey` return a new channel rather than editing one in place — so a
 * caller can hold a channel across a cook without it changing underneath.
 */

/**
 * What happens between a key and the next one. The mode belongs to the key on
 * the LEFT of a segment: it describes how the value leaves that key.
 *
 *   constant — hold the left value until the next key. Steps, not motion
 *   linear   — straight line. Constant velocity, visible corners at the keys
 *   smooth   — Hermite with automatic tangents. The default, because linear
 *              everywhere is how animation looks when nobody chose
 */
export type Interpolation = "constant" | "linear" | "smooth";

/** Smooth, deliberately: an unset default of `linear` animates like a robot. */
export const DEFAULT_INTERPOLATION: Interpolation = "smooth";

const INTERPOLATIONS: readonly Interpolation[] = ["constant", "linear", "smooth"];

export function isInterpolation(value: unknown): value is Interpolation {
  return typeof value === "string" && (INTERPOLATIONS as readonly string[]).includes(value);
}

/** One key. `frame` may be fractional; `value` is a plain number. */
export interface Keyframe {
  readonly frame: number;
  readonly value: number;
  readonly interpolation: Interpolation;
}

/** A key as a caller may hand it in — interpolation optional. */
export interface KeyframeInput {
  readonly frame: number;
  readonly value: number;
  readonly interpolation?: Interpolation | string;
}

/**
 * An animated parameter. `keys` is always sorted by frame and holds at most
 * one key per frame — `createChannel` is the only way that invariant is
 * established, and every other function here preserves it.
 */
export interface Channel {
  readonly keys: readonly Keyframe[];
}

/** The empty channel. Sampling it returns undefined, so a caller falls back. */
export const EMPTY_CHANNEL: Channel = Object.freeze({ keys: Object.freeze([]) as readonly Keyframe[] });

/**
 * Build a channel from keys in any order, with anything unusable dropped.
 *
 * Unordered input is sorted rather than rejected — a file edited by hand and a
 * UI that appends are both legitimate sources. A duplicate frame keeps the
 * LAST key given, which is what "set this key again" means.
 */
export function createChannel(keys: readonly KeyframeInput[] = []): Channel {
  const byFrame = new Map<number, Keyframe>();

  for (const key of keys) {
    if (!key) continue;
    const frame = Number(key.frame);
    const value = Number(key.value);
    if (!Number.isFinite(frame) || !Number.isFinite(value)) continue;
    byFrame.set(frame, {
      frame,
      value,
      interpolation: isInterpolation(key.interpolation) ? key.interpolation : DEFAULT_INTERPOLATION
    });
  }

  const sorted = [...byFrame.values()].sort((a, b) => a.frame - b.frame);
  return { keys: sorted };
}

export function isChannel(value: unknown): value is Channel {
  return !!value && typeof value === "object" && Array.isArray((value as Channel).keys);
}

/** A channel with no keys resolves to nothing, so the raw value still applies. */
export function isEmptyChannel(channel: Channel | null | undefined): boolean {
  return !channel || channel.keys.length === 0;
}

export function keyAt(channel: Channel, frame: number): Keyframe | undefined {
  return channel.keys.find(key => key.frame === frame);
}

/**
 * Set a key, replacing any key already on that frame.
 *
 * Re-keying an existing frame keeps that key's interpolation unless a new one
 * is given: dragging a value should not silently change its easing.
 */
export function setKey(
  channel: Channel | null | undefined,
  frame: number,
  value: number,
  interpolation?: Interpolation
): Channel {
  const base = channel ?? EMPTY_CHANNEL;
  if (!Number.isFinite(frame) || !Number.isFinite(value)) return createChannel(base.keys);

  const existing = keyAt(base, frame);
  const mode = interpolation ?? existing?.interpolation ?? DEFAULT_INTERPOLATION;
  const kept = base.keys.filter(key => key.frame !== frame);
  return createChannel([...kept, { frame, value, interpolation: mode }]);
}

/** Remove the key on that frame. Removing the last key leaves an empty channel. */
export function deleteKey(channel: Channel | null | undefined, frame: number): Channel {
  const base = channel ?? EMPTY_CHANNEL;
  return createChannel(base.keys.filter(key => key.frame !== frame));
}

/** Change one key's outgoing interpolation without touching its value. */
export function setKeyInterpolation(
  channel: Channel | null | undefined,
  frame: number,
  interpolation: Interpolation
): Channel {
  const base = channel ?? EMPTY_CHANNEL;
  const existing = keyAt(base, frame);
  if (!existing) return createChannel(base.keys);
  return setKey(base, frame, existing.value, interpolation);
}

/**
 * The value at any frame, fractional included.
 *
 * Returns undefined for a channel with no keys — that is the signal to fall
 * back to the parameter's raw value rather than to invent a zero.
 *
 * Outside the key range the end values are HELD, in both directions. No
 * extrapolation: a curve that keeps climbing past its last key is never what
 * anyone meant, and it is the failure that is hardest to see in a render.
 */
export function sampleChannel(channel: Channel | null | undefined, frame: number): number | undefined {
  if (!channel || channel.keys.length === 0) return undefined;

  const keys = channel.keys;
  if (!Number.isFinite(frame)) return keys[0].value;
  if (keys.length === 1) return keys[0].value;
  if (frame <= keys[0].frame) return keys[0].value;
  if (frame >= keys[keys.length - 1].frame) return keys[keys.length - 1].value;

  const i = segmentIndex(keys, frame);
  const k0 = keys[i];
  const k1 = keys[i + 1];
  const span = k1.frame - k0.frame;
  if (span <= 0) return k1.value;

  const t = (frame - k0.frame) / span;

  switch (k0.interpolation) {
    case "constant":
      return k0.value;
    case "linear":
      return k0.value + (k1.value - k0.value) * t;
    case "smooth":
    default:
      return hermite(keys, i, t, span);
  }
}

/** Index of the key at or before `frame`, binary searched. */
function segmentIndex(keys: readonly Keyframe[], frame: number): number {
  let lo = 0;
  let hi = keys.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (keys[mid].frame <= frame) lo = mid;
    else hi = mid - 1;
  }
  return Math.min(lo, keys.length - 2);
}

/**
 * Cubic Hermite across segment `i`, with tangents derived from the neighbours.
 *
 * There are no tangent handles yet — that is the curve editor, and it is the
 * largest single piece of UI in the plan. Until it exists the tangents are
 * automatic, in the way both Houdini and After Effects pick them by default:
 *
 *   - a key with a neighbour on each side takes the central difference, which
 *     is what makes velocity continuous through a key rather than kinked
 *   - the first and last key are FLAT, so a two-key smooth channel eases in
 *     and out. This is the behaviour people mean by "smooth"; a straight line
 *     between two keys would be indistinguishable from linear
 *   - a constant segment next door flattens the tangent it touches, so a hold
 *     does not make the neighbouring curve bulge to reach it
 */
function hermite(keys: readonly Keyframe[], i: number, t: number, span: number): number {
  const k0 = keys[i];
  const k1 = keys[i + 1];

  const m0 = tangent(keys, i, "out");
  const m1 = tangent(keys, i + 1, "in");

  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;

  return h00 * k0.value + h10 * span * m0 + h01 * k1.value + h11 * span * m1;
}

/** Value change per frame at key `i`, seen from the segment on `side`. */
function tangent(keys: readonly Keyframe[], i: number, side: "in" | "out"): number {
  const prev = keys[i - 1];
  const next = keys[i + 1];
  if (!prev || !next) return 0;

  // A hold on either side means the curve arrives, or leaves, level.
  if (side === "out" && prev.interpolation === "constant") return 0;
  if (side === "in" && keys[i].interpolation === "constant") return 0;

  const span = next.frame - prev.frame;
  if (span <= 0) return 0;
  return (next.value - prev.value) / span;
}

// ============ Serialisation ============

/**
 * The on-disk form. Interpolation is omitted when it is the default, so a
 * plain channel reads as `{ "keys": [{ "frame": 1, "value": 0 }] }` and a diff
 * shows easing changes rather than noise.
 *
 * Structurally identical to `CascadeSerializedChannel` in the contracts
 * package, which is where the document shape is declared. It is restated here
 * so this module keeps depending on nothing.
 */
export interface SerializedKeyframe {
  frame: number;
  value: number;
  interpolation?: Interpolation;
}

export interface SerializedChannel {
  keys: SerializedKeyframe[];
}

export function serializeChannel(channel: Channel | null | undefined): SerializedChannel | undefined {
  if (isEmptyChannel(channel)) return undefined;
  return {
    keys: channel!.keys.map(key => (
      key.interpolation === DEFAULT_INTERPOLATION
        ? { frame: key.frame, value: key.value }
        : { frame: key.frame, value: key.value, interpolation: key.interpolation }
    ))
  };
}

/**
 * Read a channel back. Anything unrecognised yields the empty channel rather
 * than an exception — a bad channel in one parameter must not fail a load.
 */
export function deserializeChannel(data: unknown): Channel {
  if (!data || typeof data !== "object") return EMPTY_CHANNEL;
  const keys = (data as { keys?: unknown }).keys;
  if (!Array.isArray(keys)) return EMPTY_CHANNEL;
  return createChannel(keys as KeyframeInput[]);
}
