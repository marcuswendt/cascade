import {
  canConnectTypes,
  validateNodeDefinition,
  type CascadeAbortSignal,
  type CascadeType,
  type Diagnostic,
  type JsonValue,
  type NodeCapabilityName,
  type NodeDefinition,
  type NodeExecute,
  type ShellCapability,
  type ShellRunOptions,
  type TriggerEvent,
} from "@cascade/contracts";
import { CascadeRuntimeError } from "./error.js";
import { builtinNodeRegistrations } from "./builtins/index.js";
import { deserializeChannel, isEmptyChannel } from "./animation/channel.js";
import { PropAnimator, isBoundProp } from "./params/index.js";
import type { PropBinding } from "./params/index.js";
import { DEFAULT_FPS, MIN_FRAME } from "./expressions/time.js";
import { isGpuHost } from "./gpu.js";
import type {
  CascadeDocument,
  CascadeDocumentConnection,
  CascadeDocumentNode,
  CascadePreset,
  CascadeRuntime,
  ConnectionInspection,
  CreateRuntimeOptions,
  DefinitionNodeRegistration,
  GraphInspection,
  GraphState,
  LoadedCascadeGraph,
  NodeInspection,
  NodeRegistration,
  RunOptions,
  RunResult,
  RunTarget,
  RuntimeEvent,
  RuntimeCapabilities,
  RuntimeHost,
} from "./types.js";

interface RuntimeConnection extends ConnectionInspection {
  readonly kind: "data" | "trigger";
  readonly order: number;
  readonly variadicIndex?: number;
}
/**
 * Preflight codes that describe something other than "this graph cannot run
 * here", so `run` proceeds and a checker reports them as warnings.
 *
 * False positives are worse than blindness: a validator that cries wolf gets
 * ignored, and then it is no better than the one that saw nothing. So the line
 * is drawn at what the diagnostic is about.
 *
 * `preflight-environment` is about the checker's reach — a node saying
 * `runsOn: 'browser'` claims nothing about the CLI and is not defective
 * because somebody validated it from a terminal.
 *
 * `stray-params` is about the document — values were lost on the way in, which
 * is worth saying loudly and is not a reason to refuse to run: a graph with a
 * leftover `params` array runs perfectly well on its defaults, which is
 * precisely the problem.
 *
 * It was briefly an error, and Marcus reverted that on 2026-09-08 with the
 * evidence that decides it: while converting sixty-two nodes across four
 * sketches, every one of them was a mixed graph for most of the day, and as an
 * error an unconverted or half-converted sketch **stops validating at all** —
 * which is the one thing you need while converting it. The warning is the
 * conversion checklist; as an error it is a locked door on the room you are
 * working in.
 *
 * The fair case for the error was that the warning never fired, and that was
 * true: `check` bailed on dynamic modules before preflight ran. The fix for
 * that was the reporting *order*, not the severity.
 *
 * This set lives here rather than in the CLI because both paths read it, and a
 * duplicated copy is what let `validate` and `check` pass graphs `run` then
 * rejected.
 *
 * **It classifies a static check, and it is not the run gate.** Those are
 * different questions and conflating them was a real bug of mine, caught by
 * Codex's own comment on 2026-09-08: *execution is stricter.* A server run must
 * still refuse a browser node — you cannot cook WebGPU headlessly, so tolerating
 * it means executing and failing on an undefined capability instead of saying
 * why. What a static check downgrades is the *checker's reach*; what a run
 * tolerates is much narrower. See `RUN_TOLERATED_CODES`.
 */
export const PREFLIGHT_WARNING_CODES: ReadonlySet<string> = new Set([
  "runtime/preflight-environment",
  "runtime/stray-params",
  "runtime/unknown-props",
]);
/**
 * The only preflight code that does not stop a run.
 *
 * A stranded `params` value is a fact about the document: the graph cooks
 * perfectly well on its defaults, which is exactly the problem, and refusing to
 * run is the worse answer. Everything else in the preflight is a reason this
 * host cannot execute this graph — an environment mismatch and a missing
 * capability both mean the cook would fail partway with a worse message.
 */
const RUN_TOLERATED_CODES: ReadonlySet<string> = new Set([
  "runtime/stray-params",
  "runtime/unknown-props",
]);
interface RuntimeNode {
  readonly id: string;
  readonly moduleId: string;
  readonly parent?: string;
  readonly registration: DefinitionNodeRegistration;
  readonly definition: NodeDefinition;
  readonly inputs: Record<string, unknown>;
  /** Resolved values. A bound prop's entry is rewritten per frame. */
  readonly props: Record<string, unknown>;
  /**
   * The props that carry an expression or a keyframe channel, with the stored
   * value beside the binding.
   *
   * Kept rather than flattened, which is the reader defect this fixes:
   * `materialize` used to take `saved.value` and drop the rest, so a
   * definition-v1 prop's animation existed in the file, was parsed, and was
   * then discarded — offline the parameter was whatever number the last save
   * happened to catch it at.
   */
  readonly bindings: Record<string, PropBinding>;
  /**
   * Names this node stored under the legacy `params` key, which this runtime
   * does not read. Kept only so preflight can say so — see `strayParams`.
   */
  readonly strayParams: readonly string[];
  /** Names stored under `props` that the definition does not declare, so their
   *  values were dropped on the way in — see `unknownProps`. */
  readonly unknownProps: readonly string[];
  readonly outputs: Map<string, unknown>;
  execute?: NodeExecute;
}
interface QueuedTrigger {
  readonly nodeId: string;
  readonly inputName: string;
  readonly event: TriggerEvent;
}
interface ActiveRun {
  readonly runId: string;
  readonly signal: MutableAbortSignal;
  reason?: string;
}

