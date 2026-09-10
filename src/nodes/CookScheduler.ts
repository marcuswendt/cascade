import type { Graph } from './Graph.js';
import type { Node } from './Node.js';

export type CookPhase = 'idle' | 'scheduled' | 'cooking';

export interface CookStatus {
  phase: CookPhase;
  total: number;
  completed: number;
  currentNode: Node | null;
  startedAt: number | null;
  elapsed: number;
  /**
   * Which pass of this run the scheduler is on, from 1.
   *
   * `run()` loops while `rerunRequested`, which is set both by a flush arriving
   * mid-run and by a node going stale during its own cook. So under sustained
   * invalidation the loop does not exit and `phase` stays `cooking`
   * indefinitely — measured 2026-09-09 by MW-OBSERVATORY-ART as a cook that sat
   * in `cooking` for over sixty seconds while the graph re-invalidated at exact
   * eight-second intervals.
   *
   * That is not a hang and there is no missing timeout: `Node.executionTimeout`
   * is 30 s and every individual node completed. It is roughly fifteen
   * successive passes, and `elapsed` resets on each one — so from the outside a
   * livelock and one slow cook produce the same reading. This is the number
   * that separates them, which is the whole reason it exists.
   */
  pass: number;
}

type CookListener = (status: Readonly<CookStatus>) => void;

/**
 * Coalesces invalidations and executes only the affected nodes. Node owns the
 * per-node state; this class owns ordering and graph-level progress.
 */
