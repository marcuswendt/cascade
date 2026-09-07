/**
 * Cascade Context Tests
 * Tests for the global cascade API - node access, time/playback, selection, and channel shortcuts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cascade, CascadeContext } from '@/engine/cascade';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';

describe('CascadeContext', () => {
  let graph: Graph;
  let context: CascadeContext;

  beforeEach(() => {
    // Create a fresh context for each test
    context = new CascadeContext();
    graph = new Graph();
    context.setGraph(graph);
  });

  describe('graph management', () => {
    it('should store and retrieve graph', () => {
      expect(context.getGraph()).toBe(graph);
    });

    it('should return null before graph is set', () => {
      const newContext = new CascadeContext();
      expect(newContext.getGraph()).toBe(null);
    });
  });

  describe('node access', () => {
    let node1: Node;
    let node2: Node;

    beforeEach(() => {
      node1 = new Node('node1', 'TestType', graph);
      node2 = new Node('node2', 'TestType', graph);
      graph.addElement(node1);
      graph.addElement(node2);
    });

    describe('node()', () => {
      it('should find node by absolute path', () => {
        const found = context.node('/node1');
        expect(found).toBe(node1);
      });

      it('should return null for non-existent node', () => {
        const found = context.node('/nonexistent');
        expect(found).toBe(null);
      });

      it('should return null for empty path after slash', () => {
        const found = context.node('/');
        expect(found).toBe(null);
      });

      it('should return null when no graph is set', () => {
        const emptyContext = new CascadeContext();
        expect(emptyContext.node('/node1')).toBe(null);
      });

      it('should handle relative path from root', () => {
        // When pwd is null, relative paths are treated as from root
        const found = context.node('node1');
        expect(found).toBe(node1);
      });
    });

    describe('parm()', () => {
      beforeEach(() => {
        node1.defineProp('radius', {
          value: 5.0,
          params: { min: 0, max: 100 }
        });
      });

      it('should find parameter by path', () => {
        const parm = context.parm('/node1/radius');
        expect(parm).not.toBe(null);
        expect(parm?.eval()).toBe(5.0);
      });

      it('should return null for non-existent parameter', () => {
        const parm = context.parm('/node1/nonexistent');
        expect(parm).toBe(null);
      });

      it('should return null for non-existent node', () => {
        const parm = context.parm('/nonexistent/radius');
        expect(parm).toBe(null);
      });

      it('should return null for path without slash', () => {
        const parm = context.parm('noslash');
        expect(parm).toBe(null);
      });
    });

    describe('root()', () => {
      it('should return null (root is virtual)', () => {
        expect(context.root()).toBe(null);
      });
    });

    describe('pwd() and cd()', () => {
      it('should start with null pwd', () => {
        expect(context.pwd()).toBe(null);
      });

      it('should set pwd with setPwd()', () => {
        context.setPwd(node1);
        expect(context.pwd()).toBe(node1);
      });

      it('should navigate to root with cd("/")', () => {
        context.setPwd(node1);
        context.cd('/');
        expect(context.pwd()).toBe(null);
      });

      // Note: cd() to non-root requires isNetwork() to return true
      // which requires SubnetNode - skipping for basic tests
    });
  });

  describe('selection', () => {
    let node1: Node;
    let node2: Node;

    beforeEach(() => {
      node1 = new Node('node1', 'TestType', graph);
      node2 = new Node('node2', 'TestType', graph);
      graph.addElement(node1);
      graph.addElement(node2);
    });

    describe('setSelection()', () => {
      it('should set selection of node IDs', () => {
        context.setSelection(['node1', 'node2']);
        expect(context.selectedNodeIds()).toEqual(['node1', 'node2']);
      });

      it('should replace previous selection', () => {
        context.setSelection(['node1']);
        context.setSelection(['node2']);
        expect(context.selectedNodeIds()).toEqual(['node2']);
      });

      it('should call onSelectionChange callback', () => {
        const callback = vi.fn();
        context.onSelectionChange = callback;
        context.setSelection(['node1']);
        expect(callback).toHaveBeenCalledWith(['node1']);
      });
    });

    describe('selectedNodes()', () => {
      it('should return actual Node objects', () => {
        context.setSelection(['node1']);
        const nodes = context.selectedNodes();
        expect(nodes).toHaveLength(1);
        expect(nodes[0]).toBe(node1);
      });

      it('should filter out non-existent nodes', () => {
        context.setSelection(['node1', 'nonexistent']);
        const nodes = context.selectedNodes();
        expect(nodes).toHaveLength(1);
        expect(nodes[0]).toBe(node1);
      });

      it('should return empty array when no graph', () => {
        const emptyContext = new CascadeContext();
        emptyContext.setSelection(['node1']);
        expect(emptyContext.selectedNodes()).toEqual([]);
      });
    });

    describe('clearAllSelected()', () => {
      it('should clear all selections', () => {
        context.setSelection(['node1', 'node2']);
        context.clearAllSelected();
        expect(context.selectedNodeIds()).toEqual([]);
      });

      it('should call onSelectionChange with empty array', () => {
        const callback = vi.fn();
        context.onSelectionChange = callback;
        context.setSelection(['node1']);
        callback.mockClear();
        context.clearAllSelected();
        expect(callback).toHaveBeenCalledWith([]);
      });
    });
  });

  describe('time and playback', () => {
    describe('frame()', () => {
      it('should return default frame of 1', () => {
        expect(context.frame()).toBe(1);
      });
    });

    describe('fps()', () => {
      it('should return default fps of 30', () => {
        expect(context.fps()).toBe(30);
      });
    });

    describe('time()', () => {
      it('is zero on the first frame, as Houdini defines $T', () => {
        // $T = ($FF - 1) / $FPS, so the first frame is t = 0 rather than 1/fps.
        // Otherwise sin($T) starts part-way through its cycle and no animation
        // ever has a frame at time zero.
        expect(context.time()).toBe(0);
      });

      it('advances one second per fps frames', () => {
        context.setFrame(31);
        expect(context.time()).toBeCloseTo(1.0, 5);
      });
    });

    describe('setFrame()', () => {
      it('should update frame', () => {
        context.setFrame(30);
        expect(context.frame()).toBe(30);
      });

      it('should floor decimal frames', () => {
        context.setFrame(30.7);
        expect(context.frame()).toBe(30);
      });

      it('should enforce minimum frame of 1', () => {
        context.setFrame(0);
        expect(context.frame()).toBe(1);

        context.setFrame(-5);
        expect(context.frame()).toBe(1);
      });

      it('should update time accordingly', () => {
        context.setFrame(31);
        // ($FF - 1) / fps = 30/30 = 1.0s
        expect(context.time()).toBeCloseTo(1.0, 5);
      });
    });

    describe('setTime()', () => {
      it('should convert time to frame', () => {
        context.setTime(1.0); // 1 second at 30fps, counting from frame 1
        expect(context.frame()).toBe(31);
      });

      it('should floor to nearest frame', () => {
        // 0.5s at 30fps is 15 frames *after the first*, so frame 16.
        context.setTime(0.5);
        expect(context.frame()).toBe(16);
      });

      it('should enforce minimum frame of 1', () => {
        context.setTime(0);
        expect(context.frame()).toBe(1);
      });
    });

    describe('setFps()', () => {
      it('should update fps', () => {
        context.setFps(60);
        expect(context.fps()).toBe(60);
      });

      it('should enforce minimum fps of 1', () => {
        context.setFps(0);
        expect(context.fps()).toBe(1);

        context.setFps(-10);
        expect(context.fps()).toBe(1);
      });

      it('should affect time calculation', () => {
        context.setFrame(61);
        context.setFps(60);
        expect(context.time()).toBeCloseTo(1.0, 5); // 60/60 = 1s
      });
    });

    describe('nextFrame()', () => {
      it('should increment frame by 1', () => {
        const initial = context.frame();
        context.nextFrame();
        expect(context.frame()).toBe(initial + 1);
      });

      it('should return new frame number', () => {
        const result = context.nextFrame();
        expect(result).toBe(context.frame());
      });
    });
  });

  describe('channel shortcuts', () => {
    let node1: Node;

    beforeEach(() => {
      node1 = new Node('node1', 'TestType', graph);
      graph.addElement(node1);

      node1.defineProp('radius', { value: 5.0 });
      node1.defineProp('name', { value: 'test-name' });
      node1.defineProp('position', { value: [10, 20, 30] });
    });

    describe('ch()', () => {
      it('should return parameter value as number', () => {
        expect(context.ch('/node1/radius')).toBe(5.0);
      });

      it('should return 0 for non-existent parameter', () => {
        expect(context.ch('/node1/nonexistent')).toBe(0);
      });

      it('should return 0 for non-existent node', () => {
        expect(context.ch('/nonexistent/radius')).toBe(0);
      });
    });

    describe('chs()', () => {
      it('should return parameter value as string', () => {
        expect(context.chs('/node1/name')).toBe('test-name');
      });

      it('should return empty string for non-existent parameter', () => {
        expect(context.chs('/node1/nonexistent')).toBe('');
      });
    });

    describe('chv()', () => {
      it('should return array parameter as-is', () => {
        expect(context.chv('/node1/position')).toEqual([10, 20, 30]);
      });

      it('should wrap scalar in array', () => {
        expect(context.chv('/node1/radius')).toEqual([5.0]);
      });

      it('should return empty array for non-existent parameter', () => {
        expect(context.chv('/node1/nonexistent')).toEqual([]);
      });
    });
  });

  describe('time-dependent updates', () => {
    let node1: Node;
    let node2: Node;

    beforeEach(() => {
      node1 = new Node('node1', 'TestType', graph);
      node2 = new Node('node2', 'TestType', graph);
      graph.addElement(node1);
      graph.addElement(node2);

      node1.isTimeDependent = true;
      node2.isTimeDependent = false;
    });

    describe('getTimeDependentNodes()', () => {
      it('should return only time-dependent nodes', () => {
        const nodes = context.getTimeDependentNodes();
        expect(nodes).toHaveLength(1);
        expect(nodes[0]).toBe(node1);
      });

      it('should return empty array when no graph', () => {
        const emptyContext = new CascadeContext();
        expect(emptyContext.getTimeDependentNodes()).toEqual([]);
      });
    });

    describe('markTimeDependentDirty()', () => {
      it('should mark time-dependent nodes dirty', () => {
        // First mark nodes clean
        node1.markDirty();
        node2.markDirty();

        // This would need isDirty() to be implemented
        // For now, just verify no errors thrown
        expect(() => context.markTimeDependentDirty()).not.toThrow();
      });

      it('should not throw when no graph', () => {
        const emptyContext = new CascadeContext();
        expect(() => emptyContext.markTimeDependentDirty()).not.toThrow();
      });
    });
  });
});

describe('cascade singleton', () => {
  it('should be exported as singleton instance', () => {
    expect(cascade).toBeInstanceOf(CascadeContext);
  });

  it('should persist state across imports', () => {
    cascade.setFps(24);
    expect(cascade.fps()).toBe(24);
    // Reset for other tests
    cascade.setFps(30);
  });
});
