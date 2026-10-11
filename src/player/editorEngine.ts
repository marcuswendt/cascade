/**
 * The graph behind an exported editor, as a small asynchronous interface.
 *
 * Two implementations: `LocalEngine` cooks on the calling thread, and
 * `createWorkerEngine` talks to the same engine running in a module worker
 * (`serveEditorEngine`). The editor uses the worker, so a stage that computes
 * for most of a second never freezes a slider: the page stays responsive and
 * the next cook simply takes the latest values.
 *
 * Values cross the boundary by structured clone. Images stay in the engine's
 * asset store and are fetched as bytes when the page shows or saves them.
 */
import type { AssetRef, CascadeDocument, ImageRef } from '../../packages/contracts/src/index.js';
import { createBrowserRuntimeHost } from '../../packages/runtime/src/browser.js';
import { createRuntime, PREFLIGHT_WARNING_CODES } from '../../packages/runtime/src/runtime.js';
import type { DefinitionNodeRegistration, LoadedCascadeGraph, RunOptions } from '../../packages/runtime/src/types.js';
import { installIoBridge } from '../../server/src/runtime/io.js';
import { createBrowserGpuHost } from '../browser/gpu.js';
import { cleanupAll } from './app.js';
import { PlayerAssetStore } from './assets.js';

export interface EngineNode {
  readonly id: string;
  readonly moduleId: string;
  readonly parent?: string;
  readonly props: Readonly<Record<string, { readonly type: string; readonly value: unknown }>>;
}

export interface EngineRun {
  readonly status: 'completed' | 'cancelled' | 'failed';
  readonly messages: readonly string[];
}

export interface EditorEngine {
  nodes(): Promise<readonly EngineNode[]>;
  setProps(writes: readonly (readonly [node: string, prop: string, value: unknown])[]): Promise<void>;
  run(options?: Pick<RunOptions, 'target' | 'reuse'>): Promise<EngineRun>;
  output(node: string, port: string): Promise<unknown>;
  /** Every node's outputs, for the inspect view. */
  outputs(): Promise<ReadonlyMap<string, ReadonlyMap<string, unknown>>>;
  writeAsset(bytes: Uint8Array, metadata: { mediaType?: string; suggestedName?: string }): Promise<AssetRef>;
  readAsset(ref: AssetRef | ImageRef): Promise<Uint8Array>;
  dispose(): Promise<void>;
}

export interface EngineOptions {
  readonly document: CascadeDocument;
  readonly registrations: readonly DefinitionNodeRegistration[];
  /** Packaged asset path to deployment URL. Resolved against the page, never fetched elsewhere. */
  readonly assets: Readonly<Record<string, string>>;
}

const never = { aborted: false, reason: undefined, addEventListener() {}, removeEventListener() {} } as never;

/** The engine on this thread. */
export class LocalEngine implements EditorEngine {
  private constructor(
    private readonly graph: LoadedCascadeGraph,
    private readonly store: PlayerAssetStore,
    private readonly release: () => Promise<void>,
  ) {}

  static async create(options: EngineOptions): Promise<LocalEngine> {
    const store = new PlayerAssetStore(options.assets);
    const disposeIo = installIoBridge(store);
    const gpu = createBrowserGpuHost();
    const registrations = new Map(options.registrations.map((item) => [item.moduleId, item]));
    const runtime = createRuntime({
      host: createBrowserRuntimeHost({
        modules: { resolve: async (moduleId) => registrations.get(moduleId) ?? null },
        assets: store,
        ...(gpu ? { gpu } : {}),
      }),
      nodes: options.registrations,
    });
    const release = () => cleanupAll([() => runtime.dispose(), () => gpu?.dispose(), () => disposeIo(), () => store.dispose()]);
    try {
      const graph = await runtime.load(options.document);
      const blocking = graph.preflight().find((item) => !PREFLIGHT_WARNING_CODES.has(item.code));
      if (blocking) throw new Error(blocking.message);
      return new LocalEngine(graph, store, async () => { await graph.dispose(); await release(); });
    } catch (error) {
      await release().catch(() => {});
      throw error;
    }
  }

  async nodes(): Promise<readonly EngineNode[]> {
    return this.graph.inspect().nodes.map((node) => ({
      id: node.id,
      moduleId: node.moduleId,
      ...(node.parent ? { parent: node.parent } : {}),
      props: Object.fromEntries(Object.entries(node.props).map(([name, prop]) => [name, { type: prop.type, value: prop.value }])),
    }));
  }

  async setProps(writes: readonly (readonly [string, string, unknown])[]): Promise<void> {
    for (const [node, prop, value] of writes) await this.graph.setProp(node, prop, value);
  }

