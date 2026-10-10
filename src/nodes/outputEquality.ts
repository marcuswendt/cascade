/**
 * Whether a node's new output is provably the same as its previous one.
 *
 * Used for early cutoff: a node whose re-cook produced the same value does not
 * invalidate the graph below it. So the answer must never be a false "same",
 * and every doubt resolves to "changed":
 *
 *   - primitives compare with `Object.is`;
 *   - the SAME object reference at the top counts as changed, because it may
 *     have been mutated in place (a canvas, a reused buffer) and nothing here
 *     can tell. Nested inside distinct containers, a shared plain object or
 *     array counts as the same (spreading a previous value shares its parts),
 *     and a shared anything-else still counts as changed;
 *   - distinct plain objects and arrays compare structurally, and typed arrays
 *     by their bytes;
 *   - anything else (class instances, images, GPU resources, maps) is changed.
 *
 * A comparison that walks more than `budget` values gives up and says changed:
 * a cutoff that costs more than the cook it saves is not one.
 */
export function sameOutputValue(previous: unknown, next: unknown, budget = 2_000_000): boolean {
  const state = { remaining: budget };
  return same(previous, next, state, true);
}

function isPlain(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null || proto === Array.prototype;
}

function same(a: unknown, b: unknown, state: { remaining: number }, top: boolean): boolean {
  if (--state.remaining < 0) return false;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    if (typeof a === 'function' || typeof b === 'function') return false;
    return Object.is(a, b);
  }
  // One reference on both sides: possibly mutated in place, so unknown —
  // unless it is plain data shared inside two distinct containers.
  // Plain shared data is still walked, so a canvas nested in it is caught.
  if (a === b && (top || ArrayBuffer.isView(a) || !isPlain(a))) return false;
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b)) return false;
    if (a.constructor !== b.constructor || a.byteLength !== b.byteLength) return false;
    state.remaining -= a.byteLength / 8;
    if (state.remaining < 0) return false;
    const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  }
  if (!isPlain(a) || !isPlain(b)) return false;
  const arrayA = Array.isArray(a);
  if (arrayA !== Array.isArray(b)) return false;
  if (arrayA) {
    const x = a as unknown[];
    const y = b as unknown[];
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (!same(x[i], y[i], state, false)) return false;
    return true;
  }
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = Object.keys(x);
  if (keys.length !== Object.keys(y).length) return false;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(y, key)) return false;
    if (!same(x[key], y[key], state, false)) return false;
  }
  return true;
}
