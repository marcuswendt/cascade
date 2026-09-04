import type { DefinitionNodeRegistration } from "../../types.js";
import { copyToPointsRegistration } from "./copyToPoints.js";
import { circleRegistration, rectangleRegistration } from "./generators.js";
import { mergeRegistration } from "./merge.js";
import { svgExportRegistration } from "./svgExport.js";
import { transformRegistration } from "./transform.js";

/**
 * The six geometry built-ins that prove the format composes: two generators,
 * two operators, the instancer and the export.
 *
 * `Merge` and `CopyToPoints` are here rather than in a later batch because they
 * are the pair that fails loudly if the attribute model does not compose, so a
 * format mistake surfaces now rather than after twenty nodes are written against
 * it. `SvgExport` is here because it makes the result a file rather than an
 * assertion.
 *
 * The namespace lives in `namespace.ts`, once.
 */
export {
  circleRegistration,
  copyToPointsRegistration,
  mergeRegistration,
  rectangleRegistration,
  svgExportRegistration,
  transformRegistration,
};
export { GEO_NAMESPACE, geoModuleId } from "./namespace.js";

export const geoNodeRegistrations: readonly DefinitionNodeRegistration[] =
  Object.freeze([
    rectangleRegistration,
    circleRegistration,
    transformRegistration,
    mergeRegistration,
    copyToPointsRegistration,
    svgExportRegistration,
  ]);

const registrationsById = new Map(
  geoNodeRegistrations.map((registration) => [
    registration.moduleId,
    registration,
  ]),
);

export function geoNodeRegistration(
  moduleId: string,
): DefinitionNodeRegistration | undefined {
  return registrationsById.get(moduleId);
}
