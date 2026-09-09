/**
 * The background lane: work that must never delay the thing being looked at.
 *
 * Marcus's rule for an auto-updating series, 2026-09-09: *"i want the series to
 * auto-update ... however the single live node has priority."* MW-OBSERVATORY-
 * ART then measured why that cannot live in the interactive queue — 91 of 91
 * downstream cooks queued behind their upstream, zero overlap, nothing ever
 * superseded. One FIFO with no priority in it. A series auto-updating through
 * it would sit in front of the next edit, putting ~2.6 seconds between Marcus
 * and the slider he is dragging.
 *
 * Three properties, each tested here because each has a way of being quietly
 * absent: it starts only when the graph has settled, it is abandoned the moment
 * interactive work arrives, and it is abandoned **through a signal the work can
 * see** — which is the difference between preempting a cost and relocating it.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';

const tick = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * A latch, so a test can wait for the task to actually be running rather than
 * guessing at the settling delay.
 *
 * Both preemption tests were written with a `tick` long enough to "obviously"
 * cover the settle, and both failed: adding a node schedules a cook, so the
 * settle does not even begin until the debounce has fired and the graph has
 * drained. Invalidating before the task starts preempts nothing, which is
 * correct behaviour and a wrong test.
 */
function latch() {
  let open = () => {};
  const opened = new Promise<void>(resolve => { open = resolve; });
  return { opened, open: () => open() };
}

describe('the background lane', () => {
  let graph: Graph;

  beforeEach(() => {
    graph = new Graph();
  });

  it('runs once the graph has settled', async () => {
    let ran = false;
    const result = await graph.scheduler.runBackground(async () => { ran = true; }, { settleMs: 10 });

    expect(ran).toBe(true);
    expect(result).toBe('completed');
  });

  /** A drag drains the queue between every keystroke, so *momentarily idle* is
   *  not *finished*. The settling interval is what tells them apart, and it
   *  restarts whenever work reappears. */
  it('waits for quiet rather than for the queue to be momentarily empty', async () => {
    const node = new Node('subject', 'Test', graph);
    graph.addElement(node);
    node.setFunction(() => {});

    let ran = false;
    const running = graph.scheduler.runBackground(async () => { ran = true; }, { settleMs: 60 });

    // Keep invalidating inside the settling window, the way a drag does.
    for (let i = 0; i < 4; i += 1) {
      node.markDirty();
      await tick(20);
    }
    expect(ran).toBe(false);

    await running;
    expect(ran).toBe(true);
  });

  /**
   * The property the lane exists for. Interactive work arriving must abandon
   * background work **through a signal**, so a task with an expensive step can
   * bail before committing to it — an abandoned cook on `cloud-volumes` had
   * already encoded and uploaded a 1.55 MB PNG before anything noticed it was
   * superseded.
   */
  it('aborts the task signal when interactive work arrives', async () => {
    const node = new Node('subject', 'Test', graph);
    graph.addElement(node);
    node.setFunction(() => {});

    const started = latch();
    let sawAbort = false;
    let reachedExpensiveStep = false;
    const running = graph.scheduler.runBackground(async signal => {
      started.open();
      // The shape a real client has: cheap work, a cancellation point, then
      // the expensive part.
      await tick(30);
      if (signal.aborted) {
        sawAbort = true;
        return;
      }
      reachedExpensiveStep = true;
    }, { settleMs: 10 });

    await started.opened;
    node.markDirty();
    const outcome = await running;

    expect(sawAbort).toBe(true);
    expect(reachedExpensiveStep).toBe(false);
    expect(outcome).toBe('preempted');
  });

  /** Preempted at `schedule` rather than when the run starts: between the two
   *  sits the whole debounce window, which a background render would otherwise
   *  spend. */
  it('is preempted before the debounce has even fired', async () => {
    const node = new Node('subject', 'Test', graph);
    graph.addElement(node);
    node.setFunction(() => {});

    const started = latch();
    let abortedWhileSchedulerIdle = false;
    const running = graph.scheduler.runBackground(async signal => {
      started.open();
      // Read immediately after the invalidation and before the debounce has
      // fired: the interactive run has been scheduled and has not begun.
      await tick(0);
      abortedWhileSchedulerIdle = signal.aborted && !graph.scheduler.isRunning;
    }, { settleMs: 10 });

    await started.opened;
    node.markDirty();
    await running;

    expect(abortedWhileSchedulerIdle).toBe(true);
  });

  it('reports whether background work is in flight, separately from interactive', async () => {
    expect(graph.scheduler.isRunningBackground).toBe(false);

    let insideLane = false;
    let insideInteractive = true;
    const running = graph.scheduler.runBackground(async () => {
      insideLane = graph.scheduler.isRunningBackground;
      insideInteractive = graph.scheduler.isRunning;
    }, { settleMs: 10 });

    await running;
    expect(insideLane).toBe(true);
    // A panel showing one as the other would report the series as though
    // Marcus's own edit were still cooking.
    expect(insideInteractive).toBe(false);
    expect(graph.scheduler.isRunningBackground).toBe(false);
  });

  it('supersedes an earlier background task with a later one', async () => {
    const started = latch();
    let firstAborted = false;
    const first = graph.scheduler.runBackground(async signal => {
      started.open();
      await tick(40);
      firstAborted = signal.aborted;
    }, { settleMs: 5 });

    await started.opened;
    const second = graph.scheduler.runBackground(async () => {}, { settleMs: 5 });

    await Promise.all([first, second]);
    expect(firstAborted).toBe(true);
  });

  it('abandons background work when the graph is disposed', async () => {
    const started = latch();
    let aborted = false;
    const running = graph.scheduler.runBackground(async signal => {
      started.open();
      await tick(30);
      aborted = signal.aborted;
    }, { settleMs: 5 });

    await started.opened;
    graph.scheduler.dispose();
    await running;

    expect(aborted).toBe(true);
  });
});

