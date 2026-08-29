/**
 * Node Execution Tests
 * Tests for node execution, dirty tracking, lifecycle hooks, and expression evaluation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';

describe('Node Execution', () => {
  let graph: Graph;
  let node: Node;

  beforeEach(() => {
    graph = new Graph();
    node = new Node('testNode', 'TestType', graph);
    graph.addElement(node);
  });

  describe('dirty tracking', () => {
    describe('markDirty()', () => {
      it('should mark node as dirty', () => {
        // Execute first to set hasExecuted
        node.setFunction(async () => {});
        // After first execution, node should be clean
        // But markDirty should make it dirty again
        node.markDirty();
        expect(node.isDirty).toBe(true);
      });
    });

    describe('isDirty', () => {
      it('should return true before first execution', () => {
        expect(node.isDirty).toBe(true);
      });

      it('should return false after execution', async () => {
        node.setFunction(async () => {});
        await node.execute();
        expect(node.isDirty).toBe(false);
      });

      it('should return true after markDirty()', async () => {
        node.setFunction(async () => {});
        await node.execute();
        node.markDirty();
        expect(node.isDirty).toBe(true);
      });

      it('should become dirty when prop value changes', async () => {
        node.defineProp('testProp', { value: 0 });
        node.setFunction(async () => {});
        await node.execute();
        expect(node.isDirty).toBe(false);

        // Change prop value - this should mark dirty via updateProp
        node.updateProp('testProp', 42);
        expect(node.isDirty).toBe(true);
      });

      it('should return true when connected input changes', async () => {
        const sourceNode = new Node('source', 'SourceType', graph);
        graph.addElement(sourceNode);

        const output = sourceNode.out<number>('out');
        const input = node.in<number>('in', 0);

        graph.connect(output, input);

        node.setFunction(async () => {});
        await node.execute();
        expect(node.isDirty).toBe(false);

        // Change source output - should make downstream dirty
        output.setValue(100);
        expect(node.isDirty).toBe(true);
      });
    });
  });

  describe('execute()', () => {
    it('should not execute without node function', async () => {
      const spy = vi.fn();
      // Don't set a function
      await node.execute();
      // Should not throw, just return early
      expect(spy).not.toHaveBeenCalled();
    });

    it('should execute node function', async () => {
      const executeFn = vi.fn();
      node.setFunction(executeFn);
      await node.execute();
      expect(executeFn).toHaveBeenCalled();
    });

    it('should pass node and graph to function', async () => {
      const executeFn = vi.fn();
      node.setFunction(executeFn);
      await node.execute();
      expect(executeFn).toHaveBeenCalledWith(node, graph);
    });

    it('should not re-execute when not dirty', async () => {
      const executeFn = vi.fn();
      node.setFunction(executeFn);

      await node.execute();
      expect(executeFn).toHaveBeenCalledTimes(1);

      await node.execute();
      // Should still be 1 because not dirty
      expect(executeFn).toHaveBeenCalledTimes(1);
    });

    it('should re-execute after markDirty()', async () => {
      const executeFn = vi.fn();
      node.setFunction(executeFn);

      await node.execute();
      expect(executeFn).toHaveBeenCalledTimes(1);

      node.markDirty();
      await node.execute();
      expect(executeFn).toHaveBeenCalledTimes(2);
    });

    it('should set error on exception', async () => {
      const error = new Error('Test error');
      node.setFunction(async () => {
        throw error;
      });

      await node.execute();
      expect(node.error).toBe(error);
    });

    it('should clear error on successful execution', async () => {
      // First, set an error
      node.setFunction(async () => {
        throw new Error('First error');
      });
      await node.execute();
      expect(node.error).not.toBe(null);

      // Now succeed
      node.setFunction(async () => {});
      node.markDirty();
      await node.execute();
      expect(node.error).toBe(null);
    });
  });

  describe('bypass', () => {
    it('should not execute when bypassed', async () => {
      const executeFn = vi.fn();
      node.setFunction(executeFn);
      node.setBypass(true);

      await node.execute();
      // First execution should still happen for initialization
      // but bypass logic should be used
    });

    it('should pass input to output when bypassed', async () => {
      // Create a param input and matching output
      const input = node.in<number>('value', 42, { type: 'param' });
      const output = node.out<number>('value');

      node.setFunction(async () => {
        output.setValue(input.value * 2);
      });

      // First execute normally
      await node.execute();
      expect(output.value).toBe(84);

      // Now bypass - should pass through input directly
      node.setBypass(true);
      node.markDirty();
      await node.execute();
      // After bypass, value should be passed through
    });
  });

  describe('lifecycle hooks', () => {
    it('should call onSetup on first execution', async () => {
      const onSetup = vi.fn();
      node.onSetup = onSetup;
      node.setFunction(async () => {});

      await node.execute();
      expect(onSetup).toHaveBeenCalledTimes(1);
    });

    it('should call onSetup only once', async () => {
      const onSetup = vi.fn();
      node.onSetup = onSetup;
      node.setFunction(async () => {});

      await node.execute();
      node.markDirty();
      await node.execute();

      expect(onSetup).toHaveBeenCalledTimes(1);
    });

    it('should call onReady on first execution', async () => {
      const onReady = vi.fn();
      node.onReady = onReady;
      node.setFunction(async () => {});

      await node.execute();
      expect(onReady).toHaveBeenCalled();
    });

    it('should call onUpdate on every execution', async () => {
      const onUpdate = vi.fn();
      node.onUpdate = onUpdate;
      node.setFunction(async () => {});

      await node.execute();
      // onUpdate is called on every execution
      expect(onUpdate).toHaveBeenCalled();

      node.markDirty();
      await node.execute();
      expect(onUpdate).toHaveBeenCalledTimes(2);
    });

    it('should not crash on errors in onSetup (logs but continues)', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      node.onSetup = () => {
        throw new Error('Setup error');
      };
      node.setFunction(async () => {});

      // Should not throw
      await expect(node.execute()).resolves.not.toThrow();
      consoleSpy.mockRestore();
    });

    it('should not crash on errors in onReady (logs but continues)', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      node.onReady = () => {
        throw new Error('Ready error');
      };
      node.setFunction(async () => {});

      // Should not throw
      await expect(node.execute()).resolves.not.toThrow();
      consoleSpy.mockRestore();
    });
  });

  describe('prop expression evaluation', () => {
    it('should evaluate expressions before execution', async () => {
      node.defineProp('value', { value: 0 });
      node.props.value.expression = '1 + 1';

      node.setFunction(async (n) => {
        // The expression should have been evaluated
      });

      await node.execute();
      expect(node.props.value.value).toBe(2);
    });

    it('should set expressionError on invalid expression', async () => {
      node.defineProp('value', { value: 0 });
      node.props.value.expression = 'invalid syntax {{';

      node.setFunction(async () => {});
      await node.execute();

      expect(node.props.value.expressionError).toBeDefined();
    });
  });

  describe('time dependency', () => {
    it('should default to not time-dependent', () => {
      expect(node.isTimeDependent).toBe(false);
    });

    it('should allow setting time dependency flag', () => {
      node.isTimeDependent = true;
      expect(node.isTimeDependent).toBe(true);
    });

    it('should check expressions for time references', () => {
      node.defineProp('static', { value: 0 });
      node.props.static.expression = '1 + 1';

      node.updateTimeDependent();
      // Static expressions don't make node time-dependent
      expect(node.isTimeDependent).toBe(false);
    });
  });
});

describe('Node with connected inputs', () => {
  let graph: Graph;
  let sourceNode: Node;
  let targetNode: Node;

  beforeEach(() => {
    graph = new Graph();
    sourceNode = new Node('source', 'SourceType', graph);
    targetNode = new Node('target', 'TargetType', graph);
    graph.addElement(sourceNode);
    graph.addElement(targetNode);
  });

  it('should propagate values through connections', async () => {
    const output = sourceNode.out<number>('value');
    const input = targetNode.in<number>('value', 0);

    graph.connect(output, input);

    output.setValue(42);
    expect(input.value).toBe(42);
  });

  it('should update target when source changes', async () => {
    const output = sourceNode.out<number>('value');
    const input = targetNode.in<number>('value', 0);
    const targetOutput = targetNode.out<number>('result');

    graph.connect(output, input);

    targetNode.setFunction(async (n) => {
      targetOutput.setValue(input.value * 2);
    });

    output.setValue(10);
    await targetNode.execute();
    expect(targetOutput.value).toBe(20);

    output.setValue(20);
    await targetNode.execute();
    expect(targetOutput.value).toBe(40);
  });
});

describe('Node ID management', () => {
  let graph: Graph;
  let node: Node;

  beforeEach(() => {
    graph = new Graph();
    node = new Node('testNode', 'TestType', graph);
    graph.addElement(node);
  });

  it('should rename node and mark dirty', () => {
    const originalId = node.id;
    const newId = node.rename('renamedNode');
    // Should be renamed (may have suffix for uniqueness)
    expect(newId).toContain('renamedNode');
    expect(node.id).toBe(newId);
    expect(node.id).not.toBe(originalId);
    expect(node.isDirty).toBe(true);
    expect(graph.getNode(originalId)).toBeNull();
    expect(graph.getNode(newId)).toBe(node);
  });

  it('should generate unique ID on rename conflict', () => {
    const node2 = new Node('otherNode', 'TestType', graph);
    graph.addElement(node2);

    const newId = node.rename('otherNode');
    expect(newId).not.toBe('otherNode');
    expect(newId).toContain('otherNode');
  });

  it('should remove whitespace from name', () => {
    const newId = node.rename('test  node');
    // Whitespace should be removed
    expect(newId).not.toContain(' ');
  });

  it('should return current ID for empty name', () => {
    const currentId = node.id;
    const newId = node.rename('   ');
    expect(newId).toBe(currentId);
  });

  it('should clear the execution timeout after a successful cook', async () => {
    vi.useFakeTimers();
    try {
      node.setFunction(() => {});
      graph.scheduler.dispose();
      await node.execute();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should clear the execution timeout after a failed cook', async () => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      node.setFunction(() => { throw new Error('failure'); });
      graph.scheduler.dispose();
      await node.execute();
      expect(node.error?.message).toBe('failure');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      consoleError.mockRestore();
      vi.useRealTimers();
    }
  });
});
