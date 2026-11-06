import type { DefinitionNodeRegistration } from "../types.js";
import { builtinNodeRegistration, builtinNodeRegistrations } from "./index.js";
import { imageNodeRegistrations } from "./image/index.js";

/**
 * Built-ins the headless host knows and Studio does not yet: today only
 * `cascade.image.ContactSheet`.
 *
 * A separate list rather than a line in `builtinNodeRegistrations` because
 * that list is in Studio's first-paint bundle (the runtime and the Definition
 * panel both import it), and the bundle budget has no room for a node Studio
 * does not register. The CLI passes these to the runtime as ordinary
 * registrations. When Studio registers the image nodes, they move into
 * `index.ts` and this file goes.
 */
export const headlessOnlyNodeRegistrations: readonly DefinitionNodeRegistration[] =
  Object.freeze([...imageNodeRegistrations]);

/** Every built-in the headless host can run. */
export const headlessNodeRegistrations: readonly DefinitionNodeRegistration[] =
  Object.freeze([...builtinNodeRegistrations, ...headlessOnlyNodeRegistrations]);

const headlessOnlyById = new Map(
  headlessOnlyNodeRegistrations.map((registration) => [registration.moduleId, registration]),
);

/** A headless-only built-in, which the runtime does not know unless it is passed in. */
export function headlessOnlyNodeRegistration(moduleId: string): DefinitionNodeRegistration | undefined {
  return headlessOnlyById.get(moduleId);
}

export function headlessNodeRegistration(moduleId: string): DefinitionNodeRegistration | undefined {
  return builtinNodeRegistration(moduleId) ?? headlessOnlyById.get(moduleId);
}
