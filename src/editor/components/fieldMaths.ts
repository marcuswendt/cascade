/**
 * The arithmetic a number field accepts as a value, and its one-step nudge.
 * Shared by `NumberInput` and `VectorInput`, which scrub through `scrub.ts`.
 *
 * Typing `320/2` or `10+5` into a field means the number it works out to
 * (the scrub number Marcus approved, 2026-11-07), not a live expression: a
 * binding is for `$T` and `ch()`, which this refuses. A small parser rather
 * than `Function()`, so nothing typed is ever run as code.
 */
import { clampScrub, type ScrubMeta } from './scrub';

const TOKENS = /(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|[-+*/()]/g;

/** `+ - * /` and parentheses over plain numbers, or null for anything else. */
export function evaluateArithmetic(text: string): number | null {
  // `1 2` is not 12.
  if (/[\d.]\s+[\d.]/.test(text)) return null;
  const source = text.replace(/\s+/g, '');
  const tokens = source.match(TOKENS) ?? [];
  if (!source || tokens.join('') !== source) return null;
  let at = 0;

  const sum = (): number => {
    let value = product();
    while (tokens[at] === '+' || tokens[at] === '-') value = tokens[at++] === '+' ? value + product() : value - product();
    return value;
  };
  const product = (): number => {
    let value = unary();
    while (tokens[at] === '*' || tokens[at] === '/') value = tokens[at++] === '*' ? value * unary() : value / unary();
    return value;
  };
  const unary = (): number => {
    const token = tokens[at++];
    if (token === '-') return -unary();
    if (token === '+') return unary();
    if (token === '(') {
      const value = sum();
      return tokens[at++] === ')' ? value : NaN;
    }
    return token !== undefined && token !== ')' ? Number(token) : NaN;
  };

  const value = sum();
  return at === tokens.length && Number.isFinite(value) ? value : null;
}

/** One step up or down (ten with Shift), clamped, without float noise. The
 *  arrow keys and the field's ‹ › buttons both step this way. */
export function nudgeValue(base: number, direction: number, step: number, meta: ScrubMeta, coarse = false): number {
  const next = clampScrub(base + direction * step * (coarse ? 10 : 1), meta);
  return meta.integer ? Math.round(next) : Number(next.toFixed(6));
}
