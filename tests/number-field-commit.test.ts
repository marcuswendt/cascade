/**
 * What a number field does with the text in it.
 *
 * Both faults here were measured by MW-OBSERVATORY-ART in a browser session on
 * 2026-09-09, and both were invisible to this repo: there is no harness that
 * mounts a Svelte component, so a leaf input's behaviour had no way to be
 * checked at all. Which is why the decision now lives in a function.
 */
import { describe, expect, it } from 'vitest';

import { numberFieldCommit } from '@/editor/components/numberFieldCommit';

/** A stand-in for `expressionEngine.compile().error`, so the tests state the
 *  parse result rather than depending on the parser. */
const parses = () => null;
const failsToParse = () => 'Unexpected number';

const field = (over: Partial<Parameters<typeof numberFieldCommit>[1]> = {}) => ({
  lastCommitted: null,
  allowExpression: true,
  expressionError: parses,
  ...over,
});

describe('a number', () => {
  it('commits', () => {
    expect(numberFieldCommit('1.215', field()))
      .toEqual({ kind: 'value', text: '1.215', value: 1.215 });
  });

  it('commits in every shape a number comes in', () => {
    for (const text of ['0', '-3', '+2', '.5', '1.', '2e3', '-1.5e-3', '  7  ']) {
      expect(numberFieldCommit(text, field()).kind).toBe('value');
    }
  });
});

describe('an expression', () => {
  it('commits when it parses', () => {
    expect(numberFieldCommit('$T * 0.25', field()))
      .toEqual({ kind: 'expression', text: '$T * 0.25', expression: '$T * 0.25' });
  });

  /**
   * The fault. `0.41.215` is what typing `0.4` in front of an existing `1.215`
   * produces, and it used to become an expression — which removed the slider
   * and left the parameter in `has-error` with `Unexpected number`, recoverable
   * only through the ✕ that deletes the expression. Marcus: *"there's something
   * strange with the spin parameter — i cant change its value."*
   */
  it('is refused when it does not parse, and the parameter is untouched', () => {
    expect(numberFieldCommit('0.41.215', field({ expressionError: failsToParse })))
      .toEqual({ kind: 'rejected', reason: 'Unexpected number' });
  });

  it('carries the parser\'s own reason, so the revert is not silent', () => {
    const outcome = numberFieldCommit('sin(', field({ expressionError: () => 'Unexpected end of input' }));
    expect(outcome).toEqual({ kind: 'rejected', reason: 'Unexpected end of input' });
  });

  /** Syntax only. An expression naming a node that does not exist yet is a
   *  legitimate thing to type, and refusing it would make the field reject
   *  valid work. */
  it('commits an expression that parses but cannot resolve yet', () => {
    expect(numberFieldCommit('ch("../notyet/size")', field()).kind).toBe('expression');
  });

  it('reverts rather than refusing where the field holds no expressions', () => {
    expect(numberFieldCommit('$T', field({ allowExpression: false })))
      .toEqual({ kind: 'revert' });
  });
});

describe('the double-commit guard', () => {
  /**
   * Enter commits and then blurs the field, and blur commits again — so every
   * typed parameter change cooked the graph twice. Measured on `cloud-volumes`:
   * the first cook was abandoned about 82 ms in, *after* encoding and uploading
   * a 1.55 MB PNG. Frame-stepping cooked once, which is what pointed at the
   * field rather than at the scheduler.
   */
  it('reports the second commit of one edit as unchanged', () => {
    expect(numberFieldCommit('42', field({ lastCommitted: '42' })))
      .toEqual({ kind: 'unchanged' });
  });

  it('lets a genuinely different value through', () => {
    expect(numberFieldCommit('43', field({ lastCommitted: '42' })).kind).toBe('value');
  });

  it('guards an expression the same way', () => {
    expect(numberFieldCommit('$T', field({ lastCommitted: '$T' })).kind).toBe('unchanged');
  });

  /** Compared as text and not as a number, deliberately: `1.20` after `1.2` is
   *  the same commit, and the guard exists to stop a duplicate cook rather
   *  than to normalise anything. */
  it('compares the trimmed text', () => {
    expect(numberFieldCommit('  42  ', field({ lastCommitted: '42' })).kind).toBe('unchanged');
  });

  /** A rejected commit is never recorded, or a corrected typo would be
   *  swallowed as a duplicate. */
  it('does not record a refusal', () => {
    const first = numberFieldCommit('0.41.215', field({ expressionError: failsToParse }));
    expect(first.kind).toBe('rejected');
    expect('text' in first).toBe(false);
  });
});

describe('an empty field', () => {
  it('reverts to the value it had', () => {
    expect(numberFieldCommit('', field())).toEqual({ kind: 'revert' });
    expect(numberFieldCommit('   ', field())).toEqual({ kind: 'revert' });
  });

  /** Only once: an empty field that was already committed empty is unchanged,
   *  which keeps blur-after-Enter quiet here too. */
  it('is unchanged when it was already empty', () => {
    expect(numberFieldCommit('', field({ lastCommitted: '' })).kind).toBe('unchanged');
  });
});
