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
    ? "assets" | "media"
    : E extends "browser"
      ? "assets" | "media" | "gpu"
      : "files" | "assets" | "media" | "python" | "shell";
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
/**
 * `min`, `max` and `step`, for the types whose components are numbers.
 *
 * The vectors are included, and were not: they typed all three as `never`, so
 * the six vector types could not carry a range at all. Nothing exercised it
 * because no builtin vec prop has one — but Marcus's standing rule is that
 * anything with an x and a y is one `vec2` rather than two floats, and two
 * floats *can* carry a range while the `vec2` they became could not. So
 * following the convention cost the Inspector its clamp and its drag
 * granularity every time: `field-io-gradient-logo.offset` lost −1..1 step
 * 0.005, `offset.offset` lost −2..2, `ripple.centre` lost −1..2, and every
 * remaining vector candidate across the sketches carries a range too.
 *
 * One range for all components, not one per component. A per-component tuple
 * is a real design question — an `x` and a `y` with different limits is a
 * legitimate thing to want — but it is a second shape for this field and every
 * reader would have to handle both, so it waits for a case that needs it
 * rather than being guessed at now.
 *
 * Matrices stay excluded. Their control is a grid of components with an
 * identity button, and a range across a transform's cells is not a thing
 * anybody has asked for.
 */
type NumericMetadata<T extends CascadeType> = T extends
  | "float"
  | "int"
  | "vec2"
  | "vec3"
  | "vec4"
  | "vec2i"
  | "vec3i"
  | "vec4i"
  ? { readonly min?: number; readonly max?: number; readonly step?: number }
  : { readonly min?: never; readonly max?: never; readonly step?: never };
type AcceptMetadata<T extends CascadeType> = T extends "image" | "asset"
  ? { readonly accept?: readonly string[] }
  : { readonly accept?: never };
/**
 * One choice on a select control: the bare value, or the value with the words
 * a person reads.
 *
 * The labelled form exists because losing it cost something real. Converting
 * `image-superres` turned *"Off (pass through) / Local — Real-ESRGAN /
 * Magnific — costs money"* into `off` / `local` / `magnific`, and that third
 * label carried **the only warning that one of the three engines spends money
 * per call**. A lost display name is a papercut; a lost cost warning is a
 * bill. Six props across the sketches had lost their labels by the time this
 * landed, and that one is why it was not deferred any longer.
 *
 * A bare value stays legal, and reads as "the value is the label" — which is
 * true of most enums and is what every existing definition means.
 */
export type SelectOption<T extends CascadeType> =
  | SerializableValueForType<T>
  | Readonly<{
      value: SerializableValueForType<T>;
      label: string;
      /** Greyed out but visible: an option that exists and cannot be picked
       *  here, which is more informative than one that is simply absent. */
      disabled?: boolean;
    }>;
type SelectMetadata<T extends CascadeType> =
  | {
      readonly control?: Exclude<ControlFor<T>, "select">;
      readonly options?: never;
    }
  | {
      readonly control: Extract<ControlFor<T>, "select">;
      readonly options?: readonly SelectOption<T>[];
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
  /**
   * An expression the prop starts with, so a node can come out of the box
   * already moving — `sine-oscillator` and `ripple` baked in `$T` as dynamic
   * nodes and shipped a static 0 once converted, which is what this restores.
   * Marcus's decision, 2026-09-08, asked as a taste question about his own
   * tool: a node like that should self-animate when dropped.
   *
   * **It is a default, so it loses to a stored value like any other.** A
   * document that saved a plain number for this prop keeps that number and
   * does not silently start animating on load. That is the mirror of the
   * dropped-`params` fault: whatever the author set has to win, and the test
   * for this asserts the losing case rather than the winning one.
   *
   * Applied only when the document stored nothing at all for the prop. It is a
   * real expression once applied, not a hidden fallback — visible in the
   * Inspector, editable, and deletable, which is how a stored expression
   * already reads and the only version that does not lie about where the
   * number came from.
   */
  readonly expression?: string;
  /**
   * Render this prop as a button that fires a named action, rather than as an
   * editable field.
   *
   * It exists because converting a node removed a button. `observatory-moment`
   * declared `action: 'panel:observatory-moments'` as a dynamic node, which the
   * Inspector renders from `parameter.options.action`; the v1 adapter built its
   * options from `label`, `min`, `max`, `step` and `options` only, so the
   * Moment picker quietly became a two-step job through the panel menu instead
   * of one click on the node. Nothing broke — the panel falls back to the
   * selected node and reads the same prop — which is exactly why nobody would
   * have noticed from a test.
   *
   * The value is the action name the host dispatches. Cascade does not
   * interpret it; a `panel:` prefix is a Studio convention, not a contract.
   */
  readonly action?: string;
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
  /**
   * This node instance's id, stable for the life of the graph.
   *
   * It exists for one reason: naming a scratch file so that two instances of
   * the same module do not overwrite each other. `field-logo` runs one module
   * three times at three sizes, and `cloud-plots` runs `height-field` twice
   * with opposite mode toggles — a literal path silently loses one of each
   * pair. Pass it to `cachePath(context.nodeId, '.png')` and nothing else.
   *
   * An id is deliberately all a node gets. It names a namespace, not a
   * position: there is no way to reach a parent, a sibling or the graph
   * through it, which is what keeps a definition-v1 node a pure function of
   * its own inputs. Do not parse it.
   */
  readonly nodeId: string;
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
