import type { SerializableValue } from "./values.js";

export interface CascadeDocumentNode {
  readonly id: string;
  readonly module?: string;
  readonly type?: string;
  readonly parent?: string;
  readonly inputs?: readonly Readonly<{ name: string; defaultValue?: unknown; value?: unknown }>[] | Readonly<Record<string, unknown>>;
  readonly props?: Readonly<Record<string, unknown>>;
  /**
   * The dynamic engine's stored parameter values, and dead weight here.
   *
   * The deterministic runtime reads `props` and nothing else, so a document
   * that still carries `params` loses every value in it and reports nothing —
   * a converted sketch silently reverts to its defaults and draws something
   * different. Declared so that the runtime can recognise the key and warn
   * about it, which is the only reason it appears in a v1 type.
   *
   * @deprecated Migrate to `props`.
   */
  readonly params?: readonly Readonly<{ name: string; value?: unknown }>[] | Readonly<Record<string, unknown>>;
}

export interface CascadeDocumentAnnotation {
  readonly id: string;
  readonly type: string;
  readonly parent?: string;
  readonly position?: readonly [number, number] | Readonly<{ x: number; y: number }>;
  readonly content?: string;
  readonly src?: string;
  readonly [key: string]: unknown;
}

export type CascadeConnectionEndpoint = readonly [string, number, string?];
export type CascadeDocumentConnection =
  | readonly [CascadeConnectionEndpoint, CascadeConnectionEndpoint]
  | Readonly<{
      source: Readonly<{ nodeId: string; outputName: string }>;
      target: Readonly<{ nodeId: string; inputName: string }>;
    }>;

export interface CascadeDocument {
  readonly version?: string;
  readonly nodes: readonly CascadeDocumentNode[];
  readonly annotations?: readonly CascadeDocumentAnnotation[];
  readonly connections?: readonly CascadeDocumentConnection[];
}

export interface CascadePreset {
  readonly version: 1;
  readonly nodes: Readonly<Record<string, Readonly<{
    inputs?: Readonly<Record<string, SerializableValue>>;
    props?: Readonly<Record<string, SerializableValue>>;
  }>>>;
}
