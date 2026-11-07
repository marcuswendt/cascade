import { describe, expect, it } from 'vitest';
import { evaluateArithmetic, nudgeValue } from '@/editor/components/fieldMaths';
import { createScrubState } from '@/editor/components/scrub';
import { numberFieldCommit } from '@/editor/components/numberFieldCommit';

/** What a number field works out when it is typed sums rather than a number. */
describe('field arithmetic', () => {
  it('works out the four operations, precedence and parentheses', () => {
    expect(evaluateArithmetic('320/2')).toBe(160);
    expect(evaluateArithmetic('10+5')).toBe(15);
    expect(evaluateArithmetic(' 2 + 3 * 4 ')).toBe(14);
    expect(evaluateArithmetic('(2+3)*4')).toBe(20);
    expect(evaluateArithmetic('-1.5e1 - -5')).toBe(-10);
    expect(evaluateArithmetic('.5*4')).toBe(2);
  });

  it('refuses anything that is not plain arithmetic, so it is never run', () => {
    for (const text of ['', '$T*2', 'sin(1)', '1/0', '2*', '(1+2', '1 2', 'alert(1)', '1)']) {
      expect(evaluateArithmetic(text), text).toBeNull();
    }
  });

  it('is a value in a number field, not an expression', () => {
    const outcome = numberFieldCommit('320/2', {
      lastCommitted: null,
      allowExpression: true,
      expressionError: () => null,
    });
    expect(outcome).toEqual({ kind: 'value', text: '320/2', value: 160 });
    // A real binding still becomes one.
    expect(numberFieldCommit('$T*2', { lastCommitted: null, allowExpression: true, expressionError: () => null }).kind)
      .toBe('expression');
  });
});

describe('a nudge', () => {
  it('steps, ten with shift, clamped and without float noise', () => {
    expect(nudgeValue(0.1, 1, 0.2, {})).toBe(0.3);
    expect(nudgeValue(5, 1, 1, { max: 10 }, true)).toBe(10);
    expect(nudgeValue(2.6, -1, 1, { integer: true })).toBe(2);
  });
});

describe('the ruler at a limit', () => {
  it('knows when the drag is pressed against min or max', () => {
    const drag = createScrubState(9, { min: 0, max: 10, integer: true });
    drag.move(2, {});
    expect(drag.atLimit).toBe(false);
    drag.move(400, {});
    expect(drag.atLimit).toBe(true);
    drag.move(-8, {});
    expect(drag.atLimit).toBe(false);
  });
});
