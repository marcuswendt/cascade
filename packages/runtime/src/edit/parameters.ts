/**
 * Setting one parameter: where its value lives in the document, what a typed
 * value looks like, and how a value, an expression and a keyframe channel sit
 * together on one prop.
 *
 * The stored shapes are the ones Studio writes and the runtime reads, nothing
 * new: a plain value, or `{ value, expression?, channel? }` when the prop is
 * bound (`Node.serializePropValue`, `contracts/animation.ts`). A data input's
 * value goes in the node's `inputs`, as `{ name, defaultValue, dataType }`.
 */

import type { NodeDefinition } from "@cascade/contracts";
import { jsonEqual, setOrderedKey, NODE_KEY_ORDER, type EditableNode, type JsonObject } from "./document.js";

import type { Interpolation } from "../animation/channel.js";
export type { Interpolation };

/** What `cascade set` can change on one parameter. Every field is optional. */
export interface ParameterChange {
  /**
   * The new stored value. With `fromText`, a string as typed on a command line,
   * read according to the parameter's declared type (`0.5`, `true`, `1,2`,
   * `#ff8800`); otherwise a JSON value used as given.
   */
  readonly value?: unknown;
  readonly fromText?: boolean;
  /** An expression to bind, or `null` to remove the one there. */
  readonly expression?: string | null;
  /** Keyframes to set, replacing any key already at the same frame. */
  readonly keys?: readonly { frame: number; value: number }[];
  /** Frames whose keys are removed. */
  readonly removeKeys?: readonly number[];
  /** Interpolation for the keys being set. Studio's default is `smooth`. */
  readonly interpolation?: Interpolation;
  /** Forget the stored value and every binding: the parameter is back on its default. */
  readonly unset?: boolean;
}

export type ParameterField = "props" | "inputs";

export interface ParameterSlot {
  readonly field: ParameterField;
  readonly type: string | undefined;
  /** The declared default, `undefined` when there is none or the node is undeclared. */
  readonly default: unknown;
  readonly hasDefault: boolean;
  /** Declared with a default expression, so storing a plain value is a decision even when it equals the default. */
  readonly defaultExpression: boolean;
  readonly options: readonly unknown[] | undefined;
}

/**
 * Where a parameter is stored, from the node's definition. Props first, then
 * data inputs. Unknown names are an error with the list of real ones, because
 * a typo stored under a name nothing declares is dropped on load — the
 * `runtime/unknown-props` failure, which renders on defaults and reports success.
 */
export function parameterSlot(definition: NodeDefinition | undefined, name: string): ParameterSlot | { error: string } {
  if (!definition) {
    return { field: "props", type: undefined, default: undefined, hasDefault: false, defaultExpression: false, options: undefined };
  }
  const prop = (definition.props as Readonly<Record<string, JsonObject>> | undefined)?.[name];
  if (prop) {
    return {
      field: "props",
      type: String(prop.type),
      default: prop.default,
      hasDefault: "default" in prop,
      defaultExpression: typeof prop.expression === "string",
      options: Array.isArray(prop.options) ? prop.options.map(optionValue) : undefined,
    };
  }
  const input = (definition.inputs as Readonly<Record<string, JsonObject>> | undefined)?.[name];
  if (input && input.kind === "data") {
    return {
      field: "inputs",
      type: String(input.type),
      default: input.default,
      hasDefault: "default" in input,
      defaultExpression: false,
      options: Array.isArray(input.options) ? input.options.map(optionValue) : undefined,
    };
  }
  const props = Object.keys(definition.props ?? {});
  const inputs = Object.entries(definition.inputs ?? {})
    .filter(([, port]) => (port as { kind?: string }).kind === "data")
    .map(([portName]) => portName);
  return {
    error: `has no parameter "${name}"` +
      (props.length ? `; props: ${props.join(", ")}` : "") +
      (inputs.length ? `; inputs: ${inputs.join(", ")}` : ""),
  };
}

/**
 * Apply a change to one parameter of `node`. Returns what was stored before
 * and after (`undefined` = nothing stored, the default applies), so a caller
 * can report the change and undo it.
 */
