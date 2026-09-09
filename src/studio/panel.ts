/** Metadata Cascade can discover without importing trusted project code. */
export interface ProjectPanelMeta {
  name: string;
  title: string;
  icon: string | null;
  rendererTypes?: string[];
}

export interface ProjectPanelApi {
  runStage<T = unknown>(stage: string, args: Record<string, unknown>): Promise<T>;
  /** `version` busts a cache when a re-render reuses a path. It existed in
   *  core and not in this type, so a panel could not reach it. */
  mediaUrl(path: string, options?: { width?: number; raw?: boolean; version?: string | number }): string;
  /**
   * A parameter's RESOLVED value — a keyframe channel first, then an
   * expression, then the stored value. What the node's `execute` sees.
   *
   * Which means it is **not** the inverse of `setParam` when the parameter
   * carries a binding. Use `getRawParam` to read back a write.
   */
  getParam<T = unknown>(nodeId: string, name: string): T | undefined;
  /**
   * A parameter's STORED value, before a channel or an expression resolves it.
   *
   * This is what `setParam` writes, so it is the one to read back after a
   * write. Added 2026-09-09: a panel that wrote a value and re-read it with
   * `getParam` got the resolved value, concluded its write had failed, and
   * re-rendered a whole series at the parameter it had just replaced. Nothing
   * threw and nothing logged.
   */
  getRawParam<T = unknown>(nodeId: string, name: string): T | undefined;
  /**
   * Write a parameter's stored value.
   *
   * Clears a *declared default* expression, because a default expression is a
   * default and the written value wins. **Throws when a channel or an
   * author-written expression would shadow the write**, naming which — those
   * legitimately win, and silently storing a value nobody will ever read is
   * how a panel comes to believe a parameter is broken. Clear the binding
   * first if the write is meant to take effect.
   */
  setParam(nodeId: string, name: string, value: unknown): void;
  /**
   * A node's output value, read-only.
   *
   * Added 2026-09-09, and it is the one whose absence distorted a whole
   * sketch. A panel could set parameters and not read results, so the series
   * panel reached its own outputs through **two extra nodes and a stage**: a
   * node whose only purpose was to write a value to disk, and a Python stage
   * that cooked a graph so the panel could fetch it back. Both delete with
   * this. A panel that can write and not read is half a surface.
   *
   * A snapshot rather than a live handle, and read-only on purpose: a panel
   * that could mutate an output would be writing into the middle of the
   * dependency graph, where nothing downstream would know.
   */
  getOutput<T = unknown>(nodeId: string, outputName: string): T | undefined;
  /** Every output of a node, by name. For a panel that does not know the
   *  shape of what it is looking at. */
  getOutputs(nodeId: string): Readonly<Record<string, unknown>>;
  /**
   * Cook the graph, or one node's subtree, and resolve when it settles.
   *
   * A panel could ignore work through `api.signal` and could not start or stop
   * any, so `PLAN series`' cancellable queue was not implementable from a panel
   * at all.
   *
   * **There is deliberately no `background` option**, and finding out why cost
   * an hour: cooking *the graph* in the background is incoherent, because the
   * graph has one state. A background cook either merges with interactive work
   * or fights it — and concretely, routing one through `scheduler.flush` made
   * it cancel itself, since `flush` preempts the background lane by design.
   * Measured, not reasoned: every such call returned `'preempted'`.
   *
   * The background lane is for cooking a *different parameter set*, which means
   * driving nodes directly rather than through the shared queue. That belongs
   * to the series mechanism rather than to a panel, and a panel will reach it
   * through the series API instead.
   */
  cook(options?: { readonly nodeId?: string }): Promise<void>;
  selectedNodeId(): string | null;
  readonly sourceNodeId: string | null;
  readonly signal: AbortSignal;
  close(): void;
}

export interface ProjectValueRendererProps {
  value: unknown;
  readOnly: boolean;
  mode: 'compact' | 'inspect' | 'view';
  onChange: ((value: unknown) => void) | null;
}

export interface ProjectValueRendererInstance {
  update?(props: ProjectValueRendererProps): void;
  dispose(): void;
}

export interface ProjectValueRenderer {
  mount(element: HTMLElement, props: ProjectValueRendererProps):
    | void
    | (() => void)
    | ProjectValueRendererInstance
    | Promise<void | (() => void) | ProjectValueRendererInstance>;
}

export interface ProjectPanelModule {
  title?: string;
  icon?: string;
  mount(element: HTMLElement, api: ProjectPanelApi):
    | void
    | (() => void)
    | Promise<void | (() => void)>;
  renderers?: Record<string, ProjectValueRenderer>;
}
