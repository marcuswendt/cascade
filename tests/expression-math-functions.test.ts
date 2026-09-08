/**
 * Bare maths in expressions.
 *
 * `sin($FF * 0.5) * 0.5` was a red expression: the scope carried `Math` but no
 * bare `sin`, so the expression threw "sin is not defined". Houdini exposes the
 * whole maths library bare and anyone coming from it writes `sin()` first.
 *
 * The angle unit is the part worth pinning down in a test. These are RADIANS,
 * not Houdini's degrees, because `Math` is also in scope and a `sin()` that
 * disagreed with `Math.sin()` inside one expression is a worse trap than
 * needing `radians()`. `sind`/`cosd`/`tand` cover the Houdini formula.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ExpressionEngine } from '@/engine/expressions/ExpressionEngine';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';

describe('Expression maths', () => {
  let engine: ExpressionEngine;
  let node: Node;

  const evalExpr = (expr: string) => engine.evaluate(expr, node).value;
  const errorOf = (expr: string) => engine.evaluate(expr, node).error;

  beforeEach(() => {
    engine = new ExpressionEngine();
    const graph = new Graph();
    engine.setGraph(graph);
    node = new Node('probe');
  });

  it('evaluates the reported expression without error', () => {
    // The exact string from the bug report.
    engine.setFrame(41);
    engine.setFps(30);
    const result = engine.evaluate('sin($FF * 0.5) * 0.5', node);
    expect(result.error).toBeUndefined();
    expect(result.value).toBeCloseTo(Math.sin(41 * 0.5) * 0.5);
  });

  it('exposes trigonometry in radians, agreeing with Math', () => {
    expect(evalExpr('sin(1)')).toBeCloseTo(Math.sin(1));
    expect(evalExpr('cos(1)')).toBeCloseTo(Math.cos(1));
    expect(evalExpr('tan(1)')).toBeCloseTo(Math.tan(1));
    // The agreement is the point: both forms are in scope at once.
    expect(evalExpr('sin(2) - Math.sin(2)')).toBeCloseTo(0);
  });

  it('exposes the degree variants for Houdini formulae', () => {
    expect(evalExpr('sind(90)')).toBeCloseTo(1);
    expect(evalExpr('cosd(180)')).toBeCloseTo(-1);
    expect(evalExpr('radians(180)')).toBeCloseTo(Math.PI);
    expect(evalExpr('degrees(PI)')).toBeCloseTo(180);
  });

  it('exposes powers, rounding and constants', () => {
    expect(evalExpr('sqrt(16)')).toBe(4);
    expect(evalExpr('pow(2, 10)')).toBe(1024);
    expect(evalExpr('abs(-3)')).toBe(3);
    expect(evalExpr('floor(2.7)')).toBe(2);
    expect(evalExpr('ceil(2.1)')).toBe(3);
    expect(evalExpr('round(2.5)')).toBe(3);
    expect(evalExpr('min(3, 1, 2)')).toBe(1);
    expect(evalExpr('max(3, 1, 2)')).toBe(3);
    expect(evalExpr('sign(-4)')).toBe(-1);
    expect(evalExpr('PI')).toBeCloseTo(Math.PI);
    expect(evalExpr('TAU')).toBeCloseTo(Math.PI * 2);
  });

  it('keeps the existing helpers reachable', () => {
    // Regression guard: the spread must not shadow what was already there.
    expect(evalExpr('clamp(5, 0, 1)')).toBe(1);
    expect(evalExpr('lerp(0, 10, 0.5)')).toBe(5);
    expect(evalExpr('fit01(0.5, 0, 100)')).toBe(50);
    expect(typeof evalExpr('noise(1, 2)')).toBe('number');
  });

  it('still reports a genuinely unknown name as an error', () => {
    // The red badge must keep working — the fix is more names, not a
    // swallowed error.
    expect(errorOf('definitelyNotAFunction(1)')).toBeTruthy();
  });

  it('drives a time-dependent oscillation across frames', () => {
    // What he is actually trying to do: an animated parameter.
    // 40fps so a quarter cycle lands on a whole frame: $T = (11-1)/40 = 0.25,
    // and sin(0.25 * TAU) is sin(pi/2), the peak. Picking frame 16 at 30fps
    // would have landed on sin(pi) — zero, same as the start, which says
    // nothing.
    engine.setFps(40);
    engine.setFrame(1);
    const atStart = evalExpr('sin($T * TAU) * 0.5');
    engine.setFrame(11);
    const atPeak = evalExpr('sin($T * TAU) * 0.5');
    expect(atStart).toBeCloseTo(0);
    expect(atPeak).toBeCloseTo(0.5);
  });
});
