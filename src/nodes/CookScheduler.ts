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
  private _status: CookStatus = {
    phase: 'idle',
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
    if (this.activeRun) {
      this.rerunRequested = true;
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    const total = this.graph.nodes.filter(node => node.cookState === 'stale' || node.cookState === 'queued').length;
    this.setStatus({ phase: 'scheduled', total, completed: 0, currentNode: null, startedAt: null, elapsed: 0 });
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
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.listeners.clear();
    for (const resolve of this.idleResolvers) resolve();
    this.idleResolvers.clear();
  }

  private async run(entryNode?: Node): Promise<void> {
    let restrictTo = entryNode ? this.collectDownstream(entryNode) : null;

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
      this.setStatus({
        phase: 'cooking',
        total: ordered.length,
        completed: 0,
        currentNode: null,
        startedAt,
        elapsed: 0
      });

      const blocked = new Set<string>();
      let superseded = false;
      for (const node of ordered) {
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

    this.setStatus({ phase: 'idle', total: 0, completed: 0, currentNode: null, startedAt: null, elapsed: 0 });
    for (const resolve of this.idleResolvers) resolve();
    this.idleResolvers.clear();
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