class MutableAbortSignal implements CascadeAbortSignal {
  aborted = false;
  reason?: unknown;
  private readonly listeners = new Set<() => void>();
  constructor(private readonly report: (diagnostic: Diagnostic) => void) {}
  addEventListener(
    _type: "abort",
    listener: () => void,
    options?: { once?: boolean },
  ): void {
    if (this.aborted) this.call(listener);
    else if (options?.once) {
      const once = () => {
        this.listeners.delete(once);
        listener();
      };
      this.listeners.add(once);
    } else this.listeners.add(listener);
  }
  removeEventListener(_type: "abort", listener: () => void): void {
    this.listeners.delete(listener);
  }
  abort(reason?: unknown): void {
    if (this.aborted) return;
    this.aborted = true;
    this.reason = reason;
    for (const listener of [...this.listeners]) this.call(listener);
    this.listeners.clear();
  }
  private call(listener: () => void): void {
    try {
      listener();
    } catch (error) {
      this.report({
        phase: "run",
        code: "runtime/abort-listener-failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export function createRuntime(options: CreateRuntimeOptions): CascadeRuntime {
  return new Runtime(options.host, [...builtinNodeRegistrations, ...(options.nodes ?? [])]);
}

class Runtime implements CascadeRuntime {
  private readonly registrations = new Map<string, NodeRegistration>();
  private readonly graphs = new Set<Graph>();
  private sealed = false;
  private disposed = false;
  constructor(
    private readonly host: RuntimeHost,
    registrations: readonly NodeRegistration[],
  ) {
    for (const registration of registrations) this.registerNode(registration);
  }
  registerNode(registration: NodeRegistration): void {
    if (this.sealed || this.disposed)
      misuse(
        "runtime/registry-sealed",
        "Node registrations are sealed after the first load",
      );
    if (this.registrations.has(registration.moduleId))
      misuse(
        "runtime/duplicate-registration",
        `Duplicate registration ${registration.moduleId}`,
      );
    this.registrations.set(
      registration.moduleId,
      snapshotRegistration(registration),
    );
  }
  async load(document: CascadeDocument): Promise<LoadedCascadeGraph> {
    if (this.disposed) misuse("runtime/disposed", "Runtime is disposed");
    this.sealed = true;
    const nodes: RuntimeNode[] = [];
    const ids = new Set<string>();
    for (const authored of document.nodes) {
      if (!authored.id || ids.has(authored.id))
        misuse(
          "runtime/invalid-node-id",
          `Invalid or duplicate node id ${authored.id}`,
        );
      ids.add(authored.id);
      const moduleId = authored.module ?? authored.type;
      if (!moduleId)
        misuse("runtime/missing-module", `Node ${authored.id} has no module`);
      const resolved =
        this.registrations.get(moduleId) ??
        (await this.host.modules.resolve(moduleId));
      if (!resolved)
        misuse(
          "runtime/module-not-found",
          `Module ${moduleId} was not registered`,
        );
      if (resolved.moduleId !== moduleId)
        misuse(
          "runtime/module-identity",
          `Resolver returned ${resolved.moduleId} for ${moduleId}`,
        );
      const snapshot = snapshotRegistration(resolved);
      if (snapshot.kind === "legacy-dynamic")
        misuse(
          "runtime/legacy-adapter-required",
          `Legacy module ${moduleId} requires the explicit legacy adapter`,
        );
      const registration = specializeCoreRegistration(
        snapshot,
        authored,
        document.nodes,
      );
      const diagnostics = validateNodeDefinition(registration.definition);
      if (diagnostics.length)
        throw new CascadeRuntimeError(
          "runtime/definition-invalid",
          diagnostics,
        );
      nodes.push(materialize(authored, registration));
    }
    const byId = new Map(nodes.map((node) => [node.id, node]));
    validateHierarchy(nodes, byId);
    const connections = (document.connections ?? []).map((connection, index) =>
      materializeConnection(connection, index, byId),
    );
    validateCardinality(byId, connections);
    validateTopology(nodes, connections);
    const graph = new Graph(
      this.host,
      nodes,
      connections,
      () => this.graphs.delete(graph),
      document.annotations,
    );
    this.graphs.add(graph);
    return graph;
  }
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await Promise.all([...this.graphs].map((graph) => graph.dispose()));
    await this.host.legacyShell?.dispose?.();
  }
}

class Graph implements LoadedCascadeGraph {
  private graphState: GraphState = "ready";
  private readonly byId: Map<string, RuntimeNode>;
  private readonly dataConnectionsByInput: ReadonlyMap<
    string,
    readonly RuntimeConnection[]
  >;
  private readonly dataConnectionsByNode: ReadonlyMap<
    string,
    readonly RuntimeConnection[]
  >;
  private readonly connectedInputs: ReadonlySet<string>;
  private readonly connectedOutputs: ReadonlySet<string>;
  private readonly listeners = new Set<(event: RuntimeEvent) => void>();
  private readonly diagnostics: Diagnostic[] = [];
  private active?: ActiveRun;
  private activeRun?: Promise<RunResult>;
  private disposal?: Promise<void>;
  private runCounter = 0;
  private readonly authoredAnnotations: readonly Readonly<
    Record<string, unknown>
  >[];
  private readonly graphInputs: ReadonlyMap<string, RuntimeNode>;
  private readonly graphOutputs: ReadonlyMap<string, RuntimeNode>;
  /**
   * The graph's animated parameters, and the clock they resolve against.
   *
   * The clock is a value the caller sets per run (`run({ frame })`), never one
   * this graph reads: same graph plus same frame gives the same output, which
   * is the only reason a headless render can be trusted.
   */
  private readonly animator: PropAnimator<RuntimeNode>;
  private frame = MIN_FRAME;
  private fps = DEFAULT_FPS;
  constructor(
    private readonly host: RuntimeHost,
    private readonly nodes: readonly RuntimeNode[],
    private readonly connections: readonly RuntimeConnection[],
    private readonly onDispose: () => void,
    annotations: CascadeDocument["annotations"] = [],
  ) {
    this.byId = new Map(nodes.map((node) => [node.id, node]));
    const byInput = new Map<string, RuntimeConnection[]>();
    const byNode = new Map<string, RuntimeConnection[]>();
    const connectedInputs = new Set<string>();
    const connectedOutputs = new Set<string>();
    for (const connection of connections) {
      connectedInputs.add(
        `${connection.target.nodeId}\0${connection.target.inputName}`,
      );
      connectedOutputs.add(
        `${connection.source.nodeId}\0${connection.source.outputName}`,
      );
      if (connection.kind !== "data") continue;
      const inputKey = `${connection.target.nodeId}\0${connection.target.inputName}`;
      const inputConnections = byInput.get(inputKey) ?? [];
      inputConnections.push(connection);
      byInput.set(inputKey, inputConnections);
      const nodeConnections = byNode.get(connection.target.nodeId) ?? [];
      nodeConnections.push(connection);
      byNode.set(connection.target.nodeId, nodeConnections);
    }
    this.dataConnectionsByInput = new Map(
      [...byInput].map(([key, inputConnections]) => [
        key,
        Object.freeze(
          inputConnections.sort(
            (first, second) =>
              (first.variadicIndex ?? first.order) -
              (second.variadicIndex ?? second.order),
          ),
        ),
      ]),
    );
    this.dataConnectionsByNode = new Map(
      [...byNode].map(([key, nodeConnections]) => [
        key,
        Object.freeze(
          nodeConnections.sort((first, second) => first.order - second.order),
        ),
      ]),
    );
    this.connectedInputs = connectedInputs;
    this.connectedOutputs = connectedOutputs;
    this.graphInputs = graphBoundaries(nodes, "cascade.core.Input", "inputName");
    this.graphOutputs = graphBoundaries(nodes, "cascade.core.Output", "outputName");
    this.authoredAnnotations = Object.freeze(
      annotations.map((annotation) => snapshot(annotation)),
    );
    this.animator = new PropAnimator<RuntimeNode>({
      nodes,
      node: (id) => this.byId.get(id),
      inputNode: (node, index) => {
        const feeding = this.dataConnectionsByNode.get(node.id) ?? [];
        const source = feeding[index]?.source.nodeId;
        return (source ? this.byId.get(source) : undefined) ?? null;
      },
      // A failed expression has already fallen back to the stored value, so it
      // is a diagnostic rather than a stopped run — but it is never silent: a
      // parameter that quietly reverts is the hardest fault to see in a
      // hundred rendered frames.
      report: (nodeId, propName, error) =>
        this.reportDiagnostic({
          phase: "run",
          code: "runtime/expression-failed",
          message: `${nodeId}.${propName}: ${error}`,
          path: `${nodeId}.${propName}`,
        }),
    });
    this.animator.setFps(this.fps);
    this.animator.setFrame(this.frame);
    // Resolve once at load, so `inspect()` and a preset applied before any run
    // both see the parameter at the graph's own first frame rather than the
    // number that was last saved.
    this.animator.resolveAll();
  }
  get state(): GraphState {
    return this.graphState;
  }
  /**
   * Everything that would stop this host running the graph, without running
   * it: a node whose environment this host is not, a bridged node that cannot
   * be bridged, a declared capability this host does not install. Empty means
   * the graph clears the same gate `run` puts it through.
   */
  preflight(): readonly Diagnostic[] {
    return this.preflightDiagnostics(this.nodes);
  }
  inspect(): GraphInspection {
    const nodes: NodeInspection[] = this.nodes.map((node) => ({
      id: node.id,
      moduleId: node.moduleId,
      runsOn: node.definition.runsOn,
      ...(node.parent ? { parent: node.parent } : {}),
      inputs: Object.fromEntries(
        Object.entries(node.definition.inputs ?? {}).map(
          ([name, definition]) => [
            name,
            {
              kind: definition.kind,
              type: definition.kind === "trigger" ? "trigger" : definition.type,
              connected: this.connectedInputs.has(`${node.id}\0${name}`),
              ...(definition.kind === "data"
                ? { value: snapshot(node.inputs[name]) }
                : {}),
            },
          ],
        ),
      ),
      outputs: Object.fromEntries(
        Object.entries(node.definition.outputs ?? {}).map(
          ([name, definition]) => [
            name,
            {
              kind: definition.kind,
              type: definition.kind === "trigger" ? "trigger" : definition.type,
              connected: this.connectedOutputs.has(`${node.id}\0${name}`),
              ...(definition.kind === "data" && node.outputs.has(name)
                ? { value: snapshot(node.outputs.get(name)) }
                : {}),
            },
          ],
        ),
      ),
      props: Object.fromEntries(
        Object.entries(node.definition.props ?? {}).map(
          ([name, definition]) => [
            name,
            { type: definition.type, value: snapshot(node.props[name]) },
          ],
        ),
      ),
    }));
    return Object.freeze({
      state: this.graphState,
      interface: Object.freeze({
        inputs: boundaryInspection(this.graphInputs, "output"),
        outputs: boundaryInspection(this.graphOutputs, "output"),
      }),
      nodes: Object.freeze(nodes),
      connections: Object.freeze(
        this.connections.map((connection) =>
          Object.freeze({
            source: Object.freeze({ ...connection.source }),
            target: Object.freeze({ ...connection.target }),
          }),
        ),
      ),
      diagnostics: Object.freeze([...this.diagnostics]),
    });
  }
  async setInput(
    nodeId: string,
    inputName: string,
    value: unknown,
  ): Promise<void> {
    this.requireReady();
    const node = this.requireNode(nodeId);
    const definition = node.definition.inputs?.[inputName];
    if (!definition || definition.kind !== "data")
      misuse(
        "runtime/invalid-input",
        `${nodeId}.${inputName} is not a data input`,
      );
    node.inputs[inputName] = runtimeValue(
      value,
      definition.type,
      !("default" in definition),
      `${nodeId}.${inputName}`,
    );
  }
  setGraphInput(name: string, value: unknown): Promise<void> {
    const node = this.graphInputs.get(name);
    if (!node)
      return Promise.reject(runtimeError("runtime/graph-input-not-found", `Unknown graph input ${name}`));
    return this.setInput(node.id, "value", value);
  }
  async setProp(
    nodeId: string,
    propName: string,
    value: unknown,
  ): Promise<void> {
    this.requireReady();
    const node = this.requireNode(nodeId);
    if (isStructuralProp(node, propName))
      misuse(
        "runtime/structural-prop",
        `${nodeId}.${propName} is structural and requires a graph reload`,
      );
    if (!node.definition.props?.[propName])
      misuse("runtime/invalid-prop", `${nodeId}.${propName} is not a prop`);
    const resolved = runtimeValue(
      value,
      node.definition.props[propName].type,
      false,
      `${nodeId}.${propName}`,
    );
    node.props[propName] = resolved;
    this.rebind(node, propName, resolved);
  }
  /**
   * Keep a bound prop's STORED value in step with a direct write.
   *
   * A channel or an expression still wins on the next resolve — setting a
   * keyed parameter's value does not delete its keys, in Studio or here — but
   * the value written is the one the parameter falls back to, so dropping it
   * would make a later `clearChannel` reinstate a number nobody chose.
   */
  private rebind(node: RuntimeNode, propName: string, value: unknown): void {
    const binding = node.bindings[propName];
    if (binding) node.bindings[propName] = { ...binding, value };
  }
  private reportDiagnostic(diagnostic: Diagnostic): void {
    this.diagnostics.push(diagnostic);
    this.emit({ type: "diagnostic", diagnostic });
  }
  async applyPreset(preset: CascadePreset): Promise<void> {
    this.requireReady();
    if (preset.version !== 1)
      misuse("runtime/invalid-preset", "Preset version must be 1");
    const inputDrafts: Array<readonly [RuntimeNode, string, unknown]> = [];
    const propDrafts: Array<readonly [RuntimeNode, string, unknown]> = [];
    for (const [nodeId, values] of Object.entries(preset.nodes)) {
      const node = this.requireNode(nodeId);
      for (const [name, value] of Object.entries(values.inputs ?? {})) {
        const definition = node.definition.inputs?.[name];
        if (!definition || definition.kind !== "data")
          misuse(
            "runtime/invalid-input",
            `${nodeId}.${name} is not a data input`,
          );
        inputDrafts.push([
          node,
          name,
          runtimeValue(
            value,
            definition.type,
            !("default" in definition),
            `${nodeId}.${name}`,
          ),
        ]);
      }
      for (const [name, value] of Object.entries(values.props ?? {})) {
        const definition = node.definition.props?.[name];
        if (!definition)
          misuse("runtime/invalid-prop", `${nodeId}.${name} is not a prop`);
        if (isStructuralProp(node, name))
          misuse(
            "runtime/structural-prop",
            `${nodeId}.${name} is structural and cannot be changed by a preset`,
          );
        propDrafts.push([
          node,
          name,
          runtimeValue(value, definition.type, false, `${nodeId}.${name}`),
        ]);
      }
    }
    for (const [node, name, value] of inputDrafts) node.inputs[name] = value;
    for (const [node, name, value] of propDrafts) {
      node.props[name] = value;
      this.rebind(node, name, value);
    }
  }
  /**
   * The frame this graph is cooking at, and the rate frames are counted in.
   *
   * Separate from `run` so a caller can scrub without cooking — and so that
   * `setFrame` then `inspect()` reports a keyed parameter at that frame, which
   * is what a panel needs and what `run` alone cannot give it.
   */
  setFrame(frame: number): void {
    if (!Number.isFinite(frame)) return;
    this.frame = Math.max(MIN_FRAME, frame);
    this.animator.setFrame(this.frame);
    this.animator.resolveAll();
  }
  setFps(fps: number): void {
    if (!Number.isFinite(fps)) return;
    this.fps = Math.max(1, fps);
    this.animator.setFps(this.fps);
    this.animator.resolveAll();
  }
  getFrame(): number {
    return this.frame;
  }
  getFps(): number {
    return this.fps;
  }
  run(options: RunOptions = {}): Promise<RunResult> {
    // The frame belongs to the run, not to the graph's history: a render loop
    // states which frame it wants and gets exactly that, with no dependence on
    // what the previous run left behind.
    if (options.fps !== undefined) this.setFps(options.fps);
    if (options.frame !== undefined) this.setFrame(options.frame);
    // Every bound parameter, resolved before any node executes — so a node
    // still receives a plain number and never reads a clock.
    else this.animator.resolveAll();
    return this.trackRun(
      options.target ?? { kind: "all" },
      options.signal,
      options.runId,
    );
  }
  trigger(
    nodeId: string,
    inputName: string,
    payload?: JsonValue,
    options: Readonly<{ signal?: CascadeAbortSignal; runId?: string }> = {},
  ): Promise<RunResult> {
    const node = this.requireNode(nodeId);
    if (node.definition.inputs?.[inputName]?.kind !== "trigger")
      return Promise.reject(
        runtimeError(
          "runtime/invalid-trigger",
          `${nodeId}.${inputName} is not a trigger input`,
        ),
      );
    return this.trackRun(
      { kind: "node", nodeId },
      options.signal,
      options.runId,
      { nodeId, inputName, payload },
    );
  }
  cancel(reason = "Cancelled"): void {
    if (!this.active || this.active.signal.aborted) return;
    this.graphState = "cancelling";
    this.active.reason = reason;
    this.active.signal.abort(reason);
    this.emit({ type: "run:cancel", runId: this.active.runId, reason });
  }
  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  getOutput(nodeId: string, outputName: string): unknown {
    return snapshot(this.requireNode(nodeId).outputs.get(outputName));
  }
  getGraphOutput(name: string): unknown {
    const node = this.graphOutputs.get(name);
    if (!node)
      misuse("runtime/graph-output-not-found", `Unknown graph output ${name}`);
    return this.getOutput(node.id, "output");
  }
  getOutputs(nodeId: string): ReadonlyMap<string, unknown> {
    return immutableMap(
      [...this.requireNode(nodeId).outputs].map(([name, value]) => [
        name,
        snapshot(value),
      ]),
    );
  }
  dispose(): Promise<void> {
    this.disposal ??= this.performDispose();
    return this.disposal;
  }

  private trackRun(
    target: RunTarget,
    signal?: CascadeAbortSignal,
    runId?: string,
    injection?: { nodeId: string; inputName: string; payload?: JsonValue },
  ): Promise<RunResult> {
    const running = this.executeRun(target, signal, runId, injection);
    this.activeRun = running;
    const clear = () => {
      if (this.activeRun === running) this.activeRun = undefined;
    };
    void running.then(clear, clear);
    return running;
  }

  private async performDispose(): Promise<void> {
    if (this.graphState === "disposed") return;
    this.cancel("Graph disposed");
    try {
      await this.activeRun;
    } catch {
      // API/preflight failures are already exposed to the run caller.
    }
    this.graphState = "disposed";
    this.listeners.clear();
    this.onDispose();
  }

  private async executeRun(
    target: RunTarget,
    externalSignal?: CascadeAbortSignal,
    requestedId?: string,
    injection?: { nodeId: string; inputName: string; payload?: JsonValue },
  ): Promise<RunResult> {
    this.requireReady();
    const runId = requestedId ?? `run-${this.runCounter++}`;
    const signal = new MutableAbortSignal((diagnostic) =>
      this.host.report(diagnostic),
    );
    this.active = { runId, signal };
    this.graphState = "running";
    const startedAt = this.host.now();
    const runDiagnostics: Diagnostic[] = [];
    this.emit({ type: "run:start", runId, target });
    const relay = () =>
      this.cancel(
        typeof externalSignal?.reason === "string"
          ? externalSignal.reason
          : "Cancelled by external signal",
      );
    if (externalSignal?.aborted) relay();
    else externalSignal?.addEventListener("abort", relay, { once: true });
    let executionStarted = false;
    try {
      const selection = injection
        ? {
            reachable: this.triggerReachable(injection.nodeId),
            initial: this.triggerDataAncestors(injection.nodeId),
          }
        : this.runSelection(target);
      const { reachable, initial } = selection;
      this.assertPreflight(reachable);
      if (!signal.aborted)
        await Promise.all(
          reachable
            .filter((node) => !this.isRemote(node))
            .map((node) => this.loadExecute(node)),
        );
      executionStarted = true;
      const queue: QueuedTrigger[] = [];
      let sequence = 0;
      const enqueue = (
        nodeId: string,
        inputName: string,
        payload: JsonValue | undefined,
        source: TriggerEvent["source"],
      ) => {
        const event = snapshot<TriggerEvent>({
          id: `${runId}:${sequence}`,
          runId,
          sequence: sequence++,
          ...(payload === undefined
            ? {}
            : { payload: snapshot(payload) as JsonValue }),
          source,
        });
        queue.push({ nodeId, inputName, event });
        this.emit({ type: "trigger:queued", runId, nodeId, inputName, event });
      };
      const ordered = topological(this.nodes, this.connections).filter((node) =>
        initial.includes(node),
      );
      for (const node of ordered) {
        if (signal.aborted) break;
        await this.executeNode(node, runId, signal, {}, enqueue);
      }
      if (injection && !signal.aborted)
        enqueue(injection.nodeId, injection.inputName, injection.payload, {
          kind: "external",
        });
      while (queue.length && !signal.aborted) {
        const next = queue.shift()!;
        this.emit({
          type: "trigger:delivered",
          runId,
          nodeId: next.nodeId,
          inputName: next.inputName,
          event: next.event,
        });
        await this.executeNode(
          this.requireNode(next.nodeId),
          runId,
          signal,
          { [next.inputName]: next.event },
          enqueue,
        );
      }
      return this.finish(
        runId,
        signal.aborted ? "cancelled" : "completed",
        startedAt,
        runDiagnostics,
      );
    } catch (error) {
      if (!executionStarted && error instanceof CascadeRuntimeError)
        throw error;
      const diagnostic: Diagnostic = {
        phase: "run",
        code: "runtime/execution-failed",
        message: error instanceof Error ? error.message : String(error),
      };
      runDiagnostics.push(diagnostic);
      this.diagnostics.push(diagnostic);
      this.emit({ type: "diagnostic", runId, diagnostic });
      return this.finish(
        runId,
        signal.aborted ? "cancelled" : "failed",
        startedAt,
        runDiagnostics,
      );
    } finally {
      externalSignal?.removeEventListener("abort", relay);
      if (!this.isDisposed()) this.graphState = "ready";
      this.active = undefined;
    }
  }
  private async executeNode(
    node: RuntimeNode,
    runId: string,
    signal: MutableAbortSignal,
    triggers: Record<string, TriggerEvent>,
    enqueue: (
      nodeId: string,
      inputName: string,
      payload: JsonValue | undefined,
      source: TriggerEvent["source"],
    ) => void,
  ): Promise<void> {
    this.emit({ type: "node:start", runId, nodeId: node.id });
    const inputs = Object.fromEntries(
      Object.entries(node.definition.inputs ?? {}).map(([name, definition]) => {
        if (definition.kind === "trigger") return [name, triggers[name]];
        if (
          node.moduleId === "cascade.core.Input" &&
          name === "value" &&
          node.parent
        ) {
          const parent = this.requireNode(node.parent);
          const index = integerProp(node.props.inputIndex);
          return [name, this.dataInputValue(parent, `input_${index}`)];
        }
        const connections =
          this.dataConnectionsByInput.get(`${node.id}\0${name}`) ?? [];
        if (definition.variadic) {
          const values = connections.map((connection) =>
            this.requireNode(connection.source.nodeId).outputs.get(
              connection.source.outputName,
            ),
          );
          if (!values.length && node.inputs[name] !== undefined)
            values.push(node.inputs[name]);
          return [name, Object.freeze(values)];
        }
        const connection = connections[0];
        return [
          name,
          connection
            ? this.requireNode(connection.source.nodeId).outputs.get(
                connection.source.outputName,
              )
            : node.inputs[name],
        ];
      }),
    );
    Object.freeze(inputs);
    if (this.isRemote(node)) {
      const bridge = this.host.capabilities.serverBridge;
      if (!bridge)
        throw runtimeError(
          "runtime/bridge-missing",
          `No server bridge for ${node.moduleId}`,
        );
      const progress = {
        report: (event: {
          progress?: number;
          message?: string;
          detail?: JsonValue;
        }) =>
          this.emit({
            type: "node:progress",
            runId,
            nodeId: node.id,
            ...event,
          }),
      };
      const response = await bridge.execute(
        {
          moduleId: node.moduleId,
          nodeId: node.id,
          inputs: inputs as never,
          props: Object.freeze({ ...node.props }) as never,
        },
        { signal, progress },
      );
      for (const diagnostic of response.diagnostics) {
        this.diagnostics.push(diagnostic);
        this.emit({ type: "diagnostic", runId, diagnostic });
      }
      for (const name of Object.keys(node.definition.outputs ?? {}))
        if (name in response.outputs) {
          const definition = node.definition.outputs?.[name];
          if (!definition || definition.kind !== "data") continue;
          const value = runtimeValue(
            response.outputs[name],
            definition.type,
            false,
            `${node.id}.${name}`,
          );
          node.outputs.set(name, value);
          this.emit({
            type: "node:output",
            runId,
            nodeId: node.id,
            outputName: name,
            value,
          });
        }
      this.emit({ type: "node:complete", runId, nodeId: node.id });
      return;
    }
    if (!node.execute)
      throw runtimeError(
        "runtime/executor-missing",
        `Executor ${node.moduleId} was not loaded`,
      );
    const pendingData = new Map<string, unknown>();
    const pendingTriggers: { name: string; payload?: JsonValue }[] = [];
    const outputs = Object.fromEntries(
      Object.entries(node.definition.outputs ?? {}).map(
        ([name, definition]) => [
          name,
          definition.kind === "trigger"
            ? {
                trigger: (payload?: JsonValue) =>
                  pendingTriggers.push({
                    name,
                    ...(payload === undefined
                      ? {}
                      : { payload: snapshot(payload) as JsonValue }),
                  }),
              }
            : {
                set: (value: unknown) =>
                  pendingData.set(
                    name,
                    runtimeValue(
                      value,
                      definition.type,
                      false,
                      `${node.id}.${name}`,
                    ),
                  ),
              },
        ],
      ),
    );
    const capabilityEntries: [NodeCapabilityName, unknown][] = [];
    for (const name of node.definition.capabilities ?? []) {
      const installed = this.host.capabilities[name];
      if (name === "gpu" && isGpuHost(installed)) {
        await installed.ensure();
        capabilityEntries.push([name, installed.forNode(node.id)]);
      } else {
        capabilityEntries.push([
          name,
          name === "shell"
            ? bindShellToRun(this.host.capabilities.shell, signal)
            : installed,
        ]);
      }
    }
    const capabilities = Object.freeze(Object.fromEntries(capabilityEntries));
    const props = Object.freeze({ ...node.props });
    const progress = {
      report: (event: {
        progress?: number;
        message?: string;
        detail?: JsonValue;
      }) =>
        this.emit({ type: "node:progress", runId, nodeId: node.id, ...event }),
    };
    await node.execute({
      nodeId: node.id,
      inputs,
      outputs,
      props,
      capabilities,
      signal,
      progress,
    } as never);
    if (signal.aborted) return;
    if (node.moduleId === "cascade.core.Subnet") {
      for (const child of this.nodes) {
        if (
          child.parent !== node.id ||
          child.moduleId !== "cascade.core.Output"
        ) continue;
        const name = `output_${integerProp(child.props.outputIndex)}`;
        if (node.definition.outputs?.[name]?.kind === "data")
          pendingData.set(name, child.outputs.get("output"));
      }
    }
    for (const name of Object.keys(node.definition.outputs ?? {}))
      if (pendingData.has(name)) {
        const value = pendingData.get(name);
        node.outputs.set(name, value);
        this.emit({
          type: "node:output",
          runId,
          nodeId: node.id,
          outputName: name,
          value: snapshot(value),
        });
      }
    for (const emitted of pendingTriggers)
      for (const connection of this.connections) {
        if (
          connection.kind === "trigger" &&
          connection.source.nodeId === node.id &&
          connection.source.outputName === emitted.name
        )
          enqueue(
            connection.target.nodeId,
            connection.target.inputName,
            emitted.payload,
            { nodeId: node.id, outputName: emitted.name },
          );
      }
    this.emit({ type: "node:complete", runId, nodeId: node.id });
  }
  /**
   * Every reason this host cannot run these nodes, collected rather than
   * thrown. `assertPreflight` is the run path and raises the first of them;
   * `preflight()` is the static path and hands the whole list to a caller that
   * is not executing anything.
   *
   * There is deliberately one implementation. `validate` and `check` used to
   * answer "will this graph run?" without ever consulting a host, so a node
   * declaring a capability nobody installs passed both and then failed here —
   * the two commands could not see the fault they exist to report. Any second
   * copy of these rules would drift back into that.
   */
  private preflightDiagnostics(
    nodes: readonly RuntimeNode[],
  ): readonly Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const push = (code: string, nodeId: string, message: string) =>
      diagnostics.push({ phase: "preflight", code, path: nodeId, message });
    for (const node of nodes) {
      if (node.unknownProps.length)
        push(
          "runtime/unknown-props",
          node.id,
          `${node.moduleId} stores ${node.unknownProps.join(", ")} under "props", and its definition declares no such prop — ${node.unknownProps.length === 1 ? "that value was" : "those values were"} dropped on load. A prop renamed or removed leaves its value behind; a name that never existed is a typo`,
        );
      if (node.strayParams.length)
        push(
          "runtime/stray-params",
          node.id,
          `${node.moduleId} stores ${node.strayParams.join(", ")} under "params", which this runtime does not read — move ${node.strayParams.length === 1 ? "it" : "them"} to "props" or "inputs", whichever the definition declares, or the ${node.strayParams.length === 1 ? "value is" : "values are"} silently the default`,
        );
      const remote = this.isRemote(node);
      const locationWorks =
        node.definition.runsOn === "portable" ||
        node.definition.runsOn === this.host.environment ||
        remote;
      if (!locationWorks) {
        push(
          "runtime/preflight-environment",
          node.id,
          `${node.moduleId} requires ${node.definition.runsOn}`,
        );
        continue;
      }
      if (remote) {
        const hasTriggers = [
          ...Object.values(node.definition.inputs ?? {}),
          ...Object.values(node.definition.outputs ?? {}),
        ].some((port) => port.kind === "trigger");
        if (hasTriggers)
          push(
            "runtime/preflight-bridge-trigger",
            node.id,
            `${node.moduleId} cannot send triggers over the server bridge`,
          );
        const hasTexture = [
          ...Object.values(node.definition.inputs ?? {}),
          ...Object.values(node.definition.outputs ?? {}),
        ].some((port) => port.kind === "data" && port.type === "texture");
        if (hasTexture)
          push(
            "runtime/preflight-bridge-texture",
            node.id,
            `${node.moduleId} cannot send textures over the server bridge`,
          );
      } else
        for (const capability of node.definition.capabilities ?? [])
          if (!this.host.capabilities[capability as NodeCapabilityName])
            push(
              "runtime/missing-capability",
              node.id,
              `Missing capability ${capability} for ${node.moduleId} (node ${node.id}) — the ${this.host.environment} host ${this.hostProvides()}`,
            );
    }
    return diagnostics;
  }
  /**
   * What the host actually installed, asked of the host rather than written
   * down. `serverBridge` is left out: it is how a node runs somewhere else,
   * not a capability a definition can declare.
   */
  private hostProvides(): string {
    const supplied = (
      Object.keys(this.host.capabilities) as (keyof RuntimeCapabilities)[]
    )
      .filter((name) => name !== "serverBridge" && !!this.host.capabilities[name])
      .sort();
    return supplied.length
      ? `provides ${supplied.join(", ")}`
      : `provides no capabilities`;
  }
  private assertPreflight(nodes: readonly RuntimeNode[]): void {
    const [first] = this.preflightDiagnostics(nodes).filter(
      (diagnostic) => !RUN_TOLERATED_CODES.has(diagnostic.code),
    );
    if (first) throw new CascadeRuntimeError(first.code, [first]);
  }
  private isRemote(node: RuntimeNode): boolean {
    return (
      this.host.environment === "browser" &&
      node.definition.runsOn === "server" &&
      !!this.host.capabilities.serverBridge
    );
  }
  private async loadExecute(node: RuntimeNode): Promise<void> {
    node.execute ??= (await node.registration.loadExecute(
      this.host.environment,
    )) as NodeExecute;
  }
  private runSelection(target: RunTarget): {
    readonly reachable: RuntimeNode[];
    readonly initial: RuntimeNode[];
  } {
    if (target.kind === "all") {
      const gatedDataDescendants = this.gatedDataDescendants();
      const initial = this.nodes.filter(
        (node) => !isGated(node) && !gatedDataDescendants.has(node.id),
      );
      const ids = new Set(initial.map((node) => node.id));
      let changed = true;
      while (changed) {
        changed = false;
        for (const connection of this.connections) {
          if (
            connection.kind === "trigger" &&
            ids.has(connection.source.nodeId) &&
            !ids.has(connection.target.nodeId)
          ) {
            ids.add(connection.target.nodeId);
            for (const dependency of this.dataClosure(connection.target.nodeId))
              ids.add(dependency.id);
            changed = true;
          }
        }
      }
      return {
        initial,
        reachable: this.nodes.filter((node) => ids.has(node.id)),
      };
    }
    const root = this.requireNode(target.nodeId);
    if (
      target.kind === "output" &&
      !root.definition.outputs?.[target.outputName]
    )
      misuse(
        "runtime/invalid-target",
        `Unknown output ${target.nodeId}.${target.outputName}`,
      );
    const reachable = this.dataClosure(root.id);
    if (reachable.some(isGated))
      misuse(
        "runtime/invalid-target",
        `Target ${root.id} depends on a trigger event`,
      );
    return { reachable, initial: reachable };
  }
  private dataClosure(nodeId: string): RuntimeNode[] {
    const ids = new Set([nodeId]);
    const dependencies = dataDependencies(this.nodes, this.connections);
    let changed = true;
    while (changed) {
      changed = false;
      for (const dependency of dependencies)
        if (
          ids.has(dependency.targetId) &&
          !ids.has(dependency.sourceId)
        ) {
          ids.add(dependency.sourceId);
          changed = true;
        }
    }
    return this.nodes.filter((node) => ids.has(node.id));
  }
  private gatedDataDescendants(): ReadonlySet<string> {
    const outgoing = new Map<string, string[]>();
    for (const dependency of dataDependencies(this.nodes, this.connections)) {
      const targets = outgoing.get(dependency.sourceId) ?? [];
      targets.push(dependency.targetId);
      outgoing.set(dependency.sourceId, targets);
    }
    const queue = this.nodes.filter(isGated).map((node) => node.id);
    const descendants = new Set(queue);
    let queueIndex = 0;
    while (queueIndex < queue.length) {
      for (const targetId of outgoing.get(queue[queueIndex++]) ?? []) {
        if (descendants.has(targetId)) continue;
        descendants.add(targetId);
        queue.push(targetId);
      }
    }
    return descendants;
  }
  private triggerDataAncestors(nodeId: string): RuntimeNode[] {
    const dependencies = this.dataClosure(nodeId).filter(
      (node) => node.id !== nodeId,
    );
    if (dependencies.some(isGated))
      misuse(
        "runtime/invalid-target",
        `Trigger target ${nodeId} depends on another trigger event`,
      );
    return dependencies;
  }
  private triggerReachable(nodeId: string): RuntimeNode[] {
    const ids = new Set([this.requireNode(nodeId).id]);
    const dependencies = dataDependencies(this.nodes, this.connections);
    let changed = true;
    while (changed) {
      changed = false;
      for (const connection of this.connections) {
        if (
          connection.kind === "trigger" &&
          ids.has(connection.source.nodeId) &&
          !ids.has(connection.target.nodeId)
        ) {
          ids.add(connection.target.nodeId);
          changed = true;
        }
      }
      for (const dependency of dependencies)
        if (
          ids.has(dependency.targetId) &&
          !ids.has(dependency.sourceId)
        ) {
          ids.add(dependency.sourceId);
          changed = true;
        }
    }
    return this.nodes.filter((node) => ids.has(node.id));
  }
  private finish(
    runId: string,
    status: RunResult["status"],
    startedAt: number,
    diagnostics: readonly Diagnostic[],
  ): RunResult {
    const finishedAt = this.host.now();
    const outputs = immutableMap(
      this.nodes.map((node) => [node.id, this.getOutputs(node.id)]),
    );
    const result: RunResult = Object.freeze({
      runId,
      status,
      outputs,
      diagnostics: Object.freeze([...diagnostics]),
      timings: Object.freeze({
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt,
      }),
    });
    this.emit({ type: "run:complete", result });
    return result;
  }
  private emit(event: RuntimeEvent): void {
    for (const listener of [...this.listeners])
      try {
        listener(event);
      } catch (error) {
        this.host.report({
          phase: "event",
          code: "runtime/listener-failed",
          message: error instanceof Error ? error.message : String(error),
        });
      }
  }
  private requireReady(): void {
    if (this.graphState !== "ready")
      misuse("runtime/invalid-state", `Graph is ${this.graphState}`);
  }
  private isDisposed(): boolean {
    return this.graphState === "disposed";
  }
  private requireNode(id: string): RuntimeNode {
    const node = this.byId.get(id);
    if (!node) misuse("runtime/node-not-found", `Unknown node ${id}`);
    return node;
  }
  private dataInputValue(node: RuntimeNode, inputName: string): unknown {
    const connection = this.connections.find(
      (item) =>
        item.kind === "data" &&
        item.target.nodeId === node.id &&
        item.target.inputName === inputName,
    );
    return connection
      ? this.requireNode(connection.source.nodeId).outputs.get(
          connection.source.outputName,
        )
      : node.inputs[inputName];
  }
}

function bindShellToRun(
  shell: ShellCapability | undefined,
  runSignal: CascadeAbortSignal,
): ShellCapability | undefined {
  if (!shell) return undefined;
  const options = (value?: ShellRunOptions): ShellRunOptions => ({
    ...value,
    signal: combineAbortSignals(runSignal, value?.signal),
  });
  return Object.freeze({
    run: (command: string, args?: readonly string[], value?: ShellRunOptions) =>
      shell.run(command, args, options(value)),
    runJson: <T = unknown>(command: string, args?: readonly string[], value?: ShellRunOptions) =>
      shell.runJson<T>(command, args, options(value)),
  });
}

function combineAbortSignals(
  first: CascadeAbortSignal,
  second?: CascadeAbortSignal,
): CascadeAbortSignal {
  if (!second || first === second) return first;
  const wrappers = new Map<() => void, () => void>();
  return {
    get aborted() { return first.aborted || second.aborted; },
    get reason() { return first.aborted ? first.reason : second.reason; },
    addEventListener(_type, listener, options) {
      if (first.aborted || second.aborted) {
        listener();
        return;
      }
      const wrapped = () => {
        first.removeEventListener("abort", wrapped);
        second.removeEventListener("abort", wrapped);
        wrappers.delete(listener);
        listener();
      };
      wrappers.set(listener, wrapped);
      first.addEventListener("abort", wrapped, options);
      second.addEventListener("abort", wrapped, options);
    },
    removeEventListener(_type, listener) {
      const wrapped = wrappers.get(listener);
      if (!wrapped) return;
      first.removeEventListener("abort", wrapped);
      second.removeEventListener("abort", wrapped);
      wrappers.delete(listener);
    },
  };
}

function materialize(
  authored: CascadeDocumentNode,
  registration: DefinitionNodeRegistration,
): RuntimeNode {
  const inputs: Record<string, unknown> = {};
  const props: Record<string, unknown> = {};
  for (const [name, definition] of Object.entries(
    registration.definition.inputs ?? {},
  ))
    if (definition.kind === "data" && "default" in definition)
      inputs[name] = runtimeValue(
        definition.default,
        definition.type,
        false,
        `${authored.id}.${name}`,
      );
  if (Array.isArray(authored.inputs))
    for (const saved of authored.inputs) {
      const definition = registration.definition.inputs?.[saved.name];
      if (definition?.kind === "data") {
        inputs[saved.name] = runtimeValue(
          "defaultValue" in saved ? saved.defaultValue : saved.value,
          definition.type,
          !("default" in definition),
          `${authored.id}.${saved.name}`,
        );
      }
    }
  else if (authored.inputs)
    for (const [name, saved] of Object.entries(authored.inputs)) {
      const definition = registration.definition.inputs?.[name];
      if (definition?.kind === "data")
        inputs[name] = runtimeValue(
          saved,
          definition.type,
          !("default" in definition),
          `${authored.id}.${name}`,
        );
    }
  for (const [name, definition] of Object.entries(
    registration.definition.props ?? {},
  ))
    props[name] = runtimeValue(
      definition.default,
      definition.type,
      false,
      `${authored.id}.${name}`,
    );
  /**
   * `props` is a map and `params` was a list, and a migration that changes the
   * key without changing the shape leaves an array here.
   *
   * Fatal, and the reason is what it costs: `Object.entries` of an array gives
   * keys `"0"`, `"1"`, which match no declared prop, so **every authored value
   * is dropped and every signal stays green.** Measured on 2026-09-08 —
   * preflight empty, the prop back at its default, `cascade run` reporting
   * `completed`. `cloud-plots` rendered a whole picture against no moment and
   * was reported as working on the strength of an exit code.
   *
   * An error rather than a warning, unlike a leftover under `params`: that is a
   * real state an unconverted sketch is legitimately in and must keep
   * validating, whereas `props` as an array is never valid — the schema
   * declares a record — and nothing passes through it on the way to being
   * right. Same reasoning as `definition/re-exported`.
   */
  if (Array.isArray(authored.props))
    misuse(
      "runtime/props-not-a-map",
      `Node ${authored.id} stores props as a list. "props" is a map of name to value; "params" was the list. Every value in it is being dropped, silently, and the graph would run on its defaults`,
    );

  const bindings: Record<string, PropBinding> = {};
  // A declared default expression, applied only where the document stored
  // nothing at all for the prop. The loop below then runs over what *was*
  // stored, so an authored value or an authored expression overwrites this —
  // which is the whole contract: a default expression is a default, and a file
  // that saved a plain number keeps its number rather than quietly animating.
  const storedProps = authored.props ?? {};
  for (const [name, definition] of Object.entries(
    registration.definition.props ?? {},
  )) {
    if (!definition.expression || name in storedProps) continue;
    bindings[name] = {
      value: props[name],
      expression: definition.expression,
    };
  }
  for (const [name, saved] of Object.entries(storedProps)) {
    const definition = registration.definition.props?.[name];
    if (!definition) continue;
    // `{ value, expression?, channel? }` — the object form declared in
    // contracts/animation.ts. A bare value is the same prop with nothing more
    // to say, which is what every older file on disk contains.
    const object = saved && typeof saved === "object" && "value" in saved
      ? (saved as { value: unknown; expression?: unknown; channel?: unknown })
      : null;
    const value = runtimeValue(
      object ? object.value : saved,
      definition.type,
      false,
      `${authored.id}.${name}`,
    );
    props[name] = value;
    // A stored plain value is an author's decision and beats the declared
    // default expression, so any binding seeded above has to go.
    if (!object) {
      delete bindings[name];
      continue;
    }
    const channel = deserializeChannel(object.channel);
    const expression = typeof object.expression === "string" && object.expression
      ? object.expression
      : undefined;
    const binding: PropBinding = {
      value,
      ...(expression ? { expression } : {}),
      ...(isEmptyChannel(channel) ? {} : { channel }),
    };
    // Only a prop that actually carries something, so `animated` stays a real
    // question and an unanimated graph pays nothing for this.
    if (isBoundProp(binding)) bindings[name] = binding;
  }
  return {
    id: authored.id,
    moduleId: registration.moduleId,
    ...(authored.parent ? { parent: authored.parent } : {}),
    registration,
    definition: registration.definition,
    inputs,
    props,
    bindings,
    strayParams: strayParams(authored, registration),
    unknownProps: unknownProps(authored, registration),
    outputs: new Map(),
  };
}

/**
 * The names a document stored under `params` that this runtime will not read.
 *
 * Nothing above consults `params`: the loops that fill `inputs` and `props`
 * read the definition and then the document's own `inputs` and `props`, so a
 * value left in `params` is dropped without a word and the parameter keeps its
 * default. That is not a hypothetical — on `cascade-logo` it put a seed back to
 * 7 and two rasterizers back to 1024, so three nodes wrote one file and the
 * drawing changed, with every command still reporting success.
 *
 * **Inputs count, not just props.** The first version of this checked props
 * alone and so was blind to exactly the case the conversions produce most: a
 * parameter another node drives has to be declared as an `inputs` entry,
 * because a v1 prop cannot be promoted to a pin. `field-logo`'s `angle` is one,
 * and a negative control over the pre-migration document named five nodes and
 * missed that one.
 *
 * Only names the definition actually declares are reported. A leftover key
 * naming nothing is a different fault, and reporting it would make this fire on
 * documents where no value was lost.
 */
/**
 * Names stored under `props` that the definition does not declare.
 *
 * The mirror of `strayParams`, and the gap that one had: it asks *is anything
 * still under the old key*, which is blind to *did what arrived under the new
 * key arrive in the right form*. One is a leftover, the other is a botched
 * move, and the second is worse because it looks finished.
 *
 * A warning rather than an error, because unlike an array container this is a
 * state a real document reaches honestly: a prop renamed or removed from a
 * definition leaves its value behind, and the graph runs on the defaults. Same
 * class as a leftover under `params`, and the same severity for the same
 * reason — a sketch mid-conversion must keep validating.
 */
function unknownProps(
  authored: CascadeDocumentNode,
  registration: DefinitionNodeRegistration,
): readonly string[] {
  const props = authored.props;
  if (!props || Array.isArray(props)) return [];
  const declared = registration.definition.props ?? {};
  return Object.keys(props).filter((name) => !(name in declared));
}

function strayParams(
  authored: CascadeDocumentNode,
  registration: DefinitionNodeRegistration,
): readonly string[] {
  const definition = registration.definition;
  const declared = new Set([
    ...Object.keys(definition.props ?? {}),
    ...Object.keys(definition.inputs ?? {}),
  ]);
  const names = Array.isArray(authored.params)
    ? authored.params.map((saved) => saved?.name)
    : Object.keys(authored.params ?? {});
  return names.filter(
    (name): name is string => typeof name === "string" && declared.has(name),
  );
}

function specializeCoreRegistration(
  registration: DefinitionNodeRegistration,
  authored: CascadeDocumentNode,
  nodes: readonly CascadeDocumentNode[],
): DefinitionNodeRegistration {
  if (
    registration.moduleId === "cascade.core.Input" ||
    registration.moduleId === "cascade.core.Output"
  ) {
    const type = savedDataType(authored.props?.dataType);
    const inputName = registration.moduleId === "cascade.core.Input" ? "value" : "input";
    return Object.freeze({
      ...registration,
      definition: Object.freeze({
        ...registration.definition,
        inputs: Object.freeze({
          [inputName]: dataInputDefinition(type),
        }),
        outputs: Object.freeze({
          output: { kind: "data", type },
        }),
      }) as NodeDefinition,
    });
  }
  if (registration.moduleId !== "cascade.core.Subnet") return registration;
  const children = nodes.filter((candidate) => candidate.parent === authored.id);
  const inputs = indexedBoundaryPorts(children, "cascade.core.Input", "inputIndex", "input");
  const outputs = indexedBoundaryPorts(children, "cascade.core.Output", "outputIndex", "output");
  return Object.freeze({
    ...registration,
    definition: Object.freeze({
      ...registration.definition,
      ...(Object.keys(inputs).length ? { inputs: Object.freeze(inputs) } : {}),
      ...(Object.keys(outputs).length ? { outputs: Object.freeze(outputs) } : {}),
    }) as NodeDefinition,
  });
}

function indexedBoundaryPorts(
  nodes: readonly CascadeDocumentNode[],
  moduleId: string,
  propName: string,
  prefix: string,
): Record<string, { readonly kind: "data"; readonly type: CascadeType; readonly default?: null }> {
  const boundaries = nodes
    .filter((node) => (node.module ?? node.type) === moduleId)
    .map((node) => ({
      index: savedIntegerProp(node.props?.[propName]),
      type: savedDataType(node.props?.dataType),
    }))
    .filter((boundary) => boundary.index >= 0);
  const max = boundaries.length ? Math.max(...boundaries.map(({ index }) => index)) : -1;
  const types = new Map(boundaries.map(({ index, type }) => [index, type]));
  return Object.fromEntries(
    Array.from({ length: max + 1 }, (_, index) => [
      `${prefix}_${index}`,
      prefix === "input"
        ? dataInputDefinition(types.get(index) ?? "any")
        : { kind: "data", type: types.get(index) ?? "any" },
    ]),
  );
}

function dataInputDefinition(
  type: CascadeType,
): { readonly kind: "data"; readonly type: CascadeType; readonly default?: null } {
  return type === "any"
    ? { kind: "data", type, default: null }
    : { kind: "data", type };
}

function savedDataType(value: unknown): CascadeType {
  const type = savedStringProp(value);
  return (type || "any") as CascadeType;
}

function savedStringProp(value: unknown): string {
  const unwrapped = value && typeof value === "object" && "value" in value
    ? (value as { value: unknown }).value
    : value;
  return typeof unwrapped === "string" ? unwrapped : "";
}

function savedIntegerProp(value: unknown): number {
  const unwrapped = value && typeof value === "object" && "value" in value
    ? (value as { value: unknown }).value
    : value;
  return typeof unwrapped === "number" && Number.isInteger(unwrapped)
    ? unwrapped
    : 0;
}

function integerProp(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) ? value : 0;
}

function graphBoundaries(
  nodes: readonly RuntimeNode[],
  moduleId: "cascade.core.Input" | "cascade.core.Output",
  nameProp: "inputName" | "outputName",
): ReadonlyMap<string, RuntimeNode> {
  const boundaries = new Map<string, RuntimeNode>();
  for (const node of nodes) {
    if (node.parent || node.moduleId !== moduleId) continue;
    const name = savedStringProp(node.props[nameProp]).trim() || node.id;
    if (boundaries.has(name))
      misuse("runtime/duplicate-graph-boundary", `Duplicate graph boundary name ${name}`);
    boundaries.set(name, node);
  }
  return boundaries;
}

function boundaryInspection(
  boundaries: ReadonlyMap<string, RuntimeNode>,
  portName: string,
): Readonly<Record<string, Readonly<{ nodeId: string; type: string }>>> {
  return Object.freeze(Object.fromEntries(
    [...boundaries].map(([name, node]) => [
      name,
      Object.freeze({
        nodeId: node.id,
        type: node.definition.outputs?.[portName]?.kind === "data"
          ? node.definition.outputs[portName].type
          : "any",
      }),
    ]),
  ));
}

function isStructuralProp(node: RuntimeNode, name: string): boolean {
  if (node.moduleId === "cascade.core.Input")
    return name === "inputIndex" || name === "inputName" || name === "dataType";
  if (node.moduleId === "cascade.core.Output")
    return name === "outputIndex" || name === "outputName" || name === "dataType";
  return false;
}

function materializeConnection(
  connection: CascadeDocumentConnection,
  index: number,
  nodes: ReadonlyMap<string, RuntimeNode>,
): RuntimeConnection {
  const endpoints: {
    source: { nodeId: string; outputName: string };
    target: { nodeId: string; inputName: string };
  } = Array.isArray(connection)
    ? {
        source: {
          nodeId: connection[0][0],
          outputName:
            connection[0][2] ??
            outputName(nodes.get(connection[0][0]), connection[0][1]),
        },
        target: {
          nodeId: connection[1][0],
          inputName:
            connection[1][2] ??
            inputName(nodes.get(connection[1][0]), connection[1][1]),
        },
      }
    : {
        source: {
          nodeId: (connection as Exclude<CascadeDocumentConnection, readonly unknown[]>).source.nodeId,
          outputName: (connection as Exclude<CascadeDocumentConnection, readonly unknown[]>).source.outputName,
        },
        target: {
          nodeId: (connection as Exclude<CascadeDocumentConnection, readonly unknown[]>).target.nodeId,
          inputName: (connection as Exclude<CascadeDocumentConnection, readonly unknown[]>).target.inputName,
        },
      };
  const source = nodes.get(endpoints.source.nodeId);
  const target = nodes.get(endpoints.target.nodeId);
  if (!source || !target)
    misuse(
      "runtime/invalid-connection",
      `Connection ${index} references an unknown node`,
    );
  const output = source.definition.outputs?.[endpoints.source.outputName];
  let input = target.definition.inputs?.[endpoints.target.inputName];
  let variadicIndex: number | undefined;
  if (!input && /^input_\d+$/.test(endpoints.target.inputName)) {
    const variadic = variadicInputName(target);
    if (variadic !== undefined) {
      variadicIndex = Number(endpoints.target.inputName.slice("input_".length));
      endpoints.target.inputName = variadic;
      input = target.definition.inputs?.[variadic];
    }
  }
  if (!output || !input)
    misuse(
      "runtime/invalid-connection",
      `Connection ${index} references an unknown port`,
    );
  if (output.kind !== input.kind)
    misuse(
      "runtime/connection-kind",
      `Connection ${index} mixes ${output.kind} and ${input.kind}`,
    );
  if (
    output.kind === "data" &&
    input.kind === "data" &&
    !canConnectTypes(output.type, input.type)
  )
    misuse(
      "runtime/connection-type",
      `Connection ${index} has incompatible types ${output.type} and ${input.type}`,
    );
  return Object.freeze({
    source: Object.freeze(endpoints.source),
    target: Object.freeze(endpoints.target),
    kind: output.kind,
    order: index,
    ...(variadicIndex === undefined ? {} : { variadicIndex }),
  });
}

function validateCardinality(
  nodes: ReadonlyMap<string, RuntimeNode>,
  connections: readonly RuntimeConnection[],
): void {
  const counts = new Map<string, number>();
  for (const connection of connections) {
    if (connection.kind !== "data") continue;
    const key = `${connection.target.nodeId}\0${connection.target.inputName}`;
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    const input = nodes.get(connection.target.nodeId)?.definition.inputs?.[
      connection.target.inputName
    ];
    if (count > 1 && input?.kind === "data" && !input.variadic)
      misuse(
        "runtime/input-cardinality",
        `${connection.target.nodeId}.${connection.target.inputName} accepts one connection`,
      );
  }
}

function validateHierarchy(
  nodes: readonly RuntimeNode[],
  byId: ReadonlyMap<string, RuntimeNode>,
): void {
  for (const node of nodes) {
    if (!node.parent) continue;
    const parent = byId.get(node.parent);
    if (!parent)
      misuse(
        "runtime/parent-not-found",
        `Node ${node.id} references missing parent ${node.parent}`,
      );
    if (parent.definition.container !== "subnet")
      misuse(
        "runtime/parent-not-container",
        `Node ${node.id} parent ${node.parent} is not a subnet container`,
      );
  }
  for (const node of nodes) {
    const visited = new Set<string>([node.id]);
    let parentId = node.parent;
    while (parentId) {
      if (visited.has(parentId))
        misuse(
          "runtime/parent-cycle",
          `Node hierarchy contains a cycle through ${parentId}`,
        );
      visited.add(parentId);
      parentId = byId.get(parentId)?.parent;
    }
  }
}

function snapshotRegistration(
  registration: NodeRegistration,
): NodeRegistration {
  if (registration.kind === "legacy-dynamic")
    return Object.freeze({ ...registration });
  const definition = snapshot(registration.definition) as NodeDefinition;
  return Object.freeze({ ...registration, definition });
}

function isGated(node: RuntimeNode): boolean {
  return Object.values(node.definition.inputs ?? {}).some(
    (input) => input.kind === "trigger",
  );
}

function outputName(node: RuntimeNode | undefined, index: number): string {
  const name = Object.keys(node?.definition.outputs ?? {})[index];
  if (!name)
    misuse("runtime/invalid-connection", `Unknown output index ${index}`);
  return name;
}
/**
 * The declared name of a node's variadic input, if it has exactly one.
 *
 * `input_0`, `input_1`, ... is the wire spelling for the Nth connection into a
 * variadic input: it is what Studio's port list produces and what saved graphs
 * carry, and it is not the port's declared name. Translating it used to be
 * conditional on the target being `cascade.core.Switch` or `cascade.core.Merge`,
 * which made variadic wiring a property of two module ids rather than of a
 * definition, so `cascade.geo.Merge` and any project node declaring
 * `variadic: true` could not be wired at all. Marcus called that a bug and asked
 * for the general fix, 2026-09-04.
 *
 * Derived from the definition, so a node whose input is declared variadic
 * accepts `input_N` whoever wrote it. Two variadic inputs on one definition make
 * `input_N` genuinely ambiguous, so nothing is guessed and the connection is
 * refused as an unknown port; no definition declares two today, and the honest
 * failure is better than picking the first one.
 */
function variadicInputName(node: RuntimeNode): string | undefined {
  const names = Object.entries(node.definition.inputs ?? {})
    .filter(([, input]) => input.kind === "data" && input.variadic === true)
    .map(([name]) => name);
  return names.length === 1 ? names[0] : undefined;
}
function inputName(node: RuntimeNode | undefined, index: number): string {
  const name = Object.keys(node?.definition.inputs ?? {})[index];
  if (!name)
    misuse("runtime/invalid-connection", `Unknown input index ${index}`);
  return name;
}
function validateTopology(
  nodes: readonly RuntimeNode[],
  connections: readonly RuntimeConnection[],
): void {
  topological(nodes, connections);
}
function topological(
  nodes: readonly RuntimeNode[],
  connections: readonly RuntimeConnection[],
): RuntimeNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));
  for (const dependency of graphDependencies(nodes, connections)) {
    outgoing.get(dependency.sourceId)!.push(dependency.targetId);
    indegree.set(
      dependency.targetId,
      indegree.get(dependency.targetId)! + 1,
    );
  }
  const queue = nodes.filter((node) => indegree.get(node.id) === 0);
  const result: RuntimeNode[] = [];
  let queueIndex = 0;
  while (queueIndex < queue.length) {
    const node = queue[queueIndex++];
    result.push(node);
    for (const id of outgoing.get(node.id)!) {
      indegree.set(id, indegree.get(id)! - 1);
      if (indegree.get(id) === 0)
        queue.push(byId.get(id)!);
    }
  }
  if (result.length !== nodes.length)
    misuse("runtime/cycle", "Graph contains a data or trigger cycle");
  return result;
}

