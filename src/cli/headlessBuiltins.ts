/**
 * The reserved modules the CLI host resolves without a project file.
 *
 * Since 2026-11-07 that is exactly the runtime's built-in list: the image
 * library and the `cascade.assert.*` set became portable and Studio registers
 * them too, so the headless-only list they used to need is gone. These names
 * stay because the CLI reads built-ins through them.
 */
import { builtinNodeRegistration, builtinNodeRegistrations } from '../../packages/runtime/src/builtins/index.js';
import type { DefinitionNodeRegistration } from '../../packages/runtime/src/types.js';

export const headlessBuiltinRegistrations: readonly DefinitionNodeRegistration[] = builtinNodeRegistrations;

export function headlessBuiltin(moduleId: string): DefinitionNodeRegistration | undefined {
  return builtinNodeRegistration(moduleId);
}
