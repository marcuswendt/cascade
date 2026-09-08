/**
 * The standard library, for a host that is not a page.
 *
 * Studio calls `initializeNodeLibraries()`, which imports `core/index.ts`,
 * `geo/index.ts` and `image/index.ts` — and those pull each node's own
 * TypeScript in with Vite's `?raw` so the code viewer can show it. `?raw`
 * resolves under Vite and nowhere else, so the CLI could not import them at
 * all: its class registry stayed empty, and every `cascade.image.*` and
 * `cascade.core.*` node in a graph died at load with "Unknown Cascade node
 * type: cascade.image.Color". A graph an artist builds in Studio out of image
 * nodes could not render headlessly, which is most of what `cascade run` is
 * for.
 *
 * This is the same registration with the source text left out: classes only,
 * from the `classes.ts` maps the two libraries now share with Studio, so there
 * is one list of what exists rather than two that drift.
 *
 * `cascade.geo.*` is deliberately not here. Those are definition-v1 modules
 * registered from `packages/runtime`, and the CLI reaches them through the
 * deterministic runtime rather than through this registry.
 */
import { registerNodeClasses } from '../utils/nodeTypeUtils.js';
import { coreNodeClasses } from './core/classes.js';
import { imageNodeClasses } from './image/classes.js';

let registered = false;

/** Register the class-based standard library. Safe to call more than once. */
export function registerStandardNodes(): void {
  if (registered) return;
  registerNodeClasses('core', coreNodeClasses);
  registerNodeClasses('image', imageNodeClasses);
  registered = true;
}

/** Whether the class-based standard library has been registered here. */
export function standardNodesRegistered(): boolean {
  return registered;
}