export function applyParameterChange(
  node: EditableNode,
  name: string,
  slot: ParameterSlot,
  change: ParameterChange,
): { before: unknown; after: unknown } {
  if (slot.field === "inputs" && (change.expression !== undefined || change.keys?.length || change.removeKeys?.length)) {
    throw new Error(`${node.id}.${name} is an input; expressions and keyframes bind props only. Wire a node into it instead.`);
  }
  const before = readStored(node, name, slot.field);
  if (change.unset) {
    writeStored(node, name, slot.field, undefined, slot);
    return { before, after: undefined };
  }

  let binding = toBinding(before, slot);
  if (change.value !== undefined) {
    binding = { ...binding, value: coerceValue(change.value, slot, change.fromText === true, `${node.id}.${name}`) };
  }
  if (change.expression !== undefined) {
    binding = { ...binding, expression: change.expression || undefined };
  }
  if (change.keys?.length || change.removeKeys?.length) {
    binding = { ...binding, keys: updateKeys(binding.keys, change) };
  }

  const after = fromBinding(binding, slot);
  writeStored(node, name, slot.field, after, slot);
  return { before, after: readStored(node, name, slot.field) };
}

/** The value as stored in the document, or `undefined` when nothing is. */
export function readStored(node: EditableNode, name: string, field: ParameterField): unknown {
  if (field === "props") return node.props?.[name];
  const inputs = node.inputs;
  if (Array.isArray(inputs)) {
    const entry = inputs.find((item) => (item as JsonObject)?.name === name) as JsonObject | undefined;
    return entry ? ("defaultValue" in entry ? entry.defaultValue : entry.value) : undefined;
  }
  return inputs && typeof inputs === "object" ? (inputs as JsonObject)[name] : undefined;
}

interface Binding {
  readonly value: unknown;
  readonly expression?: string | undefined;
  readonly keys: readonly SerializedKey[];
}

interface SerializedKey {
  readonly frame: number;
  readonly value: number;
  readonly interpolation?: Interpolation;
}

function isBoundValue(stored: unknown): stored is { value: unknown; expression?: string; channel?: { keys?: SerializedKey[] } } {
  return !!stored && typeof stored === "object" && !Array.isArray(stored) &&
    "value" in stored && ("expression" in stored || "channel" in stored);
}

function toBinding(stored: unknown, slot: ParameterSlot): Binding {
  if (isBoundValue(stored)) {
    return {
      value: stored.value,
      expression: stored.expression,
      keys: Array.isArray(stored.channel?.keys) ? stored.channel!.keys : [],
    };
  }
  return { value: stored === undefined ? slot.default : stored, keys: [] };
}

/**
 * The stored form of a binding, or `undefined` when there is nothing worth
 * storing: a plain value equal to the declared default is not written, the way
 * Studio writes only the parameters that differ. The exception is a prop
 * declared with a default expression, where a stored plain value is what turns
 * that expression off.
 */
function fromBinding(binding: Binding, slot: ParameterSlot): unknown {
  if (binding.expression || binding.keys.length) {
    return {
      value: binding.value,
      ...(binding.expression ? { expression: binding.expression } : {}),
      ...(binding.keys.length ? { channel: { keys: binding.keys } } : {}),
    };
  }
  if (binding.value === undefined) return undefined;
  if (slot.hasDefault && !slot.defaultExpression && jsonEqual(binding.value, slot.default)) return undefined;
  return binding.value;
}

function updateKeys(keys: readonly SerializedKey[], change: ParameterChange): SerializedKey[] {
  const byFrame = new Map(keys.map((key) => [key.frame, key]));
  for (const frame of change.removeKeys ?? []) byFrame.delete(frame);
  for (const key of change.keys ?? []) {
    if (!Number.isFinite(key.frame) || !Number.isFinite(key.value)) {
      throw new Error(`A keyframe needs a numeric frame and value (got ${key.frame}=${key.value})`);
    }
    const interpolation = change.interpolation ?? byFrame.get(key.frame)?.interpolation;
    byFrame.set(key.frame, interpolation && interpolation !== "smooth"
      ? { frame: key.frame, value: key.value, interpolation }
      : { frame: key.frame, value: key.value });
  }
  return [...byFrame.values()].sort((a, b) => a.frame - b.frame);
}