  async run(options: Pick<RunOptions, 'target' | 'reuse'> = {}): Promise<EngineRun> {
    const result = await this.graph.run(options);
    this.collect();
    return { status: result.status, messages: result.diagnostics.map((item) => item.message) };
  }

  async output(node: string, port: string): Promise<unknown> {
    return this.graph.getOutput(node, port);
  }

  async outputs(): Promise<ReadonlyMap<string, ReadonlyMap<string, unknown>>> {
    return new Map(this.graph.inspect().nodes.map((node) => [node.id, new Map(this.graph.getOutputs(node.id))]));
  }

  writeAsset(bytes: Uint8Array, metadata: { mediaType?: string; suggestedName?: string }): Promise<AssetRef> {
    return this.store.write(bytes, metadata, { signal: never });
  }

  readAsset(ref: AssetRef | ImageRef): Promise<Uint8Array> {
    return this.store.read(ref, { signal: never });
  }

  dispose(): Promise<void> {
    return this.release();
  }

  /** Drop generated assets nothing reaches any more: not a prop, not an output. */
  private collect(): void {
    const roots: unknown[] = [];
    for (const node of this.graph.inspect().nodes) {
      roots.push(...Object.values(node.props).map((prop) => prop.value));
      roots.push(...this.graph.getOutputs(node.id).values());
    }
    try { this.store.collect(roots); } catch { /* best effort */ }
  }
}

type Method = 'nodes' | 'setProps' | 'run' | 'output' | 'outputs' | 'writeAsset' | 'readAsset' | 'dispose';
interface Request { readonly id: number; readonly method: Method | 'init'; readonly args: readonly unknown[] }
interface Response { readonly id: number; readonly ok: boolean; readonly value?: unknown; readonly error?: string }

/**
 * Run the engine in this worker. The export generates the worker entry: it
 * imports the project's node code and calls this with the registrations.
 */
export function serveEditorEngine(registrations: readonly DefinitionNodeRegistration[]): void {
  const scope = globalThis as unknown as {
    onmessage: ((event: MessageEvent<Request>) => void) | null;
    postMessage(message: Response, transfer?: Transferable[]): void;
  };
  let engine: Promise<LocalEngine> | undefined;
  scope.onmessage = async (event) => {
    const { id, method, args } = event.data;
    try {
      if (method === 'init') {
        const [document, assets] = args as [CascadeDocument, Record<string, string>];
        engine = LocalEngine.create({ document, registrations, assets });
        await engine;
        scope.postMessage({ id, ok: true });
        return;
      }
      if (!engine) throw new Error('Editor engine is not initialised');
      const target = await engine;
      const value = await (target[method] as (...input: unknown[]) => Promise<unknown>).apply(target, [...args]);
      const transfer = value instanceof Uint8Array ? [value.buffer as ArrayBuffer] : [];
      try {
        scope.postMessage({ id, ok: true, value }, transfer);
      } catch (error) {
        // A value the structured clone cannot carry (a function, a handle): describe it instead.
        scope.postMessage({ id, ok: true, value: describeUncloneable(value, error) });
      }
    } catch (error) {
      scope.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
}

/** An engine in a module worker, created from the export's worker script. */
export async function createWorkerEngine(url: URL, options: Omit<EngineOptions, 'registrations'>): Promise<EditorEngine> {
  const worker = new Worker(url, { type: 'module', name: 'cascade-editor-engine' });
  let sequence = 0;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  worker.onmessage = (event: MessageEvent<Response>) => {
    const entry = pending.get(event.data.id);
    if (!entry) return;
    pending.delete(event.data.id);
    if (event.data.ok) entry.resolve(event.data.value);
    else entry.reject(new Error(event.data.error));
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || 'Editor engine worker failed');
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };
  const call = <T>(method: Request['method'], ...args: unknown[]): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      worker.postMessage({ id, method, args } satisfies Request);
    });
  // Deployment URLs are absolute, so the worker resolves them exactly as the page would.
  const assets = Object.fromEntries(Object.entries(options.assets).map(([name, href]) => [name, new URL(href, location.href).href]));
  await call('init', options.document, assets);
  return {
    nodes: () => call('nodes'),
    setProps: (writes) => call('setProps', writes),
    run: (runOptions = {}) => call('run', runOptions),
    output: (node, port) => call('output', node, port),
    outputs: () => call('outputs'),
    writeAsset: (bytes, metadata) => call('writeAsset', bytes, metadata),
    readAsset: (ref) => call('readAsset', ref),
    async dispose() {
      try { await call('dispose'); } finally { worker.terminate(); }
    },
  };
}

function describeUncloneable(value: unknown, error: unknown): string {
  const kind = value === null ? 'null' : typeof value === 'object' ? (value as object).constructor?.name ?? 'object' : typeof value;
  return `(${kind} cannot be shown here: ${error instanceof Error ? error.message : String(error)})`;
}