interface NodeDependency {
  readonly sourceId: string;
  readonly targetId: string;
}

function graphDependencies(
  nodes: readonly RuntimeNode[],
  connections: readonly RuntimeConnection[],
): readonly NodeDependency[] {
  const dependencies = new Map<string, NodeDependency>();
  for (const connection of connections) {
    const dependency = {
      sourceId: connection.source.nodeId,
      targetId: connection.target.nodeId,
    };
    dependencies.set(`${dependency.sourceId}\0${dependency.targetId}`, dependency);
  }
  for (const dependency of dataDependencies(nodes, connections))
    dependencies.set(`${dependency.sourceId}\0${dependency.targetId}`, dependency);
  return [...dependencies.values()];
}

function dataDependencies(
  nodes: readonly RuntimeNode[],
  connections: readonly RuntimeConnection[],
): readonly NodeDependency[] {
  const dependencies = new Map<string, NodeDependency>();
  for (const connection of connections) {
    if (connection.kind !== "data") continue;
    const dependency = {
      sourceId: connection.source.nodeId,
      targetId: connection.target.nodeId,
    };
    dependencies.set(`${dependency.sourceId}\0${dependency.targetId}`, dependency);
  }
  for (const node of nodes) {
    if (!node.parent) continue;
    if (node.moduleId === "cascade.core.Input") {
      const inputName = `input_${integerProp(node.props.inputIndex)}`;
      const source = connections.find(
        (connection) =>
          connection.kind === "data" &&
          connection.target.nodeId === node.parent &&
          connection.target.inputName === inputName,
      );
      if (source) {
        const dependency = {
          sourceId: source.source.nodeId,
          targetId: node.id,
        };
        dependencies.set(`${dependency.sourceId}\0${dependency.targetId}`, dependency);
      }
    } else if (node.moduleId === "cascade.core.Output") {
      const dependency = { sourceId: node.id, targetId: node.parent };
      dependencies.set(`${dependency.sourceId}\0${dependency.targetId}`, dependency);
    }
  }
  return [...dependencies.values()];
}
function runtimeError(code: string, message: string): CascadeRuntimeError {
  return new CascadeRuntimeError(code, [{ phase: "runtime", code, message }]);
}
function misuse(code: string, message: string): never {
  throw runtimeError(code, message);
}
function snapshot<T>(value: T): T {
  return cloneValue(value, new WeakSet()) as T;
}

