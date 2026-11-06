import type { DefinitionNodeRegistration } from "../types.js";
import { coreNodeRegistrations } from "./core/index.js";
import { geoNodeRegistrations } from "./geo/index.js";
import { mathNodeRegistrations } from "./math/index.js";
import { popNodeRegistrations } from "./pop/index.js";
import { sceneNodeRegistrations } from "./scene/index.js";

/**
 * Every reserved built-in, in one list, so that a caller does not have to know
 * how many namespaces there are. `cascade.core.*` is structural and routing,
 * `cascade.geo.*` is the geometry set, and `cascade.pop.*` is the particle
 * set — which speaks the same `geometry` type as `geo`, so any of its outputs
 * fits any geometry node's input. `cascade.scene.*` is the assembly: geometry
 * plus a viewpoint plus lights, which is what the Viewer's 3D mode renders.
 */
export const builtinNodeRegistrations: readonly DefinitionNodeRegistration[] =
  Object.freeze([
    ...coreNodeRegistrations,
    ...geoNodeRegistrations,
    ...mathNodeRegistrations,
    ...popNodeRegistrations,
    ...sceneNodeRegistrations,
  ]);

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
