/**
 * Expression Engine Tests
 * Tests for expression evaluation: ch(), chs(), chv(), time/frame/fps, math utilities
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ExpressionEngine } from '@/engine/expressions/ExpressionEngine';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';
import { SubnetNode } from '@/nodes/core/nodes/SubnetNode';

describe('Expression Engine', () => {
  let engine: ExpressionEngine;
  let graph: Graph;

  // Helper to extract value from evaluation result
  const evalExpr = (expr: string, node: Node) => engine.evaluate(expr, node).value;

  beforeEach(() => {
    engine = new ExpressionEngine();
    graph = new Graph();
    engine.setGraph(graph);
  });

  describe('Time variables', () => {
    it('should have default frame of 1', () => {
      expect(engine.frame).toBe(1);
    });

    it('should have default fps of 30', () => {
      expect(engine.fps).toBe(30);
    });

    it('should calculate time from frame and fps', () => {
      // $T = ($FF - 1) / $FPS, Houdini's definition: zero on the first frame,
      // so one second in is frame 31 rather than frame 30.
      engine.setFrame(31);
      engine.setFps(30);
      expect(engine.time).toBeCloseTo(1.0);
    });

    it('is zero on the first frame', () => {
      engine.setFrame(1);
      engine.setFps(30);
      expect(engine.time).toBe(0);
    });

    it('should update frame', () => {
      engine.setFrame(60);
      expect(engine.frame).toBe(60);
    });

    it('should update fps', () => {
      engine.setFps(24);
      expect(engine.fps).toBe(24);
    });

    it('should clamp frame to minimum of 1', () => {
      engine.setFrame(0);
      expect(engine.frame).toBe(1);

      engine.setFrame(-10);
      expect(engine.frame).toBe(1);
    });

    it('should clamp fps to minimum of 1', () => {
      engine.setFps(0);
      expect(engine.fps).toBe(1);
    });
  });

  describe('Expression compilation', () => {
    it('should compile simple numeric expressions', () => {
      const compiled = engine.compile('1 + 2');
      expect(compiled.source).toBe('1 + 2');
      expect(compiled.error).toBeUndefined();
    });

    it('should cache compiled expressions', () => {
      const compiled1 = engine.compile('1 + 2');
      const compiled2 = engine.compile('1 + 2');
      expect(compiled1).toBe(compiled2);
    });

    it('should compile different expressions separately', () => {
      const compiled1 = engine.compile('1 + 2');
      const compiled2 = engine.compile('3 + 4');
      expect(compiled1).not.toBe(compiled2);
    });

    it('should handle syntax errors gracefully', () => {
      const compiled = engine.compile('1 +');
      expect(compiled.error).toBeDefined();
    });
  });

  describe('Expression evaluation', () => {
    let node: Node;

    beforeEach(() => {
      node = new Node('testNode', 'Test', graph);
      graph.addElement(node);
    });

    it('should evaluate simple math', () => {
      expect(evalExpr('1 + 2 * 3', node)).toBe(7);
    });

    it('should have access to time variable', () => {
      engine.setFrame(31);
      engine.setFps(30);
      expect(evalExpr('time', node)).toBeCloseTo(1.0);
    });

    it('should have access to frame variable', () => {
      engine.setFrame(42);
      expect(evalExpr('frame', node)).toBe(42);
    });

    it('should have access to fps variable', () => {
      engine.setFps(24);
      expect(evalExpr('fps', node)).toBe(24);
    });

    it('should have access to Math object', () => {
      expect(evalExpr('Math.sin(0)', node)).toBe(0);
    });

    it('should evaluate Math.PI', () => {
      expect(evalExpr('Math.PI', node)).toBeCloseTo(Math.PI);
    });
  });

  describe('Math utility functions', () => {
    let node: Node;

    beforeEach(() => {
      node = new Node('testNode', 'Test', graph);
      graph.addElement(node);
    });

    describe('fit()', () => {
      it('should remap values from one range to another', () => {
        expect(evalExpr('fit(5, 0, 10, 0, 100)', node)).toBe(50);
      });

      it('should handle edge cases', () => {
        expect(evalExpr('fit(0, 0, 10, 0, 100)', node)).toBe(0);
        expect(evalExpr('fit(10, 0, 10, 0, 100)', node)).toBe(100);
      });

      it('should handle inverted ranges', () => {
        expect(evalExpr('fit(5, 0, 10, 100, 0)', node)).toBe(50);
      });
    });

    describe('fit01()', () => {
      it('should remap 0-1 to new range', () => {
        expect(evalExpr('fit01(0.5, 0, 100)', node)).toBe(50);
      });
    });

    describe('clamp()', () => {
      it('should clamp value to range', () => {
        expect(evalExpr('clamp(5, 0, 10)', node)).toBe(5);
        expect(evalExpr('clamp(-5, 0, 10)', node)).toBe(0);
        expect(evalExpr('clamp(15, 0, 10)', node)).toBe(10);
      });
    });

    describe('lerp()', () => {
      it('should interpolate between two values', () => {
        expect(evalExpr('lerp(0, 100, 0)', node)).toBe(0);
        expect(evalExpr('lerp(0, 100, 0.5)', node)).toBe(50);
        expect(evalExpr('lerp(0, 100, 1)', node)).toBe(100);
      });

      it('should extrapolate beyond 0-1', () => {
        expect(evalExpr('lerp(0, 100, 2)', node)).toBe(200);
        expect(evalExpr('lerp(0, 100, -1)', node)).toBe(-100);
      });
    });

    describe('smooth()', () => {
      it('should return 0 at min', () => {
        expect(evalExpr('smooth(0, 0, 1)', node)).toBe(0);
      });

      it('should return 1 at max', () => {
        expect(evalExpr('smooth(1, 0, 1)', node)).toBe(1);
      });

      it('should be smooth (S-curve) in the middle', () => {
        expect(evalExpr('smooth(0.5, 0, 1)', node)).toBeCloseTo(0.5);
      });
    });

    describe('noise()', () => {
      it('should return value between -1 and 1 for 1D noise', () => {
        const result = evalExpr('noise(0.5)', node) as number;
        expect(result).toBeGreaterThanOrEqual(-1);
        expect(result).toBeLessThanOrEqual(1);
      });

      it('should be deterministic for same input', () => {
        const result1 = evalExpr('noise(0.5)', node);
        const result2 = evalExpr('noise(0.5)', node);
        expect(result1).toBe(result2);
      });

      it('should vary with input', () => {
        const result1 = evalExpr('noise(0)', node);
        const result2 = evalExpr('noise(1000)', node);
        expect(result1).not.toBe(result2);
      });
    });

    describe('random()', () => {
      it('should return value between 0 and 1', () => {
        const result = evalExpr('random(42)', node) as number;
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(1);
      });

      it('should be deterministic for same seed', () => {
        const result1 = evalExpr('random(42)', node);
        const result2 = evalExpr('random(42)', node);
        expect(result1).toBe(result2);
      });

      it('should vary with different seeds', () => {
        const result1 = evalExpr('random(1)', node);
        const result2 = evalExpr('random(2)', node);
        expect(result1).not.toBe(result2);
      });
    });

    describe('padzero()', () => {
      it('should pad numbers with zeros', () => {
        expect(evalExpr('padzero(4, 1)', node)).toBe('0001');
        expect(evalExpr('padzero(4, 42)', node)).toBe('0042');
        expect(evalExpr('padzero(4, 1234)', node)).toBe('1234');
        expect(evalExpr('padzero(4, 12345)', node)).toBe('12345');
      });
    });
  });

  describe('Channel functions', () => {
    let subnet: SubnetNode;
    let node1: Node;
    let node2: Node;

    beforeEach(() => {
      // Create structure:
      // / (root)
      //   subnet (subnet)
      //     node1 (with value prop)
      //     node2
      subnet = new SubnetNode('subnet', graph);
      graph.addElement(subnet);

      node1 = new Node('node1', 'Test', graph);
      node1.props.value = { name: 'value', type: 'number', value: 42 };
      subnet.addChild(node1);

      node2 = new Node('node2', 'Test', graph);
      node2.props.name = { name: 'name', type: 'string', value: 'hello' };
      node2.props.color = { name: 'color', type: 'vector', value: [1, 0.5, 0.25] };
      subnet.addChild(node2);
    });

    describe('ch() - get as number', () => {
      it('should get parameter value as number', () => {
        expect(evalExpr('ch("../node1/value")', node2)).toBe(42);
      });

      it('should return 0 for non-existent paths', () => {
        expect(evalExpr('ch("../nonexistent/value")', node2)).toBe(0);
      });

      it('should convert string to number', () => {
        node1.props.value.value = '123.5';
        expect(evalExpr('ch("../node1/value")', node2)).toBe(123.5);
      });
    });

    describe('chs() - get as string', () => {
      it('should get parameter value as string', () => {
        expect(evalExpr('chs("../node2/name")', node1)).toBe('hello');
      });

      it('should convert number to string', () => {
        expect(evalExpr('chs("../node1/value")', node2)).toBe('42');
      });
    });

    describe('chv() - get as vector', () => {
      it('should get vector parameter', () => {
        expect(evalExpr('chv("../node2/color")', node1)).toEqual([1, 0.5, 0.25]);
      });

      it('should return empty array for non-existent paths', () => {
        expect(evalExpr('chv("../nonexistent/color")', node1)).toEqual([]);
      });
    });

    describe('opexist() - check node existence', () => {
      it('should return 1 for existing node', () => {
        expect(evalExpr('opexist("../node1")', node2)).toBe(1);
      });

      it('should return 0 for non-existent node', () => {
        expect(evalExpr('opexist("../nonexistent")', node2)).toBe(0);
      });
    });
  });

  describe('Dependency extraction', () => {
    it('should extract ch() dependencies', () => {
      const compiled = engine.compile('ch("../node1/value") + ch("/root/param")');
      expect(compiled.dependencies).toContain('../node1/value');
      expect(compiled.dependencies).toContain('/root/param');
    });

    it('should extract chs() dependencies', () => {
      const compiled = engine.compile('chs("./name")');
      expect(compiled.dependencies).toContain('./name');
    });

    it('should extract chv() dependencies', () => {
      const compiled = engine.compile('chv("../color")');
      expect(compiled.dependencies).toContain('../color');
    });

    it('should handle expressions without dependencies', () => {
      const compiled = engine.compile('1 + 2 * 3');
      expect(compiled.dependencies).toHaveLength(0);
    });
  });

  describe('Complex expressions', () => {
    let node: Node;

    beforeEach(() => {
      node = new Node('testNode', 'Test', graph);
      graph.addElement(node);
    });

    it('should handle compound expressions', () => {
      // A full cycle of sin(t·2π) lands back at zero after exactly one second,
      // which is frame 31 when time starts at zero on frame 1.
      engine.setFrame(31);
      engine.setFps(30);
      const result = evalExpr('Math.sin(time * Math.PI * 2)', node) as number;
      expect(result).toBeCloseTo(0, 5);
    });

    it('should handle conditional expressions', () => {
      engine.setFrame(50);
      expect(evalExpr('frame < 100 ? 1 : 0', node)).toBe(1);

      engine.setFrame(150);
      expect(evalExpr('frame < 100 ? 1 : 0', node)).toBe(0);
    });

    it('should handle nested function calls', () => {
      expect(evalExpr('clamp(lerp(0, 200, 0.75), 0, 100)', node)).toBe(100);
    });
  });

  describe('Time dependency detection', () => {
    it('should detect time references in compiled expressions', () => {
      const compiled1 = engine.compile('time * 2');
      expect(compiled1.isTimeDependent).toBe(true);

      const compiled2 = engine.compile('frame + 1');
      expect(compiled2.isTimeDependent).toBe(true);

      const compiled3 = engine.compile('fps / 2');
      expect(compiled3.isTimeDependent).toBe(true);
    });

    it('should not mark non-time expressions as time-dependent', () => {
      const compiled = engine.compile('ch("../node/value") * 2');
      expect(compiled.isTimeDependent).toBe(false);
    });

    it('should detect time in complex expressions', () => {
      const compiled = engine.compile('Math.sin(time * Math.PI * 2) * ch("./amplitude")');
      expect(compiled.isTimeDependent).toBe(true);
    });

    it('should update node isTimeDependent when setting expression', () => {
      const node = new Node('testNode', 'Test', graph);
      graph.addElement(node);
      node.props.value = { name: 'value', type: 'number', value: 0 };

      expect(node.isTimeDependent).toBe(false);

      // Set a time-dependent expression
      const parm = node.parm('value');
      parm?.setExpression('time * 10');
      expect(node.isTimeDependent).toBe(true);

      // Delete the expression
      parm?.deleteExpression();
      expect(node.isTimeDependent).toBe(false);
    });

    it('should remain time-dependent if any expression uses time', () => {
      const node = new Node('testNode', 'Test', graph);
      graph.addElement(node);
      node.props.value1 = { name: 'value1', type: 'number', value: 0 };
      node.props.value2 = { name: 'value2', type: 'number', value: 0 };

      // Set time-dependent expression on value1
      node.parm('value1')?.setExpression('time');
      expect(node.isTimeDependent).toBe(true);

      // Set non-time expression on value2
      node.parm('value2')?.setExpression('5 + 3');
      expect(node.isTimeDependent).toBe(true);

      // Delete time expression
      node.parm('value1')?.deleteExpression();
      expect(node.isTimeDependent).toBe(false);
    });
  });
});
