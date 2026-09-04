import type { DefinitionNodeRegistration } from "../types.js";
import { coreNodeRegistrations } from "./core/index.js";
import { geoNodeRegistrations } from "./geo/index.js";

/**
 * Every reserved built-in, in one list, so that a caller does not have to know
 * how many namespaces there are. `cascade.core.*` is structural and routing;
 * `cascade.geo.*` is the geometry set.
 */
export const builtinNodeRegistrations: readonly DefinitionNodeRegistration[] =
  Object.freeze([...coreNodeRegistrations, ...geoNodeRegistrations]);

const registrationsById = new Map(
  builtinNodeRegistrations.map((registration) => [
    registration.moduleId,
    registration,
  ]),
);

export function builtinNodeRegistration(
  moduleId: string,
): DefinitionNodeRegistration | undefined {
  return registrationsById.get(moduleId);
}
