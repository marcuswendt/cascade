import { describe, expect, it, vi } from 'vitest';

import { Graph } from '@/nodes/Graph';

/**
 * Two cooks of the same node overlapping, with no invalidation between them.
 *
 * The fault this pins produced `stagedOutputs is not iterable` in Marcus's
 * Studio. Output staging was one instance field created per cook and nulled in
 * `finally`, while the guard protecting it — `generation ===
 * this.cookGeneration` — only advances in `invalidateCook()`. So two
 * overlapping cooks ran at the same generation, the second's `finally` nulled
 * the field, and the first resumed and iterated `null`.
 *
 * **The lost-output case is the one worth testing**, because it is the half
 * that does not throw: the second cook's `new Map()` replaced the first's
 * mid-flight, so a staged write vanished whenever the timing did not happen to
 * produce the crash. A test that only asserted "no error" would have passed
 * against the bug half the time.
 *
 * It lives in the failure path — a slow node plus a re-cook arriving in
 * flight — which is why nothing caught it: `grep stagedOutputs tests/` returned
 * nothing before this file.
 */
describe('two cooks of one node overlapping', () => {
  /** A node whose cook can be held open, so a second cook starts mid-flight. */
  function slowNode(graph: Graph) {
    const node = graph.addNode('cascade.core.Freeze', { x: 0, y: 0 });
    const port = node.out('value', 0, { type: 'float' });
    let release: (() => void) | null = null;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let started = 0;
    node.setFunction(async () => {
      started += 1;
      const mine = started;
      if (mine === 1) await held;
      port.setValue(mine * 10);
    });
    return { node, port, release: () => release?.(), started: () => started };
  }

  it('neither crashes nor loses the staged output', async () => {
    // `node.execute()` directly, not `graph.execute(node)`: the scheduler
    // coalesces a second execute of the same node, so going through it never
    // produces the overlap. An earlier version of this test did, passed, and
    // **also passed with the fix reverted** — green for a reason unrelated to
    // what it claimed. The real path is a cook arriving while one is in
    // flight, which is what a parameter dragged during a slow cook does.
    const graph = new Graph();
    const node = graph.addNode('cascade.core.Freeze', { x: 0, y: 0 });
    const port = node.out('value', 0, { type: 'float' });
    let release: (() => void) | null = null;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let started = 0;
    node.setFunction(async () => {
      const mine = ++started;
      if (mine === 1) await held;
      port.setValue(mine * 10);
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    const first = node.execute();
    await Promise.resolve();
    const second = node.execute();
    await second;
    release();
    await first;

    expect(started).toBe(2);
    // The crash was `stagedOutputs is not iterable`, thrown inside the cook and
    // logged rather than rejected, so the assertion is on what was logged.
    const logged = errors.mock.calls.map((call) => String(call[0]) + String(call[1] ?? '')).join('\n');
    expect(logged).not.toContain('is not iterable');
    expect(node.error).toBeNull();
    // And a value arrived: dropped staging leaves the port at its default,
    // which is the silent half of this fault.
    expect(port.value).not.toBe(0);
    errors.mockRestore();
  });

  /**
   * Removal by identity rather than `pop()` is deliberate and **currently
   * defensive**, which is worth writing down rather than testing badly.
   *
   * An attempt to prove it failed: two cooks finishing out of the order they
   * started needs the scheduler to run both, and it coalesces a second
   * `execute` of the same node instead — so the second never reaches its own
   * `finally` and the test hung rather than failing. So there is no reachable
   * interleaving today, and `pop()` would work.
   *
   * It stays `indexOf`/`splice` because the guarantee is cheap and the
   * alternative is a landmine for whoever changes the scheduler: this whole
   * fault existed because two mechanisms guarded one field and neither knew
   * about the other. A stack that survives out-of-order completion has one
   * fewer assumption in it.
   */
});
