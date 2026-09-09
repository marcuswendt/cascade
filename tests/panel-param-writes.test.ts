/**
 * A panel's write and a panel's read must be the same value.
 *
 * The fault, found by MW-OBSERVATORY-ART building the series panel on
 * 2026-09-09: it wrote a series-wide prop with `setParam`, re-read it
 * immediately with `getParam`, got the **old** value, concluded the write had
 * failed, and re-rendered every instance at the parameter it had just replaced
 * — identical cache keys, identical PNGs, and a panel that looked like it was
 * ignoring the edit. Nothing threw and nothing logged.
 *
 * The cause is a precedence asymmetry rather than a lost write. `setParam`
 * writes the **stored** value; `parameter.value` reads the **resolved** one —
 * channel first, then expression, then stored. So a write beneath a binding
 * lands and is then shadowed, and the caller cannot tell that from a failure.
 *
 * Two different bindings, two different answers, and the distinction is the
 * whole fix: a **declared default** expression is a default, so a written value
 * clears it and wins. An expression the **author** wrote legitimately wins, so
 * the write is refused with a sentence rather than stored where nobody will
 * read it.
 */
import { describe, expect, it } from 'vitest';

import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';
import { createProjectPanelApi } from '@/editor/projectPanels';

function subject(paramOptions: Record<string, unknown> = { type: 'float' }) {
  const graph = new Graph();
  const node = new Node('subject', 'Test', graph);
  graph.addElement(node);
  node.param('gain', 1, paramOptions as never);
  const read = () => node.parameters.find(p => p.name === 'gain')!.value;
  return { graph, node, read };
}

describe('a write to a plain parameter', () => {
  it('reads back as itself', () => {
    const { node, read } = subject();
    node.setParameter('gain', 7);
    expect(read()).toBe(7);
    expect(node.rawParameterValue('gain')).toBe(7);
  });

  it('is not shadowed', () => {
    const { node } = subject();
    expect(node.parameterWriteShadowedBy('gain')).toBeNull();
  });
});

describe('a write over a declared default expression', () => {
  /**
   * The measured case. Writing 42 over `defaultExpression: '2 * 5'` stored 42
   * and read back 10 — the write was there and invisible. The rule this now
   * follows is the one the rest of the system already states: *a default
   * expression is a default, and the author's number wins.* `deleteExpression`
   * and the document restore both implement it; this did not.
   */
  it('clears the default and reads back as itself', () => {
    const { node, read } = subject({ type: 'float', defaultExpression: '2 * 5' });
    // The default applied, so it starts at the expression's value.
    expect(read()).toBe(10);

    node.setParameter('gain', 42);
    expect(read()).toBe(42);
    expect(node.props.gain.expression).toBeUndefined();
  });

  it('shadows nothing, because the write removes the binding', () => {
    const { node } = subject({ type: 'float', defaultExpression: '2 * 5' });
    expect(node.parameterWriteShadowedBy('gain')).toBeNull();
  });

  /** And the default does not come back on the next declaration, which is what
   *  `plainPropOverrides` is for — `param()` re-declares on every cook of a
   *  dynamic node. */
  it('does not reinstate the default when the parameter is re-declared', () => {
    const { node, read } = subject({ type: 'float', defaultExpression: '2 * 5' });
    node.setParameter('gain', 42);
    node.param('gain', 1, { type: 'float', defaultExpression: '2 * 5' } as never);
    expect(read()).toBe(42);
  });
});

describe('a write under an expression the author wrote', () => {
  /** Refused rather than stored: it legitimately loses to the expression, and
   *  storing a value nobody will read is how a panel comes to believe a
   *  parameter is broken. */
  it('is reported as shadowed by the expression', () => {
    const { node } = subject();
    node.parm('gain')!.setExpression('3 + 4');
    expect(node.parameterWriteShadowedBy('gain')).toBe('expression');
  });

  it('leaves the expression alone if written anyway', () => {
    const { node, read } = subject();
    node.parm('gain')!.setExpression('3 + 4');
    node.setParameter('gain', 99);
    // The expression still wins — this is correct precedence, and the reason
    // the write has to be refused at the API rather than fixed here.
    expect(read()).toBe(7);
    expect(node.rawParameterValue('gain')).toBe(99);
  });
});

describe('a write under a keyframe channel', () => {
  it('is reported as shadowed by the channel', () => {
    const { node } = subject();
    node.restorePropChannel('gain', { keys: [{ frame: 1, value: 5 }] } as never);
    expect(node.parameterWriteShadowedBy('gain')).toBe('channel');
  });

  /** A channel outranks an expression, so it is named first — a caller told to
   *  clear the expression would clear it and still not see its write. */
  it('is named ahead of an expression when both are present', () => {
    const { node } = subject();
    node.parm('gain')!.setExpression('3 + 4');
    node.restorePropChannel('gain', { keys: [{ frame: 1, value: 5 }] } as never);
    expect(node.parameterWriteShadowedBy('gain')).toBe('channel');
  });
});

/**
 * What a panel can read, and the shape of the hole it filled.
 *
 * MW-OBSERVATORY-ART's first finding from building the series panel, and the
 * one whose absence distorted the whole sketch: **a panel could set parameters
 * and not read results.** So the panel reached its own outputs through two
 * extra nodes and a Python stage — a node whose only purpose was to write a
 * value to disk, and a stage that cooked a graph so the panel could fetch it
 * back. A surface that can write and not read is half a surface.
 */
