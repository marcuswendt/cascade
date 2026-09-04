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

export interface StageBridge {
  (stage: string, args: Record<string, unknown>): Promise<unknown>;
}

const BRIDGE_KEY = '__cascadeStageBridge';

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

let capabilityPromise: Promise<string> | undefined;

async function capability(): Promise<string> {
  capabilityPromise ??= fetch('/api/exec/capability', { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Cascade exec capability is unavailable (${response.status})`);
      return (await response.json() as { capability: string }).capability;
    })
    .catch((error) => {
      capabilityPromise = undefined;
      throw error;
    });
  return capabilityPromise;
}

async function overHttp<T>(stage: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch('/api/exec', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Cascade-Exec-Capability': await capability() },
    body: JSON.stringify({ stage, args }),
  });
  const body = await response.json() as { ok?: boolean; stdout?: string; stderr?: string; error?: string };
  if (!response.ok || !body.ok) {
    throw new Error(`stage "${stage}" failed: ${body.stderr || body.error || 'unknown error'}`);
  }
  // The dispatcher's result is the last line it printed, so a stage that logs
  // on its way through does not corrupt its own return value.
  const lastLine = String(body.stdout ?? '').trim().split('\n').pop() || '{}';
  return JSON.parse(lastLine) as T;
}

/**
 * Run a stage and return its parsed result.
 *
 * A headless host without a bridge installed gets a message that says so,
 * rather than a URL parse error from a fetch that was never going to work —
 * which is what this whole file exists to stop happening.
 */
export async function runStage<T = unknown>(stage: string, args: Record<string, unknown> = {}): Promise<T> {
  const bridge = localBridge();
  if (bridge) return await bridge(stage, args) as T;
  if (typeof document === 'undefined') {
    throw new Error(
      `Cannot run stage "${stage}": no host bridge is installed and there is no page to post from. ` +
      'A headless host must call installStageBridge() from cascade/stage before executing the graph.',
    );
  }
  return overHttp<T>(stage, args);
}

/** A scratch path for a node's output, scoped by node id so re-running a graph
 *  does not clobber a sibling's file. */
export function cachePath(nodeId: string, suffix: string): string {
  return `.cascade-cache/${nodeId.replace(/[^a-zA-Z0-9_-]/g, '_')}${suffix}`;
}
