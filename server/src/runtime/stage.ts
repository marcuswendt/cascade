/**
 * `cascade/stage` — call a project's Python stage from either host.
 *
 * A project's heavy work lives in Python stages, and until now every project
 * hand-rolled its own bridge to them by posting to `/api/exec`. That works in
 * Studio and fails everywhere else: `cascade run` has no server to post to and
 * no origin to resolve a relative URL against, so any graph with a Python node
 * could not be rendered offline. Each project reimplementing the same fetch
 * also meant each project reimplementing the same response unwrapping, and
 * getting it subtly wrong.
 *
 * So the bridge belongs to Cascade, with one transport per host: the page posts
 * to the server, and a headless host installs `installStageBridge` before it
 * executes the graph. A node imports `runStage` and never learns which it got.
 *
 * The counterpart for files is `cascade/io`, which keeps the same rule: a port
 * carries a project-relative path, never pixels.
 */

export interface StageCallOptions {
  /**
   * Abandons the stage. In Studio the request is withdrawn — dropped if it is
   * still queued for the worker, interrupted if it is running — and the call
   * rejects at once, so a superseded cook stops costing anything the moment it
   * is superseded rather than when the stage happens to finish.
   *
   * Optional: when it is absent the signal of the cook in flight is used (see
   * `COOK_SIGNAL_KEY`), so a node that never heard of this still cancels.
   */
  readonly signal?: AbortSignal;
}

export interface StageBridge {
  (stage: string, args: Record<string, unknown>, options?: StageCallOptions): Promise<unknown>;
}

const BRIDGE_KEY = '__cascadeStageBridge';

/**
 * Where the scheduler publishes the signal of the interactive cook in flight.
 *
 * On `globalThis` for the same reason as the bridge: every project module is
 * compiled with its own copy of this file, so module state would not be shared
 * with the scheduler that sets it. The interactive lane runs one node at a
 * time, which is what makes a single ambient value correct: a stage started
 * while node N cooks belongs to node N's cook. Read at call time, never later.
 */
export const COOK_SIGNAL_KEY = '__cascadeCookSignal';

function ambientCookSignal(): AbortSignal | undefined {
  const read = (globalThis as Record<string, unknown>)[COOK_SIGNAL_KEY];
  if (typeof read !== 'function') return undefined;
  const signal = (read as () => AbortSignal | null | undefined)();
  return signal ?? undefined;
}

/** The rejection a withdrawn stage produces, recognisable without importing a
 *  class across module copies. */
function cancelledError(stage: string, signal: AbortSignal): Error {
  const reason = signal.reason instanceof Error ? signal.reason.message : 'superseded';
  const error = new Error(`stage "${stage}" was cancelled: ${reason}`);
  error.name = 'AbortError';
  return error;
}

/**
 * Install the local transport. Called by a host that can reach the filesystem —
 * the CLI does this before running a graph. Returns a disposer so a host can
 * take it back down, which matters for tests more than for a one-shot run.
 */
export function installStageBridge(bridge: StageBridge | null): () => void {
  const globals = globalThis as Record<string, unknown>;
  const previous = globals[BRIDGE_KEY];
  globals[BRIDGE_KEY] = bridge ?? undefined;
  return () => {
    globals[BRIDGE_KEY] = previous;
  };
}

function localBridge(): StageBridge | null {
  const bridge = (globalThis as Record<string, unknown>)[BRIDGE_KEY];
  return typeof bridge === 'function' ? (bridge as StageBridge) : null;
}

let capabilityPromise: Promise<string | null> | undefined;

async function discoverCapability(): Promise<string | null> {
  capabilityPromise ??= fetch('/api/exec/capability', { cache: 'no-store' })
    .then(async (response) => {
      if (response.status === 404) {
        capabilityPromise = undefined;
        return null;
      }
      if (!response.ok) throw new Error(`Cascade exec capability is unavailable (${response.status})`);
      const token = (await response.json() as { capability?: unknown }).capability;
      if (typeof token !== 'string' || !token) {
        throw new Error('Cascade exec capability response did not contain a capability');
      }
      return token;
    })
    .catch((error) => {
      capabilityPromise = undefined;
      throw error;
    });
  return capabilityPromise;
}

async function capability(): Promise<string> {
  const token = await discoverCapability();
  if (token === null) throw new Error('Cascade exec capability is unavailable (404)');
  return token;
}

async function overHttp<T>(stage: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const postStage = async () => fetch('/api/exec', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Cascade-Exec-Capability': await capability() },
    body: JSON.stringify({ stage, args }),
    signal,
  });

  let response: Response;
  let body: { ok?: boolean; stdout?: string; stderr?: string; error?: string };
  try {
    response = await postStage();
    if (response.status === 403) {
      capabilityPromise = undefined;
      response = await postStage();
    }
    body = await response.json() as typeof body;
  } catch (error) {
    if (signal?.aborted) throw cancelledError(stage, signal);
    throw error;
  }
  if (!response.ok || !body.ok) {
    throw new Error(`stage "${stage}" failed: ${body.stderr || body.error || 'unknown error'}`);
  }
  if (typeof body.stdout !== 'string') {
    throw new Error(`stage "${stage}" returned an invalid response`);
  }
  // The dispatcher's result is the last line it printed, so a stage that logs
  // on its way through does not corrupt its own return value.
  const lastLine = body.stdout.trim().split('\n').pop() || '{}';
  return JSON.parse(lastLine) as T;
}

/** Whether this host has a local stage bridge or a browser-accessible stage
 * endpoint. A missing browser route is a supported "not available" result;
 * authorization and transport failures remain errors. */
export async function stageAvailable(): Promise<boolean> {
  if (localBridge()) return true;
  if (typeof document === 'undefined') return false;
  return (await discoverCapability()) !== null;
}

/**
 * Run a stage and return its parsed result.
 *
 * A headless host without a bridge installed gets a message that says so,
 * rather than a URL parse error from a fetch that was never going to work —
 * which is what this whole file exists to stop happening.
 */
export async function runStage<T = unknown>(
  stage: string,
  args: Record<string, unknown> = {},
  options: StageCallOptions = {},
): Promise<T> {
  const signal = options.signal ?? ambientCookSignal();
  if (signal?.aborted) throw cancelledError(stage, signal);
  const bridge = localBridge();
  if (bridge) {
    try {
      return await bridge(stage, args, signal ? { signal } : undefined) as T;
    } catch (error) {
      if (signal?.aborted) throw cancelledError(stage, signal);
      throw error;
    }
  }
  if (typeof document === 'undefined') {
    throw new Error(
      `Cannot run stage "${stage}": no host bridge is installed and there is no page to post from. ` +
      'A headless host must call installStageBridge() from cascade/stage before executing the graph.',
    );
  }
  return overHttp<T>(stage, args, signal);
}

/** A scratch path for a node's output, scoped by node id so re-running a graph
 *  does not clobber a sibling's file. */
export function cachePath(nodeId: string, suffix: string): string {
  return `.cascade-cache/${nodeId.replace(/[^a-zA-Z0-9_-]/g, '_')}${suffix}`;
}
