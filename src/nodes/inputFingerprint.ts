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
 * nobody is trying to make them collide. Two 32-bit lanes, 64 bits in all.
 */

const identities = new WeakMap<object, number>();
let nextIdentity = 1;

/** A number unique to this object for as long as it lives. */
export function identityOf(value: object): number {
  let id = identities.get(value);
  if (id === undefined) {
    id = nextIdentity++;
    identities.set(value, id);
  }
  return id;
}

function hex(a: number, b: number): string {
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

/** Every byte of a view, hashed. Reads 32-bit words where the view is aligned,
 *  which is the case for every Float32Array channel. */
export function hashBytes(view: ArrayBufferView): string {
  // An unaligned view (rare: a subarray at an odd byte offset) is copied once,
  // so the same bytes hash the same wherever they sit.
  if ((view.byteOffset & 3) !== 0) view = new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice();
  const { buffer, byteOffset, byteLength } = view;
  const count = byteLength >>> 2;
  const words = new Int32Array(buffer, byteOffset, count);
  // Four independent lanes so the multiplies pipeline. Each step multiplies
  // and then rotates: a multiply only carries a bit upwards, so without the
  // rotate two sign flips in one lane would cancel out.
  let a = 0x811c9dc5 ^ byteLength;
  let b = 0x9e3779b9;
  let c = 0x85ebca6b;
  let d = 0xc2b2ae35;
  const blocks = count & ~3;
  for (let i = 0; i < blocks; i += 4) {
    a = Math.imul(a ^ words[i]!, 0x01000193); a = (a << 13) | (a >>> 19);
    b = Math.imul(b ^ words[i + 1]!, 0x5bd1e995); b = (b << 13) | (b >>> 19);
    c = Math.imul(c ^ words[i + 2]!, 0x01000193); c = (c << 13) | (c >>> 19);
    d = Math.imul(d ^ words[i + 3]!, 0x5bd1e995); d = (d << 13) | (d >>> 19);
  }
  for (let i = blocks; i < count; i++) { a = Math.imul(a ^ words[i]!, 0x01000193); a = (a << 13) | (a >>> 19); }
  let h1 = Math.imul(a ^ (c >>> 13), 0x85ebca6b) ^ Math.imul(d, 0xc2b2ae35);
  let h2 = Math.imul(b ^ (d >>> 16), 0xc2b2ae35) ^ Math.imul(c, 0x27d4eb2f);
  const start = count << 2;
  if (start < byteLength) {
    const bytes = new Uint8Array(buffer, byteOffset + start, byteLength - start);
    for (let i = 0; i < bytes.length; i++) {
      h1 = Math.imul(h1 ^ bytes[i]!, 0x01000193);
      h2 = Math.imul(h2 ^ bytes[i]!, 0x5bd1e995);
      h2 ^= h2 >>> 15;
    }
  }
  return hex(h1, h2);
}

/** Every character of a string, hashed. */
export function hashString(text: string): string {
  let h1 = 0x811c9dc5 ^ text.length;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193);
    h2 = Math.imul(h2 ^ code, 0x5bd1e995);
    h2 ^= h2 >>> 15;
  }
  return hex(h1, h2);
}

function isPlain(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null || proto === Array.prototype;
}

/** An ImageBuffer, or anything shaped like one: dimensions plus channel data. */
function imageChannels(value: Record<string, unknown>): ArrayBufferView[] | null {
  if (typeof value.width !== 'number' || typeof value.height !== 'number') return null;
  const channels = value.channels;
  if (!Array.isArray(channels) || !channels.every((channel) => ArrayBuffer.isView(channel))) return null;
  return channels as ArrayBufferView[];
}

function isDomImage(value: object): value is { width: number; height: number } {
  return (typeof HTMLCanvasElement !== 'undefined' && value instanceof HTMLCanvasElement)
    || (typeof HTMLImageElement !== 'undefined' && value instanceof HTMLImageElement)
    || (typeof OffscreenCanvas !== 'undefined' && value instanceof OffscreenCanvas)
    || (typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap);
}

/** JSON with every typed array replaced by its hash, so nested pixel data is
 *  covered without being spelled out as text. */
function hashingReplacer(_key: string, item: unknown): unknown {
  if (item && typeof item === 'object' && ArrayBuffer.isView(item)) {
    return `#bytes:${item.constructor.name}:${item.byteLength}:${hashBytes(item)}`;
  }
  if (typeof item === 'bigint') return `#bigint:${item.toString()}`;
  return item;
}

/**
 * A fingerprint of a value with no producer to vouch for it. Equal content
 * gives an equal fingerprint (so re-setting the same number does not re-cook),
 * and different content gives a different one, whatever its size.
 *
 * Objects whose content cannot be read cheaply — a canvas, a GPU resource, a
 * class instance JSON cannot see into — carry their identity as well, so a new
 * one always counts as a change. One mutated in place under the same identity
 * cannot be seen from here; a connected input does not have that gap, because
 * its producer's version moves.
 */
export function valueFingerprint(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  const type = typeof value;
  if (type === 'function' || type === 'symbol') return `${type}#${identityOf(value as object)}`;
  if (type !== 'object') return `${type}:${String(value)}`;
  const object = value as object;

  if (ArrayBuffer.isView(object)) {
    return `${object.constructor.name}[${object.byteLength}]:${hashBytes(object)}`;
  }
  if (object instanceof ArrayBuffer) return `ArrayBuffer[${object.byteLength}]:${hashBytes(new Uint8Array(object))}`;

  const record = object as Record<string, unknown>;
  const channels = imageChannels(record);
  if (channels) {
    const space = typeof record.colorSpace === 'string' ? record.colorSpace : '';
    return `img:${record.width}x${record.height}x${channels.length}${space ? `:${space}` : ''}:${channels.map(hashBytes).join(',')}`;
  }
  if (isDomImage(object)) return `el#${identityOf(object)}:${object.width}x${object.height}`;

  let json: string | undefined;
  try {
    json = JSON.stringify(object, hashingReplacer);
  } catch {
    return `obj#${identityOf(object)}`;
  }
  const body = json === undefined ? 'undefined' : json.length < 500 ? json : `${json.length}:${hashString(json)}`;
  return isPlain(object) ? `json:${body}` : `obj#${identityOf(object)}:${body}`;
}
