/**
 * The reserved modules the CLI host resolves without a project file: the
 * runtime's headless built-ins (`builtins/headless.ts`: the Studio set plus
 * those Studio does not register yet), and the `cascade.assert.*` set, which
 * lives on the Node side because it decodes images with `node:zlib`
 * (./assertNodes.ts).
 */
import { headlessNodeRegistration, headlessNodeRegistrations } from '../../packages/runtime/src/builtins/headless.js';
import type { DefinitionNodeRegistration } from '../../packages/runtime/src/types.js';
import { assertNodeRegistrations } from './assertNodes.js';

export const headlessBuiltinRegistrations: readonly DefinitionNodeRegistration[] = Object.freeze([
  ...headlessNodeRegistrations,
  ...assertNodeRegistrations,
]);

const asserts = new Map(assertNodeRegistrations.map((registration) => [registration.moduleId, registration]));

export function headlessBuiltin(moduleId: string): DefinitionNodeRegistration | undefined {
  return headlessNodeRegistration(moduleId) ?? asserts.get(moduleId);
}
