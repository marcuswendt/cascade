import type {
  AssetCapability,
  AssetRef,
  CascadeAbortSignal,
  CascadeDocument,
  CascadeDocumentAnnotation,
  CascadeDocumentConnection,
  CascadeDocumentNode,
  CascadePreset,
  Diagnostic,
  FileCapability,
  ImageRef,
  JsonValue,
  MediaCapability,
  NodeDefinition,
  NodeExecute,
  ProgressReporter,
  PythonCapability,
  SerializableValue,
  ShellCapability,
  TextureHandle,
  GpuCapability,
} from "@cascade/contracts";

export type {
  CascadeDocument,
  CascadeDocumentAnnotation,
  CascadeDocumentConnection,
  CascadeDocumentNode,
  CascadePreset,
} from "@cascade/contracts";

export interface DefinitionNodeRegistration<
  D extends NodeDefinition = NodeDefinition,
> {
  readonly kind: "definition-v1";
  readonly moduleId: string;
  readonly definition: D;
  /** Selects the implementation for the concrete host running the graph. */
  readonly loadExecute: (
    environment: "browser" | "server",
  ) => Promise<NodeExecute<D>>;
}
export interface LegacyNodeRegistration {
  readonly kind: "legacy-dynamic";
  readonly moduleId: string;
  readonly runsOn: "browser" | "server";
  readonly shellBinding: "server-direct" | "browser-http" | "none";
  readonly loadExecute: () => Promise<LegacyNodeExecute>;
  readonly timeoutMs?: number;
}
export type LegacyNodeExecute = (
  node: LegacyNodeFacade,
  graph: LegacyGraphFacade,
) => void | Promise<void>;
export interface LegacyNodeFacade {
  readonly id: string;
  readonly moduleId: string;
}
export interface LegacyGraphFacade {
  readonly nodes: readonly LegacyNodeFacade[];
  getNode(id: string): LegacyNodeFacade | undefined;
  getElement(id: string): LegacyNodeFacade | undefined;
}
export type NodeRegistration =
  | DefinitionNodeRegistration
  | LegacyNodeRegistration;

export interface RuntimeCapabilities {
  readonly files?: FileCapability;
  readonly assets?: AssetCapability;
  readonly media?: MediaCapability;
  readonly python?: PythonCapability;
  readonly gpu?: GpuCapability;
  readonly shell?: ShellCapability;
  readonly serverBridge?: ServerBridgeCapability;
}
export interface RuntimeHost {
  readonly environment: "browser" | "server";
  readonly capabilities: RuntimeCapabilities;
  readonly modules: {
    resolve(moduleId: string): Promise<NodeRegistration | null>;
  };
  readonly legacyShell?: LegacyShellBindingFactory;
  now(): number;
  report(diagnostic: Diagnostic): void;
}
export interface LegacyShellBindingFactory {
  readonly kind: "server-direct" | "browser-http";
  preflight(
    registration: LegacyNodeRegistration,
    host: Readonly<{ environment: RuntimeHost["environment"] }>,
  ): readonly Diagnostic[];
  bind(
    context: Readonly<{
      phase: "initialization" | "run";
      lifecycleId: string;
      signal: CascadeAbortSignal;
    }>,
  ): Promise<ShellCapability>;
  dispose?(): void | Promise<void>;
}
export interface ServerBridgeCapability {
  execute(
    request: BridgeExecutionRequest,
    options: { signal: CascadeAbortSignal; progress: ProgressReporter },
  ): Promise<BridgeExecutionResult>;
}
export interface BridgeExecutionRequest {
  readonly moduleId: string;
  readonly nodeId: string;
  readonly inputs: Readonly<
    Record<string, SerializableValue | AssetRef | ImageRef>
  >;
  readonly props: Readonly<Record<string, SerializableValue>>;
}
export interface BridgeExecutionResult {
  readonly outputs: Readonly<
    Record<string, SerializableValue | AssetRef | ImageRef>
  >;
  readonly diagnostics: readonly Diagnostic[];
}

export type GraphState = "ready" | "running" | "cancelling" | "disposed";
export type RunTarget =
  | { readonly kind: "all" }
  | { readonly kind: "node"; readonly nodeId: string }
  | {
      readonly kind: "output";
      readonly nodeId: string;
      readonly outputName: string;
    };