function writeStored(node: EditableNode, name: string, field: ParameterField, value: unknown, slot: ParameterSlot): void {
  if (field === "props") {
    const props = node.props ?? {};
    if (value === undefined) delete props[name];
    else props[name] = value;
    if (Object.keys(props).length) setOrderedKey(node, "props", props, NODE_KEY_ORDER);
    else delete node.props;
    return;
  }
  const inputs = node.inputs;
  if (inputs && typeof inputs === "object" && !Array.isArray(inputs)) {
    const record = inputs as JsonObject;
    if (value === undefined) delete record[name];
    else record[name] = value;
    if (!Object.keys(record).length) delete node.inputs;
    return;
  }
  // Studio's array form, `{ name, defaultValue, dataType }`.
  const list = Array.isArray(inputs) ? inputs as JsonObject[] : [];
  const at = list.findIndex((item) => item?.name === name);
  if (value === undefined) {
    if (at !== -1) list.splice(at, 1);
  } else if (at !== -1) {
    const entry = list[at]!;
    const key = "value" in entry && !("defaultValue" in entry) ? "value" : "defaultValue";
    list[at] = { ...entry, [key]: value };
  } else {
    list.push({ name, defaultValue: value, ...(slot.type ? { dataType: slot.type } : {}) });
  }
  if (list.length) setOrderedKey(node, "inputs", list, NODE_KEY_ORDER);
  else delete node.inputs;
}

/**
 * A value of the declared type, or an error naming what was expected. Text
 * from a command line is read by type, so `cascade set g text.content 300`
 * stores the string "300" while `scale 300` stores a number.
 */
export function coerceValue(raw: unknown, slot: ParameterSlot, fromText: boolean, where: string): unknown {
  const type = slot.type;
  let value = raw;
  if (fromText && typeof raw === "string") {
    value = type === "string" ? unquote(raw) : parseText(raw, type);
  }
  if (!type) return value;
  const fail = (expected: string): never => {
    throw new Error(`${where} expects ${expected} (got ${JSON.stringify(value)})`);
  };
  switch (type) {
    case "float":
      if (typeof value !== "number" || !Number.isFinite(value)) fail("a number");
      break;
    case "int":
      if (typeof value !== "number" || !Number.isInteger(value)) fail("an integer");
      break;
    case "bool":
      if (typeof value !== "boolean") fail("true or false");
      break;
    case "string":
      if (typeof value !== "string") value = String(value);
      break;
    case "color":
      value = colorValue(value) ?? fail("a colour: #rrggbb, #rrggbbaa or [r, g, b, a] in 0..1");
      break;
    default: {
      const size = /^(?:vec|mat)(\d)i?$/.exec(type);
      if (size) {
        const length = type.startsWith("mat") ? Number(size[1]) ** 2 : Number(size[1]);
        if (!Array.isArray(value) || value.length !== length || !value.every((n) => typeof n === "number" && Number.isFinite(n))) {
          fail(`${length} numbers, e.g. ${Array.from({ length }, () => "0").join(",")}`);
        }
        if (type.endsWith("i") && !(value as number[]).every(Number.isInteger)) fail(`${length} integers`);
      }
    }
  }
  if (slot.options && !slot.options.some((option) => jsonEqual(option, value))) {
    fail(`one of ${slot.options.map((option) => JSON.stringify(option)).join(", ")}`);
  }
  return value;
}

function parseText(text: string, type: string | undefined): unknown {
  const trimmed = text.trim();
  if (type && /^(?:vec|mat)\d/.test(type) && !trimmed.startsWith("[")) {
    return trimmed.split(",").map((part) => Number(part.trim()));
  }
  if (type === "color" && trimmed.startsWith("#")) return trimmed;
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function unquote(text: string): string {
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    try {
      return JSON.parse(text) as string;
    } catch {
      return text;
    }
  }
  return text;
}

/** `[r, g, b, a]` in 0..1, Studio's stored colour. Hex is converted, rounded to four places. */
function colorValue(value: unknown): number[] | null {
  if (typeof value === "string") {
    const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value.trim());
    if (!hex) return null;
    const digits = hex[1]! + (hex[2] ?? "ff");
    return [0, 2, 4, 6].map((at) => Math.round((parseInt(digits.slice(at, at + 2), 16) / 255) * 10000) / 10000);
  }
  if (Array.isArray(value) && (value.length === 3 || value.length === 4) && value.every((n) => typeof n === "number")) {
    return value.length === 3 ? [...value, 1] : [...value];
  }
  return null;
}

function optionValue(option: unknown): unknown {
  return option && typeof option === "object" && !Array.isArray(option) && "value" in option
    ? (option as { value: unknown }).value
    : option;
}