function immutableMap<K, V>(entries: Iterable<readonly [K, V]>): ReadonlyMap<K, V> {
  const source = new Map(entries);
  let view: ReadonlyMap<K, V>;
  view = Object.freeze({
    get size() { return source.size; },
    has(key: K) { return source.has(key); },
    get(key: K) { return source.get(key); },
    entries() { return source.entries(); },
    keys() { return source.keys(); },
    values() { return source.values(); },
    [Symbol.iterator]() { return source[Symbol.iterator](); },
    forEach(callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown) {
      source.forEach((value, key) => callback.call(thisArg, value, key, view));
    },
  });
  return view;
}
function cloneValue(value: unknown, ancestors: WeakSet<object>): unknown {
  if (typeof value === "number" && !Number.isFinite(value))
    misuse("runtime/non-serializable-value", "Runtime numbers must be finite");
  if (
    typeof value === "function" ||
    typeof value === "symbol" ||
    typeof value === "bigint"
  )
    misuse(
      "runtime/non-serializable-value",
      `Runtime values cannot contain ${typeof value}`,
    );
  if (value === undefined || value === null || typeof value !== "object")
    return value;
  const prototype = Object.getPrototypeOf(value);
  if (
    !Array.isArray(value) &&
    prototype !== Object.prototype &&
    prototype !== null
  )
    return value;
  if (ancestors.has(value))
    misuse(
      "runtime/non-serializable-value",
      "Runtime values cannot contain cycles",
    );
  ancestors.add(value);
  const clone = Array.isArray(value)
    ? value.map((item) => cloneValue(item, ancestors))
    : Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          cloneValue(item, ancestors),
        ]),
      );
  ancestors.delete(value);
  return Object.freeze(clone);
}

const TUPLE_LENGTHS: Readonly<Record<string, number>> = {
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

function runtimeValue(
  value: unknown,
  type: string,
  allowUndefined: boolean,
  path: string,
): unknown {
  if (value === undefined) {
    if (allowUndefined) return undefined;
    misuse("runtime/value-type", `${path} requires a ${type} value`);
  }
  const tupleLength = TUPLE_LENGTHS[type];
  const valid =
    (type === "float" && typeof value === "number" && Number.isFinite(value)) ||
    (type === "int" && typeof value === "number" && Number.isInteger(value)) ||
    (type === "bool" && typeof value === "boolean") ||
    (type === "string" && typeof value === "string") ||
    (tupleLength !== undefined &&
      Array.isArray(value) &&
      value.length === tupleLength &&
      value.every((item) =>
        type.endsWith("i")
          ? typeof item === "number" && Number.isInteger(item)
          : typeof item === "number" && Number.isFinite(item),
      )) ||
    (!tupleLength &&
      type !== "float" &&
      type !== "int" &&
      type !== "bool" &&
      type !== "string");
  if (!valid) misuse("runtime/value-type", `${path} is not a valid ${type}`);
  return snapshot(value);
}
