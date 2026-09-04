/**
 * The one place the geometry built-in namespace is written down.
 *
 * `cascade.geo.*` is reserved, decided 2026-09-04 by Marcus: *"`.geo` is clear,
 * all good."* So the reserved surface grows from eight structural nodes to
 * those plus the geometry library, and the line that widening draws is worth
 * keeping in mind: `cascade.core.*` is the structure of a graph, while
 * `cascade.geo.*` is a medium.
 *
 * Every module id in this folder goes through `geoModuleId`, so renaming the
 * namespace is this constant and nothing else.
 */
export const GEO_NAMESPACE = "cascade.geo";

export function geoModuleId(name: string): string {
  return `${GEO_NAMESPACE}.${name}`;
}
