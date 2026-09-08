// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { cascade } from '@/engine/cascade';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';

/**
 * Scrubbing the timeline changed a parameter and recooked nothing.
 *
 * `cascade.setGraph()` was called in exactly one place in the codebase — the
 * offline frame renderer — so in Studio the context's graph stayed null,
 * `markTimeDependentDirty()` hit its `if (!this._graph) return` and marked
 * nothing at all. The expression badge still updated, because it evaluates
 * against the node directly, which made it look as though evaluation worked
 * and only the render was stale.
 *
 * This test is the guard: with a graph bound, a parameter carrying a
 * time-referencing expression must be marked stale when the frame moves.
 */
describe('the engine context needs the graph', () => {
  it('marks a time-dependent node stale, and does nothing without a graph', () => {
    const graph = new Graph();
    const node = new Node('ripple-1', 'project.distort', graph);
    graph.addElement(node);
    node.param('amount', 0.5, { min: 0, max: 2, step: 0.01, type: 'float' });
    node.parm('amount')!.setExpression('$T * 0.5');
    expect(node.isTimeDependent).toBe(true);

    // Unbound: the call is a silent no-op, which is the bug.
    cascade.setGraph(undefined as any);
    node.setCookState('clean');
    cascade.markTimeDependentDirty();
    expect(node.cookState).toBe('clean');

    // Bound, as App.svelte now does whenever the document changes.
    cascade.setGraph(graph);
    cascade.markTimeDependentDirty();
    expect(node.cookState).toBe('stale');
  });
});
