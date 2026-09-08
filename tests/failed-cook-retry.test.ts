/**
 * A node whose execute threw must not be cooked again until its inputs change.
 *
 * The fault this closes, measured 2026-09-08 by MW-OBSERVATORY-ART against a
 * live sketch: selecting a failing node put Studio into a permanent cook loop
 * at **9.3 errors per second** — 93 in 10 seconds, median gap 103.7 ms,
 * identical stack every time, stopping dead on deselect and restarting on
 * reselect.
 *
 * The mechanism is not the scheduler and `markDirty` is not on the path, which
 * is why an audit of every `markDirty` call site came back clean. The Viewer
 * polls its watched node from a permanent `requestAnimationFrame` loop throttled
 * to 100 ms; `requestOutput` runs a full `scheduler.flush()` whenever that node
 * is dirty; and an execute that throws never reaches `setCookState('clean')`, so
 * `isDirty` stayed true for as long as the node stayed selected. 100 ms is the
 * 10 Hz. The Viewer's overlap guard is why it held 61 fps and never looked like
 * a hang — which is the whole reason it survived this long.
 *
 * **What these tests cover and what they do not.** `viewerTick` copies the
 * condition out of `Viewer.svelte`'s `checkAndEvaluate` rather than mounting the
 * component and driving its rAF loop, so the accessor and the rule are pinned
 * and the wiring is not: an edit that dropped `hasSettledFailure` from the
 * Viewer would still pass this file. That is a real gap and the reason the
 * condition is a one-line copy — if it ever needs to be more than that, it
 * belongs on the node.
 *
 * The rule is deliberately narrower than "an errored node is never dirty". That
 * would make every failure permanent, which is wrong for anything touching the
 * network or the GPU: the same inputs may well succeed next time. Re-running an
 * execute on inputs byte-for-byte identical to the ones it just failed on is the
 * only part that cannot possibly be useful.
 */
import { describe, expect, it } from 'vitest';

import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';

/** A node that throws on every cook, counting the attempts. */
function failingNode(graph: Graph, id = 'thrower') {
  const node = new Node(id, 'test/thrower', graph);
  let attempts = 0;
  node.setFunction(() => {
    attempts += 1;
    throw new TypeError('cannot read properties of undefined');
  });
  node.in('value', 1);
  graph.addElement(node);
  return { node, attempts: () => attempts };
}

/** What the Viewer's rAF pump does on each 100 ms tick, and nothing more —
 *  the condition is copied from `checkAndEvaluate`, which is the caller the
 *  fault lives in. */
async function viewerTick(node: Node) {
  if (node.isDirty && !node.hasSettledFailure) await node.requestOutput();
}

describe('a node whose execute threw', () => {
  it('does not cook again on the next Viewer tick', async () => {
    const graph = new Graph();
    const { node, attempts } = failingNode(graph);

    await graph.execute(node);
    expect(node.cookState).toBe('error');
    expect(attempts()).toBe(1);

    // Twenty ticks is two seconds of a selected node. Before the fix this was
    // twenty more executes and twenty more input fetches.
    for (let i = 0; i < 20; i += 1) await viewerTick(node);
    expect(attempts()).toBe(1);
  });

  it('reports a settled failure while its inputs are unchanged', async () => {
    const graph = new Graph();
    const { node } = failingNode(graph);

    await graph.execute(node);
    // Still dirty — a throw never reaches `clean`, and that stays true. What
    // changes is that the Viewer's poll now has a way to tell why.
    expect(node.isDirty).toBe(true);
    expect(node.hasSettledFailure).toBe(true);
  });

  /** The reproduction case, and the reason the `hasExecuted` check cannot come
   *  first in `isDirty`: a node that throws on its very first cook never sets
   *  it, so an ordering that tested it first left the loop exactly as it was. */
  it('holds even though it never once succeeded', async () => {
    const graph = new Graph();
    const { node, attempts } = failingNode(graph);

    await graph.execute(node);
    expect((node as any).hasExecuted).toBe(false);
    for (let i = 0; i < 10; i += 1) await viewerTick(node);
    expect(attempts()).toBe(1);
  });

  it('cooks again when an input actually changes', async () => {
    const graph = new Graph();
    const { node, attempts } = failingNode(graph);

    await graph.execute(node);
    expect(attempts()).toBe(1);

    node.inputs.find(port => port.name === 'value')!.value = 2;
    expect(node.isDirty).toBe(true);
    await viewerTick(node);
    expect(attempts()).toBe(2);
  });

  /** The transient case — a fetch that timed out, a device lost. */
  it('cooks again on an explicit markDirty, with identical inputs', async () => {
    const graph = new Graph();
    const { node, attempts } = failingNode(graph);

    await graph.execute(node);
    node.markDirty();
    expect(node.hasSettledFailure).toBe(false);
    await viewerTick(node);
    expect(attempts()).toBe(2);
  });

  /**
   * And an EXPLICIT request still retries on identical inputs, which is the
   * contract `tests/cook-scheduler.test.ts` already pinned and the reason this
   * guard lives at the Viewer's poll rather than inside `isDirty`. Folding it
   * into `isDirty` closed the loop and silently made every transient failure
   * permanent; this test is what caught that.
   */
  it('still retries when its output is requested directly', async () => {
    const graph = new Graph();
    const { node, attempts } = failingNode(graph);

    await graph.execute(node);
    await node.requestOutput();
    expect(attempts()).toBe(2);
  });

  /** And a node that starts failing after cooking clean still reports the
   *  failure rather than serving the last good output as current. */
  it('keeps its error state and its last error', async () => {
    const graph = new Graph();
    const { node } = failingNode(graph);

    await graph.execute(node);
    for (let i = 0; i < 5; i += 1) await viewerTick(node);
    expect(node.cookState).toBe('error');
    expect(node.error?.message).toContain('cannot read properties');
  });
});
