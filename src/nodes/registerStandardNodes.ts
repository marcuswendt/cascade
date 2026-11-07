/**
 * The class-based standard library, for a host that is not a page.
 *
 * Studio calls `initializeNodeLibraries()`, which imports `core/index.ts` —
 * and that pulls each class's own TypeScript in with Vite's `?raw` so the code
 * viewer can show it. `?raw` resolves under Vite and nowhere else, so a Node
 * process cannot import it. This is the same registration with the source text
 * left out: the classes only, from the `classes.ts` map shared with Studio, so
 * there is one list of what exists rather than two that drift.
 *
 * Only `cascade.core.*` is here now. The image library was the other class
 * library until 2026-11-07; it is definition-v1 in `packages/runtime` like
 * `cascade.geo.*`, and reaches the compatibility graph through the definition
 * adapter instead.
 */
import { registerNodeClasses } from '../utils/nodeTypeUtils.js';
import { coreNodeClasses } from './core/classes.js';

let registered = false;

/** Register the class-based standard library. Safe to call more than once. */
export function registerStandardNodes(): void {
  if (registered) return;
  registerNodeClasses('core', coreNodeClasses);
  registered = true;
}

/** Whether the class-based standard library has been registered here. */
export function standardNodesRegistered(): boolean {
  return registered;
}
