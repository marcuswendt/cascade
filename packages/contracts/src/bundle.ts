/**
 * Bundles: one port carrying a set of named fields.
 *
 * Marcus, 2026-10-10, looking at a graph where one node fanned out a dozen
 * outputs wired everywhere: *"Instead of having these nodes with many different
 * outputs (more than 3 or 4 outputs), can we just export some kind of JSON
 * object, a sort of multi-object, instead of outputting 12 different outputs?"*
 *
 * A bundle value is a plain object of fields. Each field is any ordinary
 * Cascade value; an image or a cache entry travels as its reference (an
 * `ImageRef`, an `AssetRef`), never as pixels, so a bundle is as cheap to pass
 * as the fields it names.
 *
 * What makes it more than `object`:
 *
 *   - a producer declares its fields (`fields: { dpi: "float", ... }`), so a
 *     checker can name an unknown field and suggest the right one;
 *   - an optional `schema` name (`format`, `signals`, `marks`) keeps two
 *     unrelated bundles from being wired together;
 *   - a consumer may declare the fields it reads (`fields: ["dpi"]`). It then
 *     sees only those, and Studio re-cooks it only when one of them changed;
 *   - expressions read a wired bundle's fields: `ch("format.dpi")`.
 *
 * Everything here is pure and dependency-free so the runtime, Studio and the
 * CLI checker share one reading of the rules.
 */
import type { CascadeType } from "./values.js";

/** A declared field: its type, or its type with words for whoever reads it. */
export type BundleFieldDefinition =
  | CascadeType
  | Readonly<{ type: CascadeType; description?: string }>;

/** A producer's declaration: field name to type. */
export type BundleFieldDefinitions = Readonly<Record<string, BundleFieldDefinition>>;

export type Bundle = Readonly<Record<string, unknown>>;

/** The type a field declaration names. */
export function bundleFieldType(definition: BundleFieldDefinition | undefined): string {
  if (!definition) return "any";
  return typeof definition === "string" ? definition : definition.type;
}

/** The description a field declaration carries, if any. */
export function bundleFieldDescription(definition: BundleFieldDefinition | undefined): string | undefined {
  return typeof definition === "object" && definition ? definition.description : undefined;
}

/**
 * Whether two bundle ports may be wired. A port without a schema is generic and
 * takes any bundle; two named schemas must agree.
 */
export function bundleSchemasCompatible(output: string | undefined, input: string | undefined): boolean {
  return !output || !input || output === input;
}

/** True for a value a bundle port can carry: a plain, non-array object. */
export function isBundleValue(value: unknown): value is Bundle {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * A field path as an expression writes it: `format.dpi` is field `dpi` of the
 * port `format`. Only the first dot splits, so a field name never needs
 * escaping. Null when there is no dot to split on.
 */
export function splitBundlePath(name: string): { port: string; field: string } | null {
  const dot = name.indexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  return { port: name.slice(0, dot), field: name.slice(dot + 1) };
}

/**
 * A bundle narrowed to the fields a consumer declared. A field the producer
 * did not set is absent rather than `undefined`, the same as on the full value.
 */
export function selectBundleFields(value: unknown, fields: readonly string[]): Bundle | undefined {
  if (!isBundleValue(value)) return value as undefined;
  const selected: Record<string, unknown> = {};
  for (const field of fields)
    if (Object.prototype.hasOwnProperty.call(value, field)) selected[field] = value[field];
  return Object.freeze(selected);
}

/**
 * The closest candidate to a misspelt name, for "did you mean". Edit distance
 * with a threshold that scales with the length, so `dpu` finds `dpi` and
 * `colour` does not find `count`.
 */
export function suggestName(name: string, candidates: Iterable<string>): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;
  const lower = name.toLowerCase();
  for (const candidate of candidates) {
    const distance = editDistance(lower, candidate.toLowerCase());
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  if (best === undefined) return undefined;
  const limit = Math.max(1, Math.floor(Math.max(name.length, best.length) / 3));
  return bestDistance <= limit ? best : undefined;
}

/** "unknown field X — did you mean Y? (fields: a, b, c)" */
export function unknownFieldMessage(field: string, known: readonly string[], where: string): string {
  const suggestion = suggestName(field, known);
  return `${where} reads unknown bundle field "${field}"`
    + (suggestion ? ` — did you mean "${suggestion}"?` : "")
    + (known.length ? ` (fields: ${known.join(", ")})` : " (the bundle declares no fields)");
}

/**
 * What is wrong with a value a producer committed to a bundle port, or null.
 * With declared fields, every key must be declared; a declared field may be
 * absent. Field types are not checked here; the runtime does that per type.
 */
export function bundleValueProblem(value: unknown, fields: BundleFieldDefinitions | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (!isBundleValue(value)) return "a bundle must be a plain object of fields";
  if (!fields) return null;
  const known = Object.keys(fields);
  for (const key of Object.keys(value))
    if (!Object.prototype.hasOwnProperty.call(fields, key)) {
      const suggestion = suggestName(key, known);
      return `sets undeclared bundle field "${key}"`
        + (suggestion ? ` — did you mean "${suggestion}"?` : "")
        + ` (declared: ${known.join(", ") || "none"})`;
    }
  return null;
}

function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[b.length];
}
