import { isGeometrySerialized } from "./geometry.js";
import { CORE_TYPES, type JsonValue } from "./values.js";
import type { NodeCapabilityName } from "./capabilities.js";
import type { NodeDefinition, RuntimeEnvironment } from "./definition.js";

export interface Diagnostic {
  readonly phase: string;
  readonly code: string;
  readonly message: string;
  readonly path?: string;
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
}
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*$/;
const NAMESPACED = /^[a-z][a-z0-9-]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;
const RESERVED = new Set(["__proto__", "prototype", "constructor"]);
const CORE = new Set<string>(CORE_TYPES);
const CONTROLS = new Set(["number", "slider", "range", "int", "boolean", "text", "textarea", "select", "vector", "matrix", "color", "image", "asset"]);
/**
 * The capabilities a definition may *declare* for each environment. Declaring
 * one is not the same as a host installing it — `MediaCapability` is declared
 * here and implemented by nobody — so anything deciding whether a graph can
 * actually run must ask the host, and use this only to classify which host a
 * capability belongs to.
 */
export const CAPABILITIES_BY_ENVIRONMENT: Record<
  RuntimeEnvironment,
  readonly NodeCapabilityName[]
> = {
  portable: ["assets", "media", "gpu"],
  browser: ["assets", "media", "gpu"],
  server: ["files", "assets", "media", "python", "shell", "gpu"],
};
const ALLOWED = CAPABILITIES_BY_ENVIRONMENT;
const fields = (names: string) => new Set(names.split(" "));
const TOP_FIELDS = fields(
  "apiVersion runsOn container capabilities label description icon inputs outputs props",
);
const DATA_FIELDS = fields(
  "kind type default description variadic min max step accept control options",
);
const OUTPUT_FIELDS = fields("kind type description");
const PROP_FIELDS = fields(
  "type default label description min max step accept control options expression action",
);

function diagnostic(code: string, message: string, path?: string): Diagnostic {
  return { phase: "definition", code: `definition/${code}`, message, path };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validType(type: unknown): type is string {
  return typeof type === "string" && (CORE.has(type) || NAMESPACED.test(type));
}
function finiteJson(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(finiteJson);
  return isRecord(value) && Object.values(value).every(finiteJson);
}
function unknownFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
): Diagnostic[] {
  return Object.keys(value)
    .filter((key) => !allowed.has(key))
    .map((key) =>
      diagnostic(
        "unknown-field",
        `${path}.${key} is not allowed`,
        `${path}.${key}`,
      ),
    );
}
function defaultMatches(type: string, value: unknown): boolean {
  if (!finiteJson(value)) return false;
  // Without this case a geometry default falls through the length table below
  // and any JSON value at all passes, which is the hole the four scalar cases
  // exist to close. A default that cannot be validated is not a default.
  if (type === "geometry") return isGeometrySerialized(value);
  if (type === "float") return typeof value === "number";
  if (type === "int") return typeof value === "number";
  if (type === "bool") return typeof value === "boolean";
  if (type === "string") return typeof value === "string";
  const lengths: Record<string, number> = {
    vec2: 2,
    vec3: 3,
    vec4: 4,
    vec2i: 2,
    vec3i: 3,
    vec4i: 4,
    mat2: 4,
    mat3: 9,
    mat4: 16,
    color: 4,
  };
  const length = lengths[type];
  return (
    length === undefined ||
    (Array.isArray(value) &&
      value.length === length &&
      value.every((item) =>
        type.endsWith("i") ? Number.isInteger(item) : typeof item === "number",
      ))
  );
}