/**
 * A node's `context.signal` is real.
 *
 * Studio handed every node `new AbortController().signal` and never aborted it,
 * so `context.signal` was inert — a node that checked it could not be
 * cancelled, and every long node ran to completion whether or not its result
 * was still wanted. The generation check in `execute` then threw the result
 * away, which is the expensive half in the wrong order.
 */
describe('a cook signal', () => {
  let graph: Graph;

  beforeEach(() => {
    graph = new Graph();
  });

  it('is absent outside a cook and present inside one', async () => {
    const node = new Node('subject', 'Test', graph);
    graph.addElement(node);
    expect(node.cookSignal).toBeNull();

    let insideCook: AbortSignal | null = null;
    node.setFunction(() => { insideCook = node.cookSignal; });
    await graph.execute(node);

    expect(insideCook).not.toBeNull();
    expect(insideCook!.aborted).toBe(false);
    expect(node.cookSignal).toBeNull();
  });

  it('aborts when the node is invalidated mid-cook', async () => {
    const node = new Node('subject', 'Test', graph);
    graph.addElement(node);

    // Once, deliberately. Invalidating on every cook is the livelock in
    // `CookStatus.pass` — `execute` sees the node went stale, the scheduler
    // sets `rerunRequested`, and the run never drains. Writing this test
    // without the guard hung the suite, which is a fair demonstration.
    let invalidated = false;
    let abortedDuringCook = false;
    node.setFunction(async () => {
      const signal = node.cookSignal!;
      if (invalidated) return;
      invalidated = true;
      node.invalidateCook();
      abortedDuringCook = signal.aborted;
    });

    await graph.execute(node);
    expect(abortedDuringCook).toBe(true);
  });

  /** Cancelled without being marked stale: a preempted instance is not dirty,
   *  it is unfinished, and marking it stale would put it straight back into the
   *  queue it was just taken out of. */
  it('aborts on cancelCook without making the node stale', async () => {
    const node = new Node('subject', 'Test', graph);
    graph.addElement(node);

    let aborted = false;
    let stateDuringCancel = '';
    node.setFunction(async () => {
      const signal = node.cookSignal!;
      node.cancelCook('preempted');
      aborted = signal.aborted;
      stateDuringCancel = node.cookState;
    });

    await graph.execute(node);
    expect(aborted).toBe(true);
    expect(stateDuringCancel).toBe('cooking');
  });
});

/**
 * The trap, as a test rather than as a comment.
 *
 * `runBackground`'s doc comment has warned since it was written that mutating
 * the graph from inside a background task reaches `markStale`, which preempts
 * the lane — so a task that invalidates the graph cancels itself. **The comment
 * did not stop its own author walking into it within the hour**, adding a
 * `background` option to the panel API's `cook()` that routed through
 * `scheduler.flush` and therefore returned `'preempted'` on every call.
 *
 * MW-OBSERVATORY-ART's read of that is the reason this exists: the comment did
 * not prevent the mistake, but it made the failure recognisable instantly
 * instead of a debugging session — and **where a trap is mechanically
 * checkable, it should be a test.** This is that. It asserts the trap rather
 * than a fix, so it will fail if the preemption is ever weakened, which is the
 * change that would make the surrounding design quietly wrong.
 */
describe('the self-cancellation trap', () => {
  let graph: Graph;

  beforeEach(() => {
    graph = new Graph();
  });

  it('a background task that flushes the interactive queue cancels itself', async () => {
    const node = new Node('subject', 'Test', graph);
    graph.addElement(node);
    node.setFunction(() => {});
    await graph.execute(node);

    let abortedAfterFlush = false;
    const outcome = await graph.scheduler.runBackground(async signal => {
      await graph.scheduler.flush();
      abortedAfterFlush = signal.aborted;
    }, { settleMs: 10 });

    expect(abortedAfterFlush).toBe(true);
    expect(outcome).toBe('preempted');
  });

  /** And through `markDirty`, which is the same route by a different door and
   *  the one a series client would actually take: applying a parameter set
   *  invalidates the graph. */
  it('a background task that invalidates a node cancels itself', async () => {
    const node = new Node('subject', 'Test', graph);
    graph.addElement(node);
    node.setFunction(() => {});
    await graph.execute(node);

    let aborted = false;
    await graph.scheduler.runBackground(async signal => {
      node.markDirty();
      aborted = signal.aborted;
    }, { settleMs: 10 });

    expect(aborted).toBe(true);
  });
});
