/**
 * Where each node module's work happens — server (the Python/exec bridge) or
 * browser (WebGL, canvas, plain JS in the page).
 *
 * The two are peers, not tiers: they exchange images as project-relative paths,
 * which the browser reads back through /api/media. But which side a node runs
 * on changes what it costs and what it can reach, so it should be visible on
 * the node rather than something you infer from reading its source.
 *
 * The server decides the answer (declared `runsOn`, else inferred from whether
 * the module calls the exec bridge); this just caches the map for the UI.
 */
import { writable } from 'svelte/store';

export type RunsOn = 'portable' | 'server' | 'browser';

export const runsOnByModule = writable<Record<string, RunsOn>>({});

/** Icon name per node module, declared by the module itself. Empty when a
 *  module doesn't name one, which leaves Cascade's own default in place. */
export const iconByModule = writable<Record<string, string>>({});
export const projectNodeModules = writable<string[]>([]);

let inFlight: Promise<void> | null = null;

/** Fetch the map once per session. Safe to call from anywhere; concurrent
 * callers share the one request, and a failure leaves the map empty so nodes
 * simply show no badge rather than a wrong one. */
export function loadExecutionLocus(force = false): Promise<void> {
  if (inFlight && !force) return inFlight;
  inFlight = (async () => {
    try {
      const response = await fetch('/api/nodes');
      if (!response.ok) return;
      const data = await response.json();
      if (Array.isArray(data?.modules)) projectNodeModules.set(data.modules);
      if (data?.runsOn) runsOnByModule.set(data.runsOn);
      if (data?.icons) iconByModule.set(data.icons);
    } catch {
      // Not served by the cascade CLI, or offline — no badge is the right
      // outcome, not a guess.
    }
  })();
  return inFlight;
}

/** `project.cloud-mask` -> `cloud-mask`. */
export function moduleName(modulePath: string | undefined | null): string | null {
  if (!modulePath) return null;
  const parts = modulePath.split('.');
  return parts.length > 1 ? parts.slice(1).join('.') : modulePath;
}
