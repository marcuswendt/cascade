import type {
  CapabilityMap,
  CascadeAbortSignal,
  NodeCapabilityName,
  ProgressReporter,
} from "./capabilities.js";
import type {
  CascadeType,
  CoreType,
  JsonValue,
  NamespacedType,
  SerializableValueForType,
  ValueForType,
} from "./values.js";

export type RuntimeEnvironment = "portable" | "browser" | "server";
export type CapabilityForEnvironment<E extends RuntimeEnvironment> =
  E extends "portable"
    ? "assets" | "media" | "ai"
    : E extends "browser"
      ? "assets" | "media" | "webgl" | "ai"
      : "files" | "assets" | "media" | "python" | "ai" | "shell";
export type DataTypeForEnvironment<E extends RuntimeEnvironment> =
  E extends "browser" ? CascadeType : Exclude<CascadeType, "texture">;
type ControlFor<T extends CascadeType> = T extends "float"
  ? "number" | "slider" | "range"
  : T extends "int"
    ? "int" | "slider" | "range"
    : T extends "bool"
      ? "boolean"
      : T extends "string"
        ? "text" | "textarea" | "select"
        : T extends "vec2" | "vec3" | "vec4" | "vec2i" | "vec3i" | "vec4i"
          ? "vector"
          : T extends "mat2" | "mat3" | "mat4"
            ? "matrix"
            : T extends "color"
              ? "color"
              : T extends "image"
                ? "image"
                : T extends "asset"
                  ? "asset" | "select"
                  : T extends "texture"
                    ? never
                    : "select";
type NumericMetadata<T extends CascadeType> = T extends "float" | "int"
  ? { readonly min?: number; readonly max?: number; readonly step?: number }
  : { readonly min?: never; readonly max?: never; readonly step?: never };
type AcceptMetadata<T extends CascadeType> = T extends "image" | "asset"
  ? { readonly accept?: readonly string[] }
  : { readonly accept?: never };
type SelectMetadata<T extends CascadeType> =
  | {
      readonly control?: Exclude<ControlFor<T>, "select">;
      readonly options?: never;
    }
  | {
      readonly control: Extract<ControlFor<T>, "select">;
      readonly options?: readonly SerializableValueForType<T>[];
    };

export interface TriggerInputDefinition {
  readonly kind: "trigger";
  readonly description?: string;
}
export type DataInputDefinition<T extends CascadeType> = {
  readonly kind: "data";
  readonly type: T;
  readonly default?: SerializableValueForType<T>;
  readonly description?: string;
  readonly variadic?: boolean;
} & NumericMetadata<T> &
  AcceptMetadata<T> &
  SelectMetadata<T>;
export type InputDefinitionFor<E extends RuntimeEnvironment> =
  | TriggerInputDefinition
  | {
      [T in DataTypeForEnvironment<E>]: DataInputDefinition<T>;
    }[DataTypeForEnvironment<E>];
export interface TriggerOutputDefinition {
  readonly kind: "trigger";
  readonly description?: string;
}
export interface DataOutputDefinition<T extends CascadeType> {
  readonly kind: "data";
  readonly type: T;
  readonly description?: string;
}
export type OutputDefinitionFor<E extends RuntimeEnvironment> =
  | TriggerOutputDefinition
  | {
      [T in DataTypeForEnvironment<E>]: DataOutputDefinition<T>;
    }[DataTypeForEnvironment<E>];
export type PropDataType = Exclude<CoreType, "texture"> | NamespacedType;
export type PropDefinition<T extends PropDataType> = {
  readonly type: T;
  readonly default: SerializableValueForType<T>;
  readonly label?: string;
  readonly description?: string;
} & NumericMetadata<T> &
  AcceptMetadata<T> &
  SelectMetadata<T>;
export type AnyPropDefinition = {
  [T in PropDataType]: PropDefinition<T>;
}[PropDataType];
export interface NodeDefinitionForEnvironment<E extends RuntimeEnvironment> {
  readonly apiVersion: 1;
  readonly runsOn: E;
  /** Declares that authored nodes may use this node as their parent. */
  readonly container?: "subnet";
  readonly capabilities?: readonly CapabilityForEnvironment<E>[];
  readonly label?: string;
  readonly description?: string;
  readonly icon?: string;
  readonly inputs?: Readonly<Record<string, InputDefinitionFor<E>>>;
  readonly outputs?: Readonly<Record<string, OutputDefinitionFor<E>>>;
  readonly props?: Readonly<Record<string, AnyPropDefinition>>;
}
export type NodeDefinition = {
  [E in RuntimeEnvironment]: NodeDefinitionForEnvironment<E>;
}[RuntimeEnvironment];
export interface TriggerEvent {
  readonly id: `${string}:${number}`;
  readonly runId: string;
  readonly sequence: number;
  readonly payload?: JsonValue;
  readonly source:
    | { readonly kind: "external" }
    | Readonly<{ nodeId: string; outputName: string }>;
}

type Entries<D, K extends "inputs" | "outputs" | "props"> =
  D extends Record<K, infer R> ? R : Record<never, never>;
type InputValue<I> = I extends TriggerInputDefinition
  ? TriggerEvent | undefined
  : I extends DataInputDefinition<infer T>
    ? I extends { readonly variadic: true }
      ? readonly ValueForType<T>[]
      : "default" extends keyof I
        ? ValueForType<T>
        : ValueForType<T> | undefined
    : never;
type OutputValue<O> = O extends TriggerOutputDefinition
  ? { trigger(payload?: JsonValue): void }
  : O extends DataOutputDefinition<infer T>
    ? { set(value: ValueForType<T>): void }
    : never;
export type DeclaredCapabilities<D extends NodeDefinition> = Readonly<
  Pick<
    CapabilityMap,
    D["capabilities"] extends readonly NodeCapabilityName[]
      ? D["capabilities"][number]
      : never
  >
>;
export interface NodeExecutionContext<D extends NodeDefinition> {
  readonly inputs: Readonly<{
    [K in keyof Entries<D, "inputs">]: InputValue<Entries<D, "inputs">[K]>;
  }>;
  readonly outputs: Readonly<{
    [K in keyof Entries<D, "outputs">]: OutputValue<Entries<D, "outputs">[K]>;
  }>;
  readonly props: Readonly<{
    [K in keyof Entries<D, "props">]: Entries<
      D,
      "props"
    >[K] extends PropDefinition<infer T>
      ? ValueForType<T>
      : never;
  }>;
  readonly capabilities: DeclaredCapabilities<D>;
  readonly signal: CascadeAbortSignal;
  readonly progress: ProgressReporter;
}
export type NodeExecute<D extends NodeDefinition = NodeDefinition> = (
  context: NodeExecutionContext<D>,
) => void | Promise<void>;
