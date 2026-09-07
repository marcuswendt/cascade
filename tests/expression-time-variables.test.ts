/**
 * Houdini-style `$` time variables, their bare aliases, and fractional frames.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ExpressionEngine } from '@/engine/expressions/ExpressionEngine';
import { hasTimeReference, preprocessExpression } from '../packages/runtime/src/expressions/index.js';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';

describe('Expression time variables', () => {
  let engine: ExpressionEngine;
  let graph: Graph;
  let node: Node;

  const evalExpr = (expr: string) => engine.evaluate(expr, node).value;

  beforeEach(() => {
    engine = new ExpressionEngine();
    graph = new Graph();
    engine.setGraph(graph);
    node = new Node('testNode', 'Test', graph);
    graph.addElement(node);
    node.props.amplitude = { name: 'amplitude', type: 'number', value: 2 };
  });

  describe('$ spellings', () => {
    it('evaluates $F as the integer frame', () => {
      engine.setFps(25);
      engine.setFrame(30.7);
      expect(evalExpr('$F')).toBe(30);
    });

    it('evaluates $FF as the fractional frame', () => {
      engine.setFps(25);
      engine.setFrame(30.75);
      expect(evalExpr('$FF')).toBeCloseTo(30.75, 10);
    });

    it('evaluates $T as seconds', () => {
      // $T counts from zero on frame 1, so two seconds at 25fps is frame 51.
      engine.setFps(25);
      engine.setFrame(51);
      expect(evalExpr('$T')).toBeCloseTo(2, 10);
    });

    it('evaluates $FPS as the rate', () => {
      engine.setFps(24);
      expect(evalExpr('$FPS')).toBe(24);
    });

    it('makes sin($T) work on a parameter', () => {
      engine.setFps(30);
      engine.setTime(Math.PI / 2);
      expect(evalExpr('Math.sin($T)')).toBeCloseTo(1, 10);
    });

    it('composes $ variables with channel references', () => {
      engine.setFps(10);
      engine.setFrame(21);
      // $T = 2, amplitude = 2
      expect(evalExpr('$T * ch("./amplitude")')).toBeCloseTo(4, 10);
    });

    it('rotates a value by $T, the field-logo case', () => {
      engine.setFps(25);
      engine.setFrame(26);
      expect(evalExpr('$T * 40')).toBeCloseTo(40, 10);
    });

    it('does not confuse $FPS with $F', () => {
      engine.setFps(24);
      engine.setFrame(10);
      expect(evalExpr('$FPS - $F')).toBe(14);
    });

    it('leaves unknown $ tokens alone so they surface as an error', () => {
      const result = engine.evaluate('$NOPE + 1', node);
      expect(result.error).toBeTruthy();
      expect(result.value).toBeUndefined();
    });
  });

  describe('bare aliases', () => {
    it('keeps time, frame and fps working', () => {
      engine.setFps(25);
      engine.setFrame(50);
      expect(evalExpr('frame')).toBe(50);
      expect(evalExpr('fps')).toBe(25);
      expect(evalExpr('time')).toBeCloseTo(49 / 25, 10);
    });

    it('exposes fframe as the bare alias of $FF', () => {
      engine.setFrame(12.5);
      expect(evalExpr('fframe')).toBeCloseTo(12.5, 10);
    });

    it('agrees with the $ spellings', () => {
      engine.setFps(30);
      engine.setFrame(45.5);
      expect(evalExpr('$F - frame')).toBe(0);
      expect(evalExpr('$FF - fframe')).toBe(0);
      expect(evalExpr('$T - time')).toBe(0);
      expect(evalExpr('$FPS - fps')).toBe(0);
    });
  });

  describe('isTimeDependent detection', () => {
    const cases: Array<[string, boolean]> = [
      ['$F', true],
      ['$FF', true],
      ['$T', true],
      ['$FPS', true],
      ['Math.sin($T) * 4', true],
      ['padzero(4, $F)', true],
      ['time * 2', true],
      ['frame + 1', true],
      ['fframe * 2', true],
      ['fps / 2', true],
      ['ch("./amplitude") * 2', false],
      ['1 + 2', false]
    ];

    for (const [expression, expected] of cases) {
      it(`${expected ? 'flags' : 'does not flag'} ${expression}`, () => {
        expect(engine.compile(expression).isTimeDependent).toBe(expected);
        expect(engine.hasTimeReference(expression)).toBe(expected);
      });
    }

    it('marks a node time-dependent through a $ expression', () => {
      node.props.value = { name: 'value', type: 'number', value: 0 };
      expect(node.isTimeDependent).toBe(false);

      node.parm('value')?.setExpression('Math.sin($T)');
      expect(node.isTimeDependent).toBe(true);

      node.parm('value')?.deleteExpression();
      expect(node.isTimeDependent).toBe(false);
    });
  });

  describe('preprocessing', () => {
    it('rewrites $ tokens to context identifiers', () => {
      expect(preprocessExpression('$FF + $F + $T + $FPS')).toBe('fframe + frame + time + fps');
    });

    it('leaves expressions without $ untouched', () => {
      expect(preprocessExpression('time * 2')).toBe('time * 2');
    });

    it('does not rewrite inside string literals', () => {
      expect(preprocessExpression('chs("./$F") + $F')).toBe('chs("./$F") + frame');
    });

    it('does not rewrite longer $ identifiers', () => {
      expect(preprocessExpression('$FOO')).toBe('$FOO');
      expect(hasTimeReference('$FOO')).toBe(false);
    });
  });

  describe('fractional frames', () => {
    it('preserves the fraction through setFrame', () => {
      engine.setFrame(10.25);
      expect(engine.fframe).toBeCloseTo(10.25, 10);
      expect(engine.frame).toBe(10);
    });

    it('preserves sub-frame time through setTime', () => {
      engine.setFps(25);
      engine.setTime(1.01); // 25.25 frames past the first, so frame 26.25
      expect(engine.fframe).toBeCloseTo(26.25, 10);
      expect(engine.frame).toBe(26);
      expect(engine.time).toBeCloseTo(1.01, 10);
    });

    it('still clamps to frame 1', () => {
      engine.setFrame(0.4);
      expect(engine.fframe).toBe(1);
      expect(engine.frame).toBe(1);
    });

    it('ignores non-finite input', () => {
      engine.setFrame(12.5);
      engine.setFrame(Number.NaN);
      expect(engine.fframe).toBeCloseTo(12.5, 10);
    });
  });
});