describe('the panel API', () => {
  function panel() {
    const graph = new Graph();
    const node = new Node('subject', 'Test', graph);
    graph.addElement(node);
    node.param('gain', 1, { type: 'float' });
    node.out('result');
    node.out('count');
    node.setFunction(() => {
      node.outputs.find(p => p.name === 'result')!.setValue(node.evalParm('gain') * 2);
      node.outputs.find(p => p.name === 'count')!.setValue(3);
    });
    const api = createProjectPanelApi({
      context: () => ({ graph, selectedNode: null, onRecordHistory: undefined }) as never,
      close: () => {},
    });
    return { graph, node, api };
  }

  it('reads a node output', async () => {
    const { graph, node, api } = panel();
    await graph.execute(node);
    expect(api.getOutput('subject', 'result')).toBe(2);
  });

  it('reads every output of a node, for a panel that does not know the shape', async () => {
    const { graph, node, api } = panel();
    await graph.execute(node);
    expect(api.getOutputs('subject')).toEqual({ result: 2, count: 3 });
  });

  it('returns undefined for an output that does not exist rather than throwing', () => {
    const { api } = panel();
    expect(api.getOutput('subject', 'nope')).toBeUndefined();
    expect(api.getOutputs('nowhere')).toEqual({});
  });

  it('cooks the graph and resolves once it has settled', async () => {
    const { node, api } = panel();
    api.setParam('subject', 'gain', 21);
    await api.cook();
    expect(api.getOutput('subject', 'result')).toBe(42);
    expect(node.cookState).toBe('clean');
  });

  it('names an unknown node rather than cooking nothing', async () => {
    const { api } = panel();
    await expect(api.cook({ nodeId: 'missing' })).rejects.toThrow(/Unknown node missing/);
  });

  /** The read-back that started all of this: `getParam` is resolved and
   *  `getRawParam` is stored, and only the second is the inverse of a write. */
  it('reads back a write through getRawParam', () => {
    const { node, api } = panel();
    node.parm('gain')!.setExpression('3 + 4');

    expect(api.getParam('subject', 'gain')).toBe(7);
    expect(api.getRawParam('subject', 'gain')).toBe(1);
  });

  /** And a write that would be shadowed is refused with a sentence naming the
   *  binding, rather than stored where nothing will read it. */
  it('refuses a write that a binding would shadow', () => {
    const { node, api } = panel();
    node.parm('gain')!.setExpression('3 + 4');

    expect(() => api.setParam('subject', 'gain', 99))
      .toThrow(/driven by an? expression, so writing its value would have no effect/);
  });
});

/**
 * A write that changes nothing must not cook the graph.
 *
 * MW-OBSERVATORY-ART, after wiring the series panel to the new API: the panel
 * re-writes its filter on every load, and `setParameter` marked the node dirty
 * whether or not the value changed — so **mounting the panel cooked the whole
 * document to arrive at values it already held.** Every panel that restores
 * state on mount hits this, and each would otherwise write the same guard.
 */
describe('a write that changes nothing', () => {
  function counted() {
    const graph = new Graph();
    const node = new Node('subject', 'Test', graph);
    graph.addElement(node);
    node.param('gain', 1, { type: 'float' });
    node.param('range', [0, 1], { type: 'vec2' } as never);
    let cooks = 0;
    node.setFunction(() => { cooks += 1; });
    return { graph, node, cooks: () => cooks };
  }

  it('does not mark the node dirty', async () => {
    const { graph, node, cooks } = counted();
    await graph.execute(node);
    expect(cooks()).toBe(1);

    node.setParameter('gain', 1);
    expect(node.isDirty).toBe(false);
    await graph.scheduler.flush();
    expect(cooks()).toBe(1);
  });

  it('still cooks when the value actually changes', async () => {
    const { graph, node, cooks } = counted();
    await graph.execute(node);

    node.setParameter('gain', 2);
    await graph.scheduler.flush();
    expect(cooks()).toBe(2);
  });

  /** The case this exists for: a panel hands back a copy of the array it just
   *  read, and `===` would call that a change. */
  it('compares an array structurally rather than by reference', async () => {
    const { graph, node, cooks } = counted();
    await graph.execute(node);

    node.setParameter('range', [0, 1]);
    expect(node.isDirty).toBe(false);
    node.setParameter('range', [0, 2]);
    expect(node.isDirty).toBe(true);
    await graph.scheduler.flush();
    expect(cooks()).toBe(2);
  });

  /**
   * A bound prop is never skipped. Writing over a declared default expression
   * clears it, which changes the resolved value even when the stored one
   * matches — skipping that would leave the parameter animating after the
   * author had set a number.
   */
  it('is not a no-op when the write clears a default expression', async () => {
    const graph = new Graph();
    const node = new Node('subject', 'Test', graph);
    graph.addElement(node);
    node.param('gain', 5, { type: 'float', defaultExpression: '5' } as never);
    await graph.execute(node);

    // The stored value and the written value agree, and the write still has
    // work to do: the expression has to go.
    node.setParameter('gain', 5);
    expect(node.props.gain.expression).toBeUndefined();
    expect(node.parameters.find(p => p.name === 'gain')!.value).toBe(5);
  });

  it('treats two NaNs as the same stored value', async () => {
    const { graph, node, cooks } = counted();
    node.setParameter('gain', Number.NaN);
    await graph.execute(node);
    const before = cooks();

    node.setParameter('gain', Number.NaN);
    expect(node.isDirty).toBe(false);
    await graph.scheduler.flush();
    expect(cooks()).toBe(before);
  });
});