export interface RunOptions {
  readonly target?: RunTarget;
  readonly signal?: CascadeAbortSignal;
  readonly runId?: string;
  /**
   * The frame to resolve animated parameters at — a keyframe channel is
   * sampled here and `$F`/`$FF`/`$T` are derived from it. Fractional frames
   * are kept. Omitted leaves the graph on the frame it is already on.
   *
   * A value the caller states rather than a clock the runtime reads: same
   * graph plus same frame gives the same output, which is what makes an
   * offline render reproducible.
   */
  readonly frame?: number;
  /** Frames per second, for `$FPS` and for `$T`. Default 30. */
  readonly fps?: number;
}
export interface RunResult {
  readonly runId: string;
  readonly status: "completed" | "cancelled" | "failed";
  readonly outputs: ReadonlyMap<string, ReadonlyMap<string, unknown>>;
  readonly diagnostics: readonly Diagnostic[];
  readonly timings: Readonly<{
    startedAt: number;
    finishedAt: number;
    durationMs: number;
  }>;
}
export interface PortInspection {
  readonly kind: "data" | "trigger";
  readonly type: string;
  readonly connected: boolean;
  readonly value?: unknown;
}
export interface PropInspection {
  readonly type: string;
  readonly value: unknown;
}
export interface NodeInspection {
  readonly id: string;
  readonly moduleId: string;
  readonly runsOn: NodeDefinition["runsOn"];
  readonly parent?: string;
  readonly inputs: Readonly<Record<string, PortInspection>>;
  readonly outputs: Readonly<Record<string, PortInspection>>;
  readonly props: Readonly<Record<string, PropInspection>>;
}
export interface ConnectionInspection {
  readonly source: Readonly<{ nodeId: string; outputName: string }>;
  readonly target: Readonly<{ nodeId: string; inputName: string }>;
}
export interface GraphInspection {
  readonly state: GraphState;
  readonly interface: Readonly<{
    inputs: Readonly<Record<string, GraphBoundaryInspection>>;
    outputs: Readonly<Record<string, GraphBoundaryInspection>>;
  }>;
  readonly nodes: readonly NodeInspection[];
  readonly connections: readonly ConnectionInspection[];
  readonly diagnostics: readonly Diagnostic[];
}
export interface GraphBoundaryInspection {
  readonly nodeId: string;
  readonly type: string;
}
export type RuntimeEvent =
  | {
      readonly type: "run:start";
      readonly runId: string;
      readonly target: RunTarget;
    }
  | {
      readonly type: "node:start";
      readonly runId: string;
      readonly nodeId: string;
    }
  | {
      readonly type: "node:progress";
      readonly runId: string;
      readonly nodeId: string;
      readonly progress?: number;
      readonly message?: string;
      readonly detail?: JsonValue;
    }
  | {
      readonly type: "trigger:queued";
      readonly runId: string;
      readonly nodeId: string;
      readonly inputName: string;
      readonly event: import("@cascade/contracts").TriggerEvent;
    }
  | {
      readonly type: "trigger:delivered";
      readonly runId: string;
      readonly nodeId: string;
      readonly inputName: string;
      readonly event: import("@cascade/contracts").TriggerEvent;
    }
  | {
      readonly type: "node:output";
      readonly runId: string;
      readonly nodeId: string;
      readonly outputName: string;
      readonly value: unknown;
    }
  | {
      readonly type: "node:complete";
      readonly runId: string;
      readonly nodeId: string;
    }
  | {
      readonly type: "diagnostic";
      readonly runId?: string;
      readonly diagnostic: Diagnostic;
    }
  | {
      readonly type: "run:cancel";
      readonly runId: string;
      readonly reason?: string;
    }
  | { readonly type: "run:complete"; readonly result: RunResult };
export interface CreateRuntimeOptions {
  readonly host: RuntimeHost;
  readonly nodes?: readonly NodeRegistration[];
}
export interface CascadeRuntime {
  registerNode(registration: NodeRegistration): void;
  load(document: CascadeDocument): Promise<LoadedCascadeGraph>;
  dispose(): Promise<void>;
}
export interface LoadedCascadeGraph {
  readonly state: GraphState;
  /**
   * Host-aware static gate: the diagnostics `run` would raise before executing
   * anything, collected instead of thrown. This is what lets a validator see a
   * missing capability, which is a fault it was previously blind to.
   */
  preflight(): readonly Diagnostic[];
  inspect(): GraphInspection;
  setInput(nodeId: string, inputName: string, value: unknown): Promise<void>;
  setGraphInput(name: string, value: unknown): Promise<void>;
  setProp(nodeId: string, propName: string, value: unknown): Promise<void>;
  applyPreset(preset: CascadePreset): Promise<void>;
  trigger(
    nodeId: string,
    inputName: string,
    payload?: JsonValue,
    options?: Readonly<{ signal?: CascadeAbortSignal; runId?: string }>,
  ): Promise<RunResult>;
  run(options?: RunOptions): Promise<RunResult>;
  /**
   * Move the graph's clock without cooking. Animated parameters re-resolve
   * immediately, so `inspect()` reports them at this frame.
   */
  setFrame(frame: number): void;
  setFps(fps: number): void;
  getFrame(): number;
  getFps(): number;
  cancel(reason?: string): void;
  subscribe(listener: (event: RuntimeEvent) => void): () => void;
  getOutput(nodeId: string, outputName: string): unknown;
  getGraphOutput(name: string): unknown;
  getOutputs(nodeId: string): ReadonlyMap<string, unknown>;
  dispose(): Promise<void>;
}
export interface NodeRuntimeHostOptions extends RuntimeCapabilities {
  readonly modules: RuntimeHost["modules"];
  readonly legacyShell?: LegacyShellBindingFactory &
    Readonly<{ kind: "server-direct" }>;
  readonly now?: () => number;
  readonly report?: (diagnostic: Diagnostic) => void;
}
export interface BrowserRuntimeHostOptions
  extends Omit<RuntimeCapabilities, "files" | "python" | "shell"> {
  readonly modules: RuntimeHost["modules"];
  readonly legacyShell?: LegacyShellBindingFactory &
    Readonly<{ kind: "browser-http" }>;
  readonly now?: () => number;
  readonly report?: (diagnostic: Diagnostic) => void;
}
export type BridgeSafeValue = SerializableValue | AssetRef | ImageRef;
export type BrowserLocalValue = BridgeSafeValue | TextureHandle;
