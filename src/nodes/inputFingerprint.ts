/**
 * What a node's input "is", for deciding whether the node is still clean.
 *
 * Until 6 Nov 2026 this sampled: a typed array was its length plus its first,
 * middle and last value, and an image was its width x height x channels. Two
 * different images of the same size therefore had the same fingerprint, and a
 * clean node fed the second one reported `isDirty === false` and skipped its
 * re-cook. A fingerprint may say "changed" when nothing did (one extra cook);
 * it must never say "same" when something did (a wrong picture).
 *
 * So there are two exact answers, picked by where the value comes from:
 *
 *   - A connected input is keyed by its upstream output's version
 *     (`Node.outputVersion`), which the producer bumps on every commit that is
 *     not provably the same value. O(1), and exact by construction. That is
 *     `Node.ts`'s side of this.
 *   - A value set directly on a port has no producer to vouch for it, so it is
 *     hashed in full: every byte of a typed array or image channel, and the
 *     whole JSON of plain data. `valueFingerprint` below.
 *
 * The hash is not cryptographic; it only has to tell two buffers apart when
 * nobody is trying to make them collide. Four 32-bit lanes, 128 bits.
 * Kept small on purpose: this file is in the Studio entry chunk, which has a
 * byte budget (scripts/bundle-budget.mjs).
 */

const identities = new WeakMap<object, number>();
let nextIdentity = 1;

/** A number unique to this object for as long as it lives. */
const identityOf = (value: object): number =>
  identities.get(value) ?? (identities.set(value, nextIdentity), nextIdentity++);

/** Every byte of a view, hashed, about 11 GB/s. Reads 32-bit words; a view
 *  that is unaligned or not a whole number of words (rare: every image channel
 *  is a Float32Array) is first copied into a zero-padded word buffer. The
 *  length is part of the seed, so the padding cannot collide with real zeros. */
export function hashBytes(view: ArrayBufferView): string {
  const length = view.byteLength;
  let words: Int32Array;
  if ((view.byteOffset | length) & 3) {
    const padded = new Uint8Array((length + 3) & ~3);
    padded.set(new Uint8Array(view.buffer, view.byteOffset, length));
    words = new Int32Array(padded.buffer);
  } else {
    words = new Int32Array(view.buffer, view.byteOffset, length >> 2);
  }
  // Four independent lanes so the multiplies pipeline. Each step multiplies
  // and then rotates: a multiply only carries a bit upwards, so without the
  // rotate two sign flips in one lane would cancel out. A short tail goes to
  // lane `a`, whose position in the word order still keeps it distinct.
  // Unrolled by hand: a lane array indexed per word is four times slower.
  let a = 0x811c9dc5 ^ length, b = 0x9e3779b9, c = 0x85ebca6b, d = 0xc2b2ae35;
  const count = words.length;
  const blocks = count & ~3;
  for (let i = 0; i < blocks; i += 4) {
    a = Math.imul(a ^ words[i]!, 0x01000193); a = (a << 13) | (a >>> 19);
    b = Math.imul(b ^ words[i + 1]!, 0x5bd1e995); b = (b << 13) | (b >>> 19);
    c = Math.imul(c ^ words[i + 2]!, 0x01000193); c = (c << 13) | (c >>> 19);
    d = Math.imul(d ^ words[i + 3]!, 0x5bd1e995); d = (d << 13) | (d >>> 19);
  }
  for (let i = blocks; i < count; i++) { a = Math.imul(a ^ words[i]!, 0x01000193); a = (a << 13) | (a >>> 19); }
  return [a, b, c, d].map((lane) => (lane >>> 0).toString(36)).join('.');
}

/** JSON with every typed array replaced by its hash, so nested pixel data is
 *  covered without being spelled out as text. */
const hashingReplacer = (_key: string, item: unknown): unknown =>
  ArrayBuffer.isView(item) ? `#${hashBytes(item)}` : item;

/**
 * A fingerprint of a value with no producer to vouch for it. Equal content
 * gives an equal fingerprint (so re-setting the same number does not re-cook),
 * and different content gives a different one, whatever its size.
 *
 * An image (an ImageBuffer, or anything with width, height and typed-array
 * channels) is its dimensions and every channel's bytes. Plain data and typed
 * arrays are their content. Anything else — a canvas, a GPU resource, a class
 * instance JSON cannot see into — also carries its identity, so a new one
 * always counts as a change. One mutated in place under the same identity
 * cannot be seen from here; a connected input does not have that gap, because
 * its producer's version moves.
 */
export function valueFingerprint(value: unknown): string {
  const type = typeof value;
  // A function falls through to the identity path below (JSON cannot see it).
  if (value == null || (type !== 'object' && type !== 'function')) return `${type}:${String(value)}`;
  const object = value as Record<string, unknown>;

  const channels = object.channels;
  if (Array.isArray(channels) && channels.every((channel) => ArrayBuffer.isView(channel))) {
    return `${object.width}x${object.height}:${object.colorSpace}:${channels.map(hashBytes).join(',')}`;
  }

  // Large plain data stays spelled out rather than hashed: comparing it is as
  // cheap as hashing it, and the string is gone after the next cook.
  let json: string | undefined;
  try {
    json = JSON.stringify(object, hashingReplacer);
  } catch {
    json = `#${identityOf(object)}`; // cyclic or unserialisable: identity only
  }
  const proto = Object.getPrototypeOf(object);
  const content = proto === Object.prototype || proto === null || Array.isArray(object) || ArrayBuffer.isView(object);
  return content ? `json:${json}` : `obj#${identityOf(object)}:${json}`;
}