export class CookScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private activeRun: Promise<void> | null = null;
  private rerunRequested = false;
  private listeners = new Set<CookListener>();
  private idleResolvers = new Set<() => void>();
  private backgroundAbort: AbortController | null = null;
  private _status: CookStatus = {
    phase: 'idle',
    pass: 0,
    total: 0,
    completed: 0,
    currentNode: null,
    startedAt: null,
    elapsed: 0
  };

  constructor(private readonly graph: Graph, readonly debounceMs = 50) {}

  get status(): Readonly<CookStatus> {
    return this._status;
  }

  get isRunning(): boolean {
    return this.activeRun !== null;
  }

  subscribe(listener: CookListener): () => void {
    this.listeners.add(listener);
    listener(this._status);
    return () => this.listeners.delete(listener);
  }

  /** @internal Called by Node whenever its sole cook state changes. */
  notifyNodeStateChange(): void {
    this.emit();
  }

  markStale(node: Node): void {
    const visited = new Set<string>();
    const visit = (candidate: Node): void => {
      if (visited.has(candidate.id)) return;
      visited.add(candidate.id);
      if (candidate.cookState !== 'stale') candidate.invalidateCook();
      for (const output of candidate.outputs) {
        for (const connection of output.connections) {
          const downstream = this.graph.getNode(connection.to.nodeId);
          if (downstream) visit(downstream);
        }
      }
    };
    visit(node);

    // Nodes can become dirty while their constructors are still declaring
    // ports. Do not start graph work until the node has actually been added.
    if (this.graph.getNode(node.id) === node) this.schedule();
  }

  markDownstreamStale(node: Node): void {
    for (const output of node.outputs) {
      for (const connection of output.connections) {
        const downstream = this.graph.getNode(connection.to.nodeId);
        if (downstream) this.markStale(downstream);
      }
    }
  }

  schedule(): void {
    // Interactive work arriving is the whole reason the background lane can be
    // preempted, and it is preempted here rather than when the run starts:
    // between `schedule` and the debounce firing there is a whole 50 ms in
    // which a background render would otherwise keep the CPU.
    this.preemptBackground('interactive work arrived');
    if (this.activeRun) {
      this.rerunRequested = true;
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    const total = this.graph.nodes.filter(node => node.cookState === 'stale' || node.cookState === 'queued').length;
    this.setStatus({ phase: 'scheduled', total, completed: 0, currentNode: null, pass: 0, startedAt: null, elapsed: 0 });
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flushScheduled();
    }, this.debounceMs);
  }

  async flush(entryNode?: Node): Promise<void> {
    await this.flushInternal(entryNode, true);
  }

  private async flushScheduled(): Promise<void> {
    await this.flushInternal(undefined, false);
  }

  private async flushInternal(entryNode: Node | undefined, retryErrors: boolean): Promise<void> {
    this.preemptBackground('interactive work arrived');
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (retryErrors) this.prepareErrorRetry(entryNode);
    if (this.activeRun) {
      this.rerunRequested = true;
      await this.activeRun;
      return;
    }

    this.activeRun = this.run(entryNode).finally(() => {
      this.activeRun = null;
    });
    await this.activeRun;
  }

  /** Explicit execution retries failed nodes once; debounced invalidation does not. */
  private prepareErrorRetry(entryNode?: Node): void {
    const allowed = entryNode ? this.collectDownstream(entryNode) : null;
    for (const node of this.graph.nodes) {
      if (node.cookState === 'error' && (!allowed || allowed.has(node.id))) {
        node.invalidateCook();
      }
    }
  }

  async whenIdle(): Promise<void> {
    if (!this.activeRun && !this.timer) return;
    await new Promise<void>(resolve => this.idleResolvers.add(resolve));
  }

  dispose(): void {
    this.preemptBackground('the graph went away');
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.listeners.clear();
    for (const resolve of this.idleResolvers) resolve();
    this.idleResolvers.clear();
  }

  private async run(entryNode?: Node): Promise<void> {
    let restrictTo = entryNode ? this.collectDownstream(entryNode) : null;
    let pass = 0;

    do {
      this.rerunRequested = false;
      const stale = this.graph.nodes.filter(node =>
        (node.cookState === 'stale' || node.cookState === 'queued') &&
        (!restrictTo || restrictTo.has(node.id))
      );
      restrictTo = null;

      if (stale.length === 0) break;
      const staleIds = new Set(stale.map(node => node.id));
      const ordered = this.graph.getTopologicalOrder()
        .map(id => this.graph.getNode(id))
        .filter((node): node is Node => !!node && staleIds.has(node.id));
      const orderedIds = new Set(ordered.map(node => node.id));
      for (const node of stale) if (!orderedIds.has(node.id)) ordered.push(node);

      for (const node of ordered) node.setCookState('queued');
      const startedAt = performance.now();
      pass += 1;
      this.setStatus({
        phase: 'cooking',
        total: ordered.length,
        completed: 0,
        currentNode: null,
        pass,
        startedAt,
        elapsed: 0
      });

      const blocked = new Set<string>();
      /**
       * Nodes a loaded file wires an input to, whose edge has not bound yet.
       *
       * Read once per pass rather than per node: it shrinks as ports appear,
       * and a node that becomes ready mid-pass is picked up by the next one —
       * which is already how this loop handles everything else.
       */
      const notReady = this.graph.pendingConnectionTargets();
      let superseded = false;
      for (const node of ordered) {
        /**
         * An input that is about to be connected is not an input that is
         * missing, and cooking it anyway is what produced permanent false
         * errors in the log — a node throwing its own "nothing wired to my
         * image input" during the load warm-up, then succeeding on a later
         * pass while the log kept the throw forever.
         *
         * Skipped as *blocked* rather than errored, so everything downstream
         * waits with it instead of each node discovering the same missing
         * input for itself.
         */
        if (notReady.has(node.id)) {
          node.setCookState('stale');
          blocked.add(node.id);
          this.setStatus({
            ...this._status,
            completed: this._status.completed + 1,
            currentNode: null,
            elapsed: performance.now() - startedAt
          });
          continue;
        }
        const upstreamBlocked = node.inputs.some(input => input.connections.some(connection =>
          staleIds.has(connection.from.nodeId) &&
          (blocked.has(connection.from.nodeId) || this.graph.getNode(connection.from.nodeId)?.cookState === 'error')
        ));
        if (upstreamBlocked) {
          node.setCookState('stale');
          blocked.add(node.id);
          this.setStatus({
            ...this._status,
            completed: this._status.completed + 1,
            currentNode: null,
            elapsed: performance.now() - startedAt
          });
          continue;
        }

        node.setCookState('cooking');
        this.setStatus({ ...this._status, currentNode: node, elapsed: performance.now() - startedAt });
        await node.execute();
        if (node.cookState === 'error') blocked.add(node.id);
        if (node.cookState === 'stale') {
          blocked.add(node.id);
          superseded = true;
        }
        this.setStatus({
          ...this._status,
          completed: this._status.completed + 1,
          currentNode: null,
          elapsed: performance.now() - startedAt
        });
      }
      if (superseded) this.rerunRequested = true;
    } while (this.rerunRequested);

    this.setStatus({ phase: 'idle', total: 0, completed: 0, currentNode: null, pass: 0, startedAt: null, elapsed: 0 });
    for (const resolve of this.idleResolvers) resolve();
    this.idleResolvers.clear();
  }

  // ============ The background lane ============

  /**
   * Work that must never delay the thing being looked at.
   *
   * Marcus's rule for an auto-updating series, 2026-09-09: *"i want the series
   * to auto-update ... however the single live node has priority."* That cannot
   * be expressed in the interactive queue, which is one FIFO with no priority
   * in it — measured by MW-OBSERVATORY-ART as 91 of 91 downstream cooks queued
   * behind their upstream with zero overlap and nothing ever superseded. A
   * series auto-updating through that queue would sit in front of the next
   * edit: twelve instances at ~220 ms each is 2.6 seconds between Marcus and
   * the slider he is dragging.
   *
   * So background is a second lane with three properties, and all three are
   * load-bearing:
   *
   *   - it **starts only when the graph is quiet** — `phase === 'idle'` plus a
   *     settling interval, because otherwise a drag becomes a chain of
   *     started-and-cancelled passes, which is worse than not starting;
   *   - it is **abandoned the moment interactive work arrives**, at `schedule`
   *     rather than at the run, so the debounce window is not spent on it;
   *   - it is abandoned **through a signal the work can see**, so an expensive
   *     task can bail before committing rather than after. That is the fault
   *     this lane exists to avoid rather than relocate: an abandoned cook on
   *     `cloud-volumes` had already encoded and uploaded a 1.55 MB PNG before
   *     anything noticed it was superseded.
   *
   * **The trap for whoever builds the first client.** Mutating the graph from
   * inside a background task — which is what applying a parameter set does —
   * reaches `markStale`, and `markStale` calls `schedule`, which preempts the
   * background lane. A task that invalidates the graph therefore cancels
   * itself. The way out is to drive nodes directly rather than through the
   * interactive queue, not to weaken the preemption; the preemption is the
   * only thing making the lane honest.
   */
  async runBackground(
    task: (signal: AbortSignal) => Promise<void>,
    options: { readonly settleMs?: number } = {},
  ): Promise<'completed' | 'preempted'> {
    this.preemptBackground('superseded by a newer background task');
    await this.whenSettled(options.settleMs ?? this.debounceMs * 4);

    const abort = new AbortController();
    this.backgroundAbort = abort;
    try {
      await task(abort.signal);
      return abort.signal.aborted ? 'preempted' : 'completed';
    } finally {
      if (this.backgroundAbort === abort) this.backgroundAbort = null;
    }
  }

  /** Whether background work is in flight. Distinct from `isRunning`, which is
   *  the interactive lane — a panel showing one as the other would report the
   *  series as though Marcus's own edit were still cooking. */
  get isRunningBackground(): boolean {
    return this.backgroundAbort !== null;
  }

  /** @internal Abandon the background lane. Public so a client can stand down
   *  without waiting for an invalidation to do it. */
  preemptBackground(reason: string): void {
    const abort = this.backgroundAbort;
    if (!abort) return;
    this.backgroundAbort = null;
    if (!abort.signal.aborted) abort.abort(new Error(reason));
  }

  /**
   * Resolve once the graph has been idle for `settleMs` without interruption.
   *
   * Deliberately not `whenIdle()` plus a timer: `whenIdle` resolves the instant
   * the queue drains, and a drag drains it between every keystroke. The
   * settling interval is what turns *momentarily idle* into *finished*, and it
   * restarts whenever work reappears — so under sustained invalidation this
   * never resolves, which is correct. Background work has no business starting
   * while the graph is still moving.
   */
  private whenSettled(settleMs: number): Promise<void> {
    return new Promise<void>(resolve => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const stop = this.subscribe(status => {
        if (status.phase === 'idle') {
          if (timer === null) {
            timer = setTimeout(() => {
              stop();
              resolve();
            }, settleMs);
          }
          return;
        }
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
      });
    });
  }

  private collectDownstream(entryNode: Node): Set<string> {
    const result = new Set<string>();
    const visit = (node: Node): void => {
      if (result.has(node.id)) return;
      result.add(node.id);
      for (const output of node.outputs) {
        for (const connection of output.connections) {
          const downstream = this.graph.getNode(connection.to.nodeId);
          if (downstream) visit(downstream);
        }
      }
    };
    visit(entryNode);
    return result;
  }

  private setStatus(status: CookStatus): void {
    this._status = Object.freeze(status);
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this._status);
  }
}