export function validateNodeDefinition(value: unknown): readonly Diagnostic[] {
  if (!isRecord(value))
    return [diagnostic("not-object", "Definition must be an object")];
  const result = unknownFields(value, TOP_FIELDS, "definition");
  const add = (code: string, message: string, path?: string) =>
    result.push(diagnostic(code, message, path));
  const environment = value.runsOn;
  if (value.apiVersion !== 1)
    add("api-version", "apiVersion must be 1", "apiVersion");
  if (!Object.prototype.hasOwnProperty.call(ALLOWED, String(environment)))
    add("environment", "runsOn must be portable, browser, or server", "runsOn");
  if (value.container !== undefined && value.container !== "subnet")
    add("invalid-container", "container must be subnet", "container");

  const allowed = ALLOWED[environment as RuntimeEnvironment] ?? [];
  if (value.capabilities !== undefined && !Array.isArray(value.capabilities))
    add(
      "invalid-capabilities",
      "capabilities must be an array",
      "capabilities",
    );
  const seen = new Set<unknown>();
  for (const [index, capability] of (Array.isArray(value.capabilities)
    ? value.capabilities
    : []
  ).entries()) {
    const path = `capabilities.${index}`;
    if (
      !seen.has(capability) &&
      !allowed.includes(capability as NodeCapabilityName)
    )
      add(
        "capability-not-allowed",
        `${String(capability)} is not available on ${String(environment)}`,
        path,
      );
    if (seen.has(capability))
      add("duplicate-capability", `${String(capability)} is duplicated`, path);
    seen.add(capability);
  }

  // Two namespaces, not one. An output is addressed in the other direction from
  // an input, so `geometry` in and `geometry` out is not ambiguous anywhere: the
  // document format names the two endpoints of a connection separately, the
  // runtime keys them as `source.outputName` and `target.inputName`, and
  // `NodeExecutionContext` hands a node `context.inputs` and `context.outputs`
  // as separate records. One shared namespace made "geometry in, geometry out"
  // inexpressible and forced every geometry operator to call its input `input`,
  // which Marcus overruled 2026-09-04: *"sounds weird, we need to allow this
  // case."*
  //
  // Inputs and props still share one namespace. Both feed a value *into* the
  // node from the same side, an unconnected input with a default is the same
  // control as a prop to whoever is looking at the node, and there is no
  // direction to tell them apart by. That one stays a collision.
  const inward = new Map<string, string>();
  const outward = new Map<string, string>();
  for (const section of ["inputs", "outputs", "props"] as const) {
    const entries = value[section];
    if (entries === undefined) continue;
    if (!isRecord(entries)) {
      add("invalid-section", `${section} must be an object`, section);
      continue;
    }
    for (const [name, raw] of Object.entries(entries)) {
      const path = `${section}.${name}`;
      if (!IDENTIFIER.test(name))
        add("invalid-name", `${name} is not a valid identifier`, path);
      if (RESERVED.has(name)) add("reserved-name", `${name} is reserved`, path);
      const names = section === "outputs" ? outward : inward;
      const previous = names.get(name);
      if (previous)
        add(
          "name-collision",
          `${name} is declared in ${previous} and ${section}`,
          path,
        );
      else names.set(name, section);
      if (!isRecord(raw)) {
        add("invalid-entry", `${path} must be an object`, path);
        continue;
      }

      const fields =
        section === "props"
          ? PROP_FIELDS
          : section === "outputs"
            ? OUTPUT_FIELDS
            : DATA_FIELDS;
      if (
        section !== "props" &&
        raw.kind !== "data" &&
        raw.kind !== "trigger"
      ) {
        add(
          "invalid-kind",
          `${path}.kind must be data or trigger`,
          `${path}.kind`,
        );
        result.push(...unknownFields(raw, fields, path));
        continue;
      }
      if (section !== "props" && raw.kind === "trigger") {
        if (
          Object.keys(raw).some(
            (key) => key !== "kind" && key !== "description",
          )
        )
          add(
            "trigger-extra",
            "Trigger ports allow only kind and description",
            path,
          );
        continue;
      }
      result.push(...unknownFields(raw, fields, path));
      if (
        "control" in raw &&
        (typeof raw.control !== "string" || !CONTROLS.has(raw.control))
      )
        add(
          "invalid-control",
          `${String(raw.control)} is not a Cascade control`,
          `${path}.control`,
        );
      if ("options" in raw && raw.control !== "select")
        add(
          "options-without-select",
          "options require the select control",
          `${path}.options`,
        );
      // A labelled option is `{ value, label }`. Checked because the failure
      // is cosmetic and silent: a malformed entry reaches the control and
      // renders as "[object Object]" rather than erroring, and the labelled
      // form exists precisely because a lost label lost a cost warning.
      if (Array.isArray(raw.options))
        for (const [index, option] of raw.options.entries()) {
          if (option === null || typeof option !== "object") continue;
          const entry = option as Record<string, unknown>;
          if (!("value" in entry))
            add(
              "invalid-option",
              "a labelled option needs a value",
              `${path}.options[${index}]`,
            );
          if (typeof entry.label !== "string" || !entry.label)
            add(
              "invalid-option",
              "a labelled option needs a non-empty label",
              `${path}.options[${index}].label`,
            );
          if ("disabled" in entry && typeof entry.disabled !== "boolean")
            add(
              "invalid-option",
              "disabled must be a boolean",
              `${path}.options[${index}].disabled`,
            );
        }
      const type = raw.type;
      if (!validType(type)) {
        add(
          "invalid-type",
          `${String(type)} is not a Cascade type`,
          `${path}.type`,
        );
        continue;
      }
      if (type === "texture" && environment !== "browser")
        add("texture-not-portable", "texture is browser-only", `${path}.type`);
      if (type === "texture" && "default" in raw)
        add(
          "texture-default",
          "texture cannot have a default",
          `${path}.default`,
        );
      if (section === "props" && !("default" in raw))
        add("missing-default", "Props require defaults", `${path}.default`);
      if ("default" in raw && !finiteJson(raw.default))
        add(
          "invalid-default",
          "Default must be finite JSON",
          `${path}.default`,
        );
      else if ("default" in raw && !defaultMatches(type, raw.default))
        add(
          "default-type",
          `Default does not match ${type}`,
          `${path}.default`,
        );
      if (
        type === "int" &&
        "default" in raw &&
        (!Number.isFinite(raw.default) || !Number.isInteger(raw.default))
      )
        add(
          "non-integer",
          "Integer defaults must be finite integers",
          `${path}.default`,
        );
      if (
        "step" in raw &&
        (typeof raw.step !== "number" ||
          !Number.isFinite(raw.step) ||
          raw.step <= 0)
      )
        add("invalid-step", "step must be greater than zero", `${path}.step`);
      if (
        section === "props" &&
        "expression" in raw &&
        (typeof raw.expression !== "string" || raw.expression.length === 0)
      )
        add(
          "invalid-expression",
          "expression must be a non-empty string",
          `${path}.expression`,
        );
      for (const field of ["min", "max"] as const) {
        if (
          field in raw &&
          (typeof raw[field] !== "number" || !Number.isFinite(raw[field]))
        )
          add(
            `invalid-${field}`,
            `${field} must be a finite number`,
            `${path}.${field}`,
          );
      }
      if (
        typeof raw.min === "number" &&
        typeof raw.max === "number" &&
        raw.min > raw.max
      )
        add("invalid-range", "min must not exceed max", path);
    }
  }
  return result;
}

export function assertNodeDefinition(
  value: unknown,
): asserts value is NodeDefinition {
  const diagnostics = validateNodeDefinition(value);
  if (diagnostics.length)
    throw new TypeError(
      diagnostics.map((item) => `${item.code}: ${item.message}`).join("\n"),
    );
}
