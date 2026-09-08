import type { InputPort, OutputPort, PortOptions, PortType, Prop, PropControlType, NodeParameter, ParamOptions, DataType } from '../types/node.types.js';
import type { Graph } from './Graph.js';
import { typeToPackagePath, isStandardLibraryNode } from '../utils/nodeTypeUtils.js';
import { normalizeColor, isColorValue } from '../utils/colorUtils.js';
import { normalizeType } from '../types/coreTypes.js';
import { expressionEngine } from '../engine/expressions/index.js';
import {
  deleteKey as channelDeleteKey,
  deserializeChannel,
  isEmptyChannel,
  serializeChannel,
  setKey as channelSetKey
} from '@cascade/runtime/animation';
import type { Channel, Interpolation, Keyframe, SerializedChannel } from '@cascade/runtime/animation';
import { resolvePropBinding } from '@cascade/runtime/params';

export type { Channel as ParamChannel, Interpolation, Keyframe };

/**
 * A keyed parameter, declared where the parameter type lives.
 *
 * `Prop` already carries `value` and `expression`; a channel is the third
 * binding and belongs beside them rather than in a timeline that pushes
 * values — so it travels with the node through copy, duplicate and retarget,
 * and serialises in one place.
 *
 * Declared as an augmentation rather than edited into `node.types.ts` only
 * because the panels are being written against that file at the same time.
 * It should move there once they land.
 */
declare module '../types/node.types.js' {
  interface Prop<T> {
    /** Keyframes. Present and non-empty means the parameter is animated. */
    channel?: Channel;
  }
}

export type CookState = 'clean' | 'stale' | 'queued' | 'cooking' | 'error';

/**
 * Node - Unified base class for all graph elements
 *
 * Subclasses override behavior as needed (e.g., Annotation overrides execute()).
 */
/** Best guess at a parameter's type from its default, so a node that doesn't
 *  declare one still gets the right editor. */
function inferParamType(value: unknown): DataType {
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'float';
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'string') return 'string';
  if (Array.isArray(value) && value.every(v => typeof v === 'number')) {
    if (value.length === 2) return 'vec2';
    if (value.length === 3) return 'vec3';
    if (value.length === 4) return 'vec4';
  }
  return 'any';
}

/**
 * ============ One binding layer ============
 *
 * `param()` and `props` were two parameter stores, and every binding — an
 * expression, a keyframe channel, `parm()`, `evalParm()` — was attached to the
 * one the sketches do not use. Measured 2026-09-08: `param('scale', 1)` put
 * 'scale' in `parameters`, left `props` empty, and `parm('scale')` returned
 * null, so no parameter in any sketch could carry an expression or a key.
 *
 * The fix is not to teach `parameters` about bindings as well. There is now ONE
 * store: a parameter's value lives in the prop of the same name, and the
 * `NodeParameter.value` a node reads is a *view* onto it — resolved through the
 * channel and the expression, exactly as `evalParm` resolves a prop. So
 * `node.param('angle', 0).value` inside `execute()` already reflects a key or
 * an expression, with no change to any sketch.
 *
 * What the metadata split still buys: `parameters` keeps the declaration (type,
 * default, options, `promoted`), props keeps the value and its bindings. The
 * backing prop is marked `fromParameter` so the Inspector renders it once, in
 * the Parameters section, and the serializer writes it once, in `params`.
 */

/** The control a parameter's declared data type should render as, so one row of
 *  UI can be driven from either store. */
function paramControlType(dataType: DataType | undefined): PropControlType | undefined {
  switch (normalizeType(dataType ?? 'any')) {
    case 'int': return 'int';
    case 'float': return 'number';
    case 'bool': return 'boolean';
    case 'string': return 'text';
    case 'color': return 'color';
    case 'vec2': return 'vec2';
    case 'vec3': return 'vec3';
    case 'vec4': return 'vec4';
    default: return undefined;
  }
}

/**
 * ============ Parameter carry-over (retargeting) ============
 *
 * Switching a node to a different VERSION of a definition is not the same move
 * as pointing it at the same code in a new place. The code differs, so its
 * parameters may have been added, removed, renamed or retyped, and the values
 * someone typed into the old one have to be reconciled against the new
 * declaration rather than assumed to still fit.
 *
 * The mechanism is the one deserialization already uses: values are seeded onto
 * the node BEFORE its code declares anything, and `param()` / `addParm()` keep
 * a seeded value instead of resetting it to the code default. Carry-over adds
 * the bookkeeping that a report needs — which values were kept, which are new,
 * which no longer exist — because a setting that vanishes silently is the one
 * failure this whole feature exists to prevent.
 */

/** One setting as it stood before a retarget. */
export interface CarriedParameter {
  name: string;
  /** `parameters` are the node's own values; `props` is the older control
   *  system, and the one expressions attach to. Both are carried. */
  kind: 'parameter' | 'prop';
  /** Normalized type, or 'any' when the old definition never declared one. */
  type: string;
  value: unknown;
  expression?: string;
  /** A keyed parameter carries its animation across a retarget too — the
   *  channel lives on the parameter precisely so this works for free. */
  channel?: Channel;
}

/**
 * What a retarget did to a node's settings.
 *
 * Deliberately flat, JSON-serialisable and free of Node references so a panel
 * can render it, a test can assert on it and a log can keep it:
 *
 *   kept      — name and type matched, the value (and its expression) carried over
 *   defaulted — declared by the new definition only, so it took its default
 *   dropped   — existed before, gone from the new definition. Never discarded
 *               silently: the value is included so a caller can offer it back
 *   retyped   — same name, different type. The new type wins with its default,
 *               and the conflict is reported rather than coerced
 */
export interface ParameterCarryOverReport {
  kept: string[];
  defaulted: string[];
  dropped: Array<{ name: string; value: unknown; expression?: string }>;
  retyped: Array<{ name: string; from: string; to: string }>;
}

/** A parameter as the incoming definition declares it, for the synchronous path. */
export interface ParameterDeclaration {
  name: string;
  type?: string;
  defaultValue?: unknown;
  kind?: 'parameter' | 'prop';
}

/** Props carry UI control types ('slider', 'textarea'), parameters carry data
 *  types ('float', 'string'). Mapping the control vocabulary onto the data one
 *  is what stops a slider and a float reading as a type conflict. */
const PROP_CONTROL_TO_DATA_TYPE: Record<string, string> = {
  number: 'float',
  slider: 'float',
  range: 'float',
  float: 'float',
  int: 'int',
  text: 'string',
  textarea: 'string',
  string: 'string',
  select: 'string',
  boolean: 'bool',
  bool: 'bool',
  vector: 'vec3',
};

/** 'any' means the type was never declared, not that it is a wildcard value. */
function carryType(type: string | undefined): string {
  if (!type) return 'any';
  return normalizeType(PROP_CONTROL_TO_DATA_TYPE[type] ?? type);
}

/** Strict: equal after alias normalization, or one side undeclared. No
 *  coercion — an int that became a float is a conflict, reported as one, and
 *  the caller decides whether to put the old value back. */
/** Numeric types carry over between themselves. `inferParamType` reads
 *  `param('weight', 1)` as `int` purely because `Number.isInteger(1)` is true,
 *  so a v2 that writes `param('weight', 1.5)` would otherwise reset a value the
 *  author had tuned — losing it to an inference artefact rather than to any
 *  decision anyone made. That is the silent-loss case this whole reconciliation
 *  exists to prevent, so the numeric family is treated as one type here.
 *
 *  Everything else stays strict, and nothing is coerced: a string that becomes a
 *  float is still a conflict, reported and defaulted. */
const NUMERIC_CARRY = new Set(['int', 'float']);

function carryTypesMatch(before: string, after: string): boolean {
  if (before === 'any' || after === 'any') return true;
  if (NUMERIC_CARRY.has(before) && NUMERIC_CARRY.has(after)) return true;
  return before === after;
}

export class Node {
  // Static callback for UI reactivity (set by editor, not required for headless)
  static onPropParamsChanged?: (nodeId: string) => void;
  /** Fired when a DEFERRED retarget finishes reconciling on the next cook, so
   *  a panel learns what was dropped without polling. */
  static onParametersRetargeted?: (nodeId: string, report: ParameterCarryOverReport) => void;

  id: string;
  type: string;
  position: { x: number; y: number };

  // Ports - available to all nodes
  inputs: InputPort[] = [];
  outputs: OutputPort[] = [];

  // Props system
  props: Record<string, Prop> = {};
  protected propWatchers: Map<string, Function[]> = new Map();

  // Actions system - button-triggered callbacks
  actions: Record<string, {
    label: string;
    icon?: string;
    callback: () => void | Promise<void>;
    condition?: () => boolean;
  }> = {};

  // Variadic inputs
  /** The node's own values — see param(). Distinct from `props`, which is the
   *  older image-node control system. */
  parameters: NodeParameter[] = [];
  protected parametersUsedDuringSetup: Set<string> = new Set();
  /**
   * Props the node's own code declared with `addParm()`, and which its cook may
   * therefore read as `this.props.name.value`.
   *
   * A prop restored from a document is NOT in here until the code that owns it
   * has run, which for any on-demand-compiled module is after the first cook
   * has begun. See evaluateAllExpressions for why that distinction has to be
   * made rather than assumed.
   */
  protected propsDeclaredByCode: Set<string> = new Set();

  /** Non-null between a retarget and the cook that resolves it. */
  private carryOver: {
    carried: Map<string, CarriedParameter>;
    resolved: Set<string>;
    report: ParameterCarryOverReport;
  } | null = null;
  /** The last completed reconciliation, for a panel that arrives after the fact. */
  lastCarryOverReport: ParameterCarryOverReport | null = null;

  variadic: boolean = false;
  protected variadicDefault: any = null;
  private variadicOptions: PortOptions = {};

  // Visual
  preview: HTMLCanvasElement | HTMLImageElement | null = null;

  // Metadata
  comment: string = '';
  error: Error | null = null;
  warning: string | null = null;

  // Computation-specific
  code: string = '';
  bypass: boolean = false;
  cook: boolean = false;

  // Path system - hierarchical node organization
  parent: Node | null = null;
  protected _children: Node[] = [];

  // Execution state
  protected hasExecuted: boolean = false;
  protected lastInputHash: string = '';
  cookState: CookState = 'stale';
  private cookGeneration = 0;
  private stagedOutputs: Map<OutputPort, unknown> | null = null;
  executionTimeout: number = 30000;

  // Cook info - performance tracking
  cookInfo: {
    lastCookTime: number;        // Duration of last execution (ms)
    totalCookTime: number;       // Cumulative cook time
    cookCount: number;           // Number of times cooked
    averageCookTime: number;     // Average cook time
    lastCookTimestamp: number;   // When last cooked (Date.now())
    peakMemory: number;          // Peak memory during cook (if measurable)
  } = {
    lastCookTime: 0,
    totalCookTime: 0,
    cookCount: 0,
    averageCookTime: 0,
    lastCookTimestamp: 0,
    peakMemory: 0
  };

  // Time dependency tracking (for expression engine)
  isTimeDependent: boolean = false;

  // Lifecycle hooks
  onSetup?: () => void | Promise<void>;
  onUpdate?: () => void | Promise<void>;
  onRender?: () => void | Promise<void>;
  onReady?: () => void;
  onDestroy?: () => void;

  // Node function (for custom nodes compiled from code)
  private nodeFunction?: Function;

  // Graph reference
  protected graph: Graph;

  // Port tracking for cleanup
  protected portsUsedDuringSetup: Set<string> = new Set();

  // Port index map for O(1) lookups (portId -> port)
  private _portMap: Map<string, InputPort | OutputPort> = new Map();

  constructor(id: string, type: string, graph: Graph) {
    this.id = id;
    this.type = type;
    this.graph = graph;
    this.position = { x: 0, y: 0 };

    // Call setup for class-based nodes (subclasses)
    if (this.constructor !== Node) {
      this.setup();
      // Schedule onReady call after constructor completes
      queueMicrotask(() => {
        if (this.onReady) {
          try {
            this.onReady();
          } catch (err) {
            console.error(`Error in onReady for node ${this.id}:`, err);
          }
        }
      });
    }
  }

  // ============ Port Creation ============

  in<T>(name: string, defaultValue?: T, options: PortOptions = {}): InputPort<T> {
    const portType: PortType = name === 'trigger' ? 'trigger' : 'param';

    const existingPort = this.inputs.find(p => p.name === name);
    if (existingPort) {
      this.portsUsedDuringSetup.add(`input_${name}`);
      if (options.type) existingPort.dataType = options.type;
      if (defaultValue !== undefined && existingPort.defaultValue !== defaultValue) {
        existingPort.defaultValue = defaultValue as T;
        if (existingPort.value === undefined || existingPort.value === existingPort.defaultValue) {
          existingPort.value = defaultValue as T;
        }
      }
      existingPort.options = Object.assign(existingPort.options ?? {}, options);
      return existingPort as InputPort<T>;
    }

    const portIndex = this.inputs.length;
    const port: InputPort<T> = {
      id: `${this.id}_in_${portIndex}`,
      name,
      portType,
      dataType: options.type || 'any',
      value: defaultValue as T,
      defaultValue: defaultValue as T,
      options,
      connections: []
    };

    this.inputs.push(port as InputPort);
    this._portMap.set(port.id, port as InputPort);
    this.portsUsedDuringSetup.add(`input_${name}`);
    return port;
  }

  /**
   * Declare an output port. Takes the same `options` as `in()` — an output that
   * cannot state its type is a hole in the type system: the connection check
   * only ever sees `any` on one side, and the port draws in the neutral colour
   * whatever it actually carries.
   */
  out<T>(name: string, portType: PortType = 'param', options: PortOptions = {}): OutputPort<T> {
    const existingPort = this.outputs.find(p => p.name === name);
    if (existingPort) {
      this.portsUsedDuringSetup.add(`output_${name}`);
      if (existingPort.portType !== portType) existingPort.portType = portType;
      if (options.type) existingPort.dataType = options.type;
      existingPort.options = { ...(existingPort.options ?? {}), ...options };
      return existingPort as OutputPort<T>;
    }

    const portIndex = this.outputs.length;
    const port: OutputPort<T> = {
      id: `${this.id}_out_${portIndex}`,
      name,
      portType,
      dataType: options.type || 'any',
      value: undefined as T,
      connections: [],
      options,

      setValue: (value: T) => this.setOutputValue(port, value),

      trigger: (props?: any) => {
        port.connections.forEach(conn => {
          const targetNode = this.graph.getNode(conn.to.nodeId);
          if (targetNode) {
            // O(1) port lookup via index map
            const targetPort = targetNode.getInputPortById(conn.to.portId);
            if (targetPort && targetPort.onTrigger) targetPort.onTrigger(props);
          }
        });
      }
    };

    this.outputs.push(port as OutputPort);
    this._portMap.set(port.id, port as OutputPort);
    this.portsUsedDuringSetup.add(`output_${name}`);
    return port;
  }

  // ============ Port Access ============

  getInputPort(index: number): InputPort | null {
    return index >= 0 && index < this.inputs.length ? this.inputs[index] : null;
  }

  getOutputPort(index: number): OutputPort | null {
    return index >= 0 && index < this.outputs.length ? this.outputs[index] : null;
  }

  /** Update the element id and every derived port id as one operation. */
  renameId(newId: string): ReadonlyMap<string, string> {
    const oldId = this.id;
    const renamed = new Map<string, string>();
    this.id = newId;
    this._portMap.clear();
    for (const port of [...this.inputs, ...this.outputs]) {
      const oldPortId = port.id;
      port.id = oldPortId.startsWith(`${oldId}_`)
        ? `${newId}${oldPortId.slice(oldId.length)}`
        : oldPortId;
      renamed.set(oldPortId, port.id);
      this._portMap.set(port.id, port);
    }
    return renamed;
  }

  getPort(portId: string): InputPort | OutputPort | null {
    return this._portMap.get(portId) || null;
  }

  getInputPortById(portId: string): InputPort | null {
    const port = this._portMap.get(portId);
    return port && 'defaultValue' in port ? port as InputPort : null;
  }

  private setOutputValue<T>(port: OutputPort<T>, value: T): void {
    if (this.stagedOutputs) {
      this.stagedOutputs.set(port as OutputPort, value);
      return;
    }
    this.commitOutputValue(port, value);
  }

  private commitOutputValue<T>(port: OutputPort<T>, value: T): void {
    port.value = value;
    for (const connection of port.connections) {
      const targetNode = this.graph.getNode(connection.to.nodeId);
      const targetPort = targetNode?.getInputPortById(connection.to.portId);
      if (!targetPort) continue;
      targetPort.value = value;
      targetPort.onChange?.(value);
    }
  }

  // ============ Props System ============

  /**
   * Add a parameter to this node
   * Short alias for defineProp - use in setup()
   */
  addParm<T>(name: string, config: Prop<T>): void {
    this.props[name] = config as Prop;
    // Declared by the node's own code, so its cook may read `.value` directly
    // — see evaluateAllExpressions, which pushes evaluated values only into
    // these.
    this.propsDeclaredByCode.add(name);
    this.reconcileProp(name);
    // Dynamic nodes redeclare their shape inside execute(). That declaration
    // is part of the current cook, not a new authored change; rescheduling it
    // would create an endless generation loop.
    if (this.cookState !== 'cooking') this.markDirty();
  }

  /**
   * Define a parameter on this node
   * @deprecated Use addParm() instead
   */
  defineProp<T>(name: string, config: Prop<T>): void {
    this.addParm(name, config);
  }

  /**
   * Add an action button to this node
   * Actions appear in the Inspector and can be triggered by keyboard shortcuts
   */
  addAction(name: string, config: {
    label: string;
    icon?: string;
    callback: () => void | Promise<void>;
    condition?: () => boolean;
  }): void {
    this.actions[name] = config;
  }

  /**
   * Execute an action by name
   */
  async executeAction(name: string): Promise<void> {
    const action = this.actions[name];
    if (!action) return;
    if (action.condition && !action.condition()) return;
    await action.callback();
  }

  updateProp(name: string, value: any): void {
    if (!this.props[name]) return;

    const newValue = Array.isArray(value) ? [...value] : value;
    this.props[name] = { ...this.props[name], value: newValue };

    if (this.props[name].onChange) {
      try {
        this.props[name].onChange!(this.props[name], this as any);
      } catch (err) {
        console.error(`Error in prop onChange for ${name}:`, err);
      }
    }

    const watchers = this.propWatchers.get(name);
    if (watchers) {
      watchers.forEach(cb => {
        try { cb(newValue, this.props[name]); }
        catch (err) { console.error(`Error in prop watcher for ${name}:`, err); }
      });
    }

    this.props = { ...this.props };
    this.markDirty();
    // Trigger UI reactivity if callback is set (editor sets this)
    Node.onPropParamsChanged?.(this.id);
  }

  /**
   * Update prop params (e.g., min, max) and trigger UI reactivity
   */
  updatePropParams(name: string, params: Partial<Prop['params']>): void {
    if (!this.props[name]) return;

    this.props[name] = {
      ...this.props[name],
      params: { ...this.props[name].params, ...params }
    };
    this.props = { ...this.props };
    // Trigger UI reactivity if callback is set (editor sets this)
    Node.onPropParamsChanged?.(this.id);
  }

  watchProp(name: string, callback: Function): void {
    if (!this.propWatchers.has(name)) this.propWatchers.set(name, []);
    this.propWatchers.get(name)!.push(callback);
  }

  // ============ Parm API (HOM-style wrappers) ============

  /**
   * Get a parameter wrapper object for HOM-style access
   */
  parm(name: string): {
    name: () => string;
    path: () => string;
    node: () => Node;
    eval: () => any;
    evalAsFloat: () => number;
    evalAsInt: () => number;
    evalAsString: () => string;
    rawValue: () => any;
    set: (value: any) => void;
    parmType: () => string;
    // Expression support
    expression: () => string | null;
    setExpression: (expr: string) => void;
    deleteExpression: () => void;
    hasExpression: () => boolean;
    expressionError: () => string | null;
    // Keyframe channel support
    channel: () => Channel | null;
    hasChannel: () => boolean;
    keys: () => readonly Keyframe[];
    setKey: (frame?: number, value?: number, interpolation?: Interpolation) => void;
    deleteKey: (frame: number) => void;
    clearChannel: () => void;
  } | null {
    const prop = this.props[name];
    if (!prop) return null;

    const self = this;
    // Every accessor reads `self.props[name]` rather than the `prop` captured
    // above: a prop object is REPLACED on every write (`this.props[name] = {
    // ...prop, ... }`), so a handle held across a set would otherwise report
    // the state the parameter was in when the handle was made. Caught by
    // `hasExpression()` going false after keying the same parameter.
    const live = () => self.props[name] ?? prop;
    return {
      name: () => name,
      path: () => `${self.path()}/${name}`,
      node: () => self,
      eval: () => live().value,
      evalAsFloat: () => parseFloat(live().value) || 0,
      evalAsInt: () => parseInt(live().value, 10) || 0,
      evalAsString: () => String(live().value ?? ''),
      rawValue: () => live().value,
      set: (value: any) => self.updateProp(name, value),
      parmType: () => live().type || 'any',
      // Expression support
      expression: () => live().expression ?? null,
      setExpression: (expr: string) => {
        self.props[name] = { ...self.props[name], expression: expr };
        // Update time dependency based on all expressions
        self.updateTimeDependent();
        self.markDirty();
      },
      deleteExpression: () => {
        const { expression: _, expressionError: __, ...rest } = self.props[name];
        self.props[name] = rest as any;
        // Re-check time dependency
        self.updateTimeDependent();
        self.markDirty();
      },
      hasExpression: () => !!live().expression,
      expressionError: () => live().expressionError ?? null,

      // ---- Keyframe channel ----
      // Same shape as the expression API above, deliberately: a channel and an
      // expression are the same kind of binding, one drawn and one written.
      channel: () => self.props[name]?.channel ?? null,
      hasChannel: () => !isEmptyChannel(self.props[name]?.channel),
      keys: () => self.props[name]?.channel?.keys ?? [],
      /**
       * Key the parameter. Both arguments default to "here, now": the current
       * frame and the parameter's current evaluated value, which is what
       * alt-clicking a parameter has to mean.
       */
      setKey: (frame?: number, value?: number, interpolation?: Interpolation) => {
        const at = frame ?? self.currentFrame();
        const v = value ?? Number(self.evalParm(name));
        if (!Number.isFinite(v)) return;
        self.setPropChannel(name, channelSetKey(self.props[name]?.channel, at, v, interpolation));
      },
      deleteKey: (frame: number) => {
        const current = self.props[name]?.channel;
        if (!current) return;
        self.setPropChannel(name, channelDeleteKey(current, frame));
      },
      clearChannel: () => self.setPropChannel(name, null)
    };
  }

  // ============ Keyframe channels ============

  /**
   * The frame a channel is sampled against.
   *
   * One clock today — the expression engine's, which the host keeps in step
   * with its own frame — so `sin($T)` and a keyed curve on the same node
   * always agree. When timelines become document objects this is the single
   * place that has to learn which one a node belongs to.
   */
  currentFrame(): number {
    return expressionEngine.fframe;
  }

  /**
   * Attach, replace or clear a channel. An empty channel is removed rather
   * than stored, so `hasChannel()` and the serialised form never disagree
   * about whether a parameter is animated.
   */
  setPropChannel(name: string, channel: Channel | null): void {
    const prop = this.props[name];
    if (!prop) return;

    if (!channel || isEmptyChannel(channel)) {
      const { channel: _dropped, ...rest } = this.props[name];
      this.props[name] = rest as Prop;
    } else {
      this.props[name] = { ...prop, channel };
    }

    this.props = { ...this.props };
    this.updateTimeDependent();
    this.markDirty();
    Node.onPropParamsChanged?.(this.id);
  }

  /**
   * A prop as it goes to disk: the bare value when there is nothing more to
   * say, the object form when it carries an expression, a channel, or both.
   *
   * Lives here rather than in the serializer because the channel type is the
   * node's, and one writer is what stops the two forms disagreeing.
   */
  serializePropValue(name: string, value: unknown): unknown {
    const prop = this.props[name];
    if (!prop) return value;

    const channel = serializeChannel(prop.channel);
    if (!prop.expression && !channel) return value;

    return {
      value,
      ...(prop.expression ? { expression: prop.expression } : {}),
      ...(channel ? { channel } : {})
    };
  }

  /** Read a channel back off disk. Bad data yields no channel, never a throw. */
  restorePropChannel(name: string, data: unknown): void {
    if (!this.props[name]) return;
    const channel = deserializeChannel(data);
    this.setPropChannel(name, isEmptyChannel(channel) ? null : channel);
  }

  /** The serialised channel for one prop, or undefined when it is not keyed. */
  serializePropChannel(name: string): SerializedChannel | undefined {
    return serializeChannel(this.props[name]?.channel);
  }

  /**
   * The one place a parameter becomes a value — in Studio.
   *
   * Three bindings, in one order: a keyframe channel, an expression, the raw
   * value. All of them resolve BEFORE execute, so the node receives a plain
   * number and never reads a clock — determinism is "same graph plus same
   * frame gives the same output", which is still cacheable once the cache key
   * gains a frame.
   *
   * The ORDER itself is no longer written here. It lives in
   * `@cascade/runtime/params`, because the deterministic runtime resolves the
   * same three bindings for the same document and a second implementation of
   * the order would be a second answer to the same question. What stays here
   * is the Studio-specific half: the clock the channel is sampled against, and
   * the expression engine with its Inspector-facing error bookkeeping.
   */
  evalParm(name: string): any {
    const prop = this.props[name];
    if (!prop) return undefined;

    return resolvePropBinding(prop, {
      frame: this.currentFrame(),
      // `evaluateExpression` already stores the message on the prop for the
      // panel and falls back to the raw value, so it reports no error upward:
      // the resolver's own fallback would be the same value twice.
      evaluateExpression: () => ({ value: this.evaluateExpression(name) }),
    }).value;
  }

  /**
   * Set a parameter value (shorthand for updateProp)
   */
  setParm(name: string, value: any): void {
    this.updateProp(name, value);
  }

  /**
   * Evaluate an expression for a parameter
   * Returns the evaluated value or the raw value if evaluation fails
   */
  evaluateExpression(name: string): any {
    const prop = this.props[name];
    if (!prop?.expression) return prop?.value;

    // Initialize expression engine with graph if needed
    expressionEngine.setGraph(this.graph);

    const result = expressionEngine.evaluate(prop.expression, this);

    if (result.error) {
      // Store error for UI display
      this.props[name] = { ...this.props[name], expressionError: result.error };
      // Return raw value as fallback
      return prop.value;
    }

    // Clear any previous error
    if (prop.expressionError) {
      const { expressionError: _, ...rest } = this.props[name];
      this.props[name] = rest as any;
    }

    return result.value;
  }

  /**
   * Evaluate all expressions on this node and update values
   * Called during execution to get current expression values
   */
  evaluateAllExpressions(): void {
    for (const [name, prop] of Object.entries(this.props)) {
      // A prop that backs a parameter is skipped: `parameter.value` resolves
      // the expression on every read, so there is nothing to push, and writing
      // the evaluated number into `value` would overwrite the raw one the
      // author typed — which is also what the file records.
      //
      // And so is a prop the node's own code has not declared. The push exists
      // for the class-based library, which reads `this.props.radius.value`
      // directly inside its cook; a prop it never declared cannot be read that
      // way, so pushing into one can only destroy the authored value. That is
      // not hypothetical: a module compiled on demand (every `project.*` node,
      // definition-v1 or dynamic) declares nothing until its first cook, and
      // this loop runs BEFORE that cook — so the first cook of a v1 node
      // overwrote `2` with the expression's value at frame 10 and the save
      // then wrote `10`'s number to disk as the author's own.
      if (prop.expression && !prop.fromParameter && this.propsDeclaredByCode.has(name)) {
        const evaluated = this.evaluateExpression(name);
        // Update the value with evaluated result (for downstream nodes)
        if (evaluated !== undefined) {
          this.props[name] = { ...this.props[name], value: evaluated };
        }
      }
    }

    // Update time dependency flag based on all expressions
    this.updateTimeDependent();
  }

  // ============ Parameters ============

  /**
   * A value that belongs to the node — not a pin.
   *
   * Cascade only had inputs and outputs, so every setting a node had was
   * declared as an input port that nobody ever wired. That reads wrong in the
   * graph (density-blend showed twenty input pins when it has four real inputs
   * and sixteen settings) and it reads wrong in the Inspector, where a crop
   * fraction and an incoming image sat in the same list.
   *
   * So: inputs are edges from other nodes, parameters are the node's own
   * values, outputs are edges out.
   *
   * A parameter can be PROMOTED to an input pin when you want it driven from
   * upstream rather than typed — a signal's weight computed by another node,
   * say. Promotion is per parameter and off by default: making every setting a
   * pin is how the two got conflated in the first place.
   */
  param<T = any>(name: string, defaultValue?: T, options: ParamOptions = {}): NodeParameter<T> {
    let parameter = this.parameters.find(p => p.name === name) as NodeParameter<T> | undefined;

    if (!parameter) {
      parameter = {
        name,
        value: defaultValue as T,
        defaultValue: defaultValue as T,
        dataType: options.type || inferParamType(defaultValue),
        promoted: false,
        options,
      };
      this.parameters.push(parameter as NodeParameter);
    } else {
      // Re-declaring must not reset a value someone set. Only the metadata is
      // refreshed, so editing a node's code doesn't wipe its settings.
      if (options.type) parameter.dataType = options.type;
      parameter.defaultValue = defaultValue as T;
      Object.assign(parameter.options, options);
    }
    this.parametersUsedDuringSetup.add(name);
    this.reconcileParameter(parameter as NodeParameter, defaultValue, options);
    // Idempotent, and it has to be: `param()` is re-declared inside execute()
    // on every cook of a dynamic node, so this must never reset a value
    // someone set, an expression they wrote or a channel they keyed.
    this.bindParameterProp(parameter as NodeParameter, name, options);

    // A promoted parameter reads from its pin whenever something is connected,
    // and falls back to its own value when nothing is.
    if (parameter.promoted) {
      const port = this.in(name, parameter.value, {
        ...parameter.options,
        type: parameter.dataType,
        promoted: true,
      } as PortOptions);
      (port as any).fromParameter = name;
      if (port.connections.length > 0 && port.value !== undefined && port.value !== null) {
        return { ...parameter, value: port.value as T };
      }
    }

    return parameter;
  }

  /**
   * Give a parameter the prop that holds its value, and make `parameter.value`
   * a view onto it.
   *
   * Called from `param()` on every declaration, so everything here is
   * idempotent: an existing prop keeps its value, expression and channel, and
   * only the declaration metadata is refreshed. The prop object is mutated
   * rather than replaced for the same reason the Inspector does not re-key a
   * row on commit — replacing it mid-drag destroys the control in use.
   */
  private bindParameterProp(parameter: NodeParameter, name: string, options: ParamOptions): void {
    const descriptor = Object.getOwnPropertyDescriptor(parameter, 'value');
    // A parameter restored from a document (Graph.fromJSON seeds `params`
    // before the node's code runs) arrives with a plain value. That value is
    // the authored one and seeds the prop.
    const seeded = descriptor && !descriptor.get ? descriptor.value : undefined;

    let prop = this.props[name];
    if (!prop) {
      prop = { value: seeded !== undefined ? seeded : parameter.defaultValue } as Prop;
      this.props[name] = prop;
      this.props = { ...this.props };
    }

    prop.fromParameter = name;
    // Hidden from the props section, not from the panel: the Parameters
    // section renders it, and showing it in both is how the two stores read as
    // duplicate rows.
    prop.hidden = true;
    const control = paramControlType(parameter.dataType);
    if (control) prop.type = control;
    const params: NonNullable<Prop['params']> = { ...(prop.params ?? {}) };
    if (options.min !== undefined) params.min = options.min;
    if (options.max !== undefined) params.max = options.max;
    if (options.step !== undefined) params.step = options.step;
    if (normalizeType(parameter.dataType ?? 'any') === 'int') params.integer = true;
    prop.params = params;

    if (descriptor?.get) return;
    Object.defineProperty(parameter, 'value', {
      // Resolved, not raw: a channel wins, then an expression, then the stored
      // value — the same order `evalParm` uses, because it IS `evalParm`. This
      // is what carries a key or `$T * 0.25` into a sketch's `execute()`
      // without the sketch knowing anything about either.
      get: () => this.evalParm(name),
      set: (next: unknown) => this.writeParameterValue(name, next),
      enumerable: true,
      configurable: true,
    });
  }

  /** Write a parameter's stored value. The prop object is replaced so a panel
   *  reading it sees the change; no cook is scheduled here — the callers that
   *  should (setParameter, updateProp) do it themselves. */
  private writeParameterValue(name: string, value: unknown): void {
    const prop = this.props[name];
    if (!prop) return;
    this.props[name] = { ...prop, value: Array.isArray(value) ? [...value] : value };
    this.props = { ...this.props };
  }

  /**
   * A parameter's stored value, before any channel or expression resolves it.
   *
   * `parameter.value` is deliberately the resolved one, so anything that has
   * to record or re-key what the author actually set — serialisation, the
   * alt-click gesture — must ask for the raw one instead. Writing the sampled
   * value back to disk would freeze an animated parameter at whatever frame
   * the save happened on.
   */
  rawParameterValue(name: string): unknown {
    if (this.props[name]) return this.props[name].value;
    return this.parameters.find(parameter => parameter.name === name)?.value;
  }

  /** Turn a parameter into an input pin, or back. */
  setParameterPromoted(name: string, promoted: boolean): void {
    const parameter = this.parameters.find(p => p.name === name);
    if (!parameter || parameter.promoted === promoted) return;
    parameter.promoted = promoted;

    if (promoted) {
      const port = this.in(name, parameter.value, {
        ...parameter.options,
        type: parameter.dataType,
        promoted: true,
      } as PortOptions);
      (port as any).fromParameter = name;
    } else {
      const index = this.inputs.findIndex(p => p.name === name);
      if (index >= 0) {
        // Drop the wires first: a pin that no longer exists must not leave
        // dangling connections behind it.
        [...this.inputs[index].connections].forEach(conn => this.graph?.disconnect(conn.id));
        this.inputs.splice(index, 1);
      }
    }
    this.markDirty();
  }

  setParameter(name: string, value: any): void {
    const parameter = this.parameters.find(p => p.name === name);
    if (!parameter) return;
    parameter.value = value;
    this.markDirty();
  }

  // ============ Parameter carry-over ============

  /**
   * Snapshot every current setting and start reconciling against whatever the
   * next definition declares. Idempotent per retarget; the snapshot stays until
   * a cook completes, so a definition that fails to compile loses nothing.
   */
  beginParameterCarryOver(): void {
    const carried = new Map<string, CarriedParameter>();

    for (const parameter of this.parameters) {
      carried.set(`parameter:${parameter.name}`, {
        name: parameter.name,
        kind: 'parameter',
        type: carryType(parameter.dataType),
        // Raw, not resolved: a retarget carries what the author set, and
        // `parameter.value` now resolves a channel or an expression.
        value: this.rawParameterValue(parameter.name),
        expression: this.props[parameter.name]?.expression,
        channel: this.props[parameter.name]?.channel,
      });
    }
    for (const [name, prop] of Object.entries(this.props)) {
      if (carried.has(`parameter:${name}`)) continue;
      carried.set(`prop:${name}`, {
        name,
        kind: 'prop',
        type: carryType(prop.type),
        value: prop.value,
        expression: prop.expression,
        channel: prop.channel,
      });
    }

    this.carryOver = {
      carried,
      resolved: new Set(),
      report: { kept: [], defaulted: [], dropped: [], retyped: [] },
    };
    this.parametersUsedDuringSetup.clear();
  }

  /** Give up on reconciling — the retarget itself failed. Values are left
   *  exactly as they were and nothing is reported as dropped. */
  abandonParameterCarryOver(): void {
    this.carryOver = null;
  }

  hasPendingParameterCarryOver(): boolean {
    return this.carryOver !== null;
  }

  /**
   * Reconcile against a declaration list the caller already has, without
   * waiting for a cook. Runs the declarations through the ordinary `param()` /
   * `addParm()` path so the node ends up in the same state either way — this
   * is the same pre-seeding deserialization does, only reported.
   */
  applyParameterDeclarations(declarations: ParameterDeclaration[]): ParameterCarryOverReport | null {
    if (!this.carryOver) return null;
    for (const declaration of declarations) {
      if (!declaration?.name) continue;
      if (declaration.kind === 'prop') {
        this.addParm(declaration.name, {
          value: declaration.defaultValue,
          type: declaration.type as any,
        } as Prop);
      } else {
        this.param(declaration.name, declaration.defaultValue, {
          ...(declaration.type ? { type: declaration.type as DataType } : {}),
        });
      }
    }
    return this.finishParameterCarryOver();
  }

  /**
   * Close the reconciliation: anything the new definition never declared is
   * dropped from the node and reported with the value it held.
   */
  finishParameterCarryOver(): ParameterCarryOverReport | null {
    const carry = this.carryOver;
    if (!carry) return null;

    for (const entry of carry.carried.values()) {
      carry.report.dropped.push({
        name: entry.name,
        value: entry.value,
        ...(entry.expression ? { expression: entry.expression } : {}),
      });

      const index = this.parameters.findIndex(p => p.name === entry.name);
      if (index >= 0) {
        // A dropped parameter that had been promoted also owns an input pin,
        // and a pin whose parameter is gone would leave dangling wires.
        if (this.parameters[index].promoted) this.setParameterPromoted(entry.name, false);
        const current = this.parameters.findIndex(p => p.name === entry.name);
        if (current >= 0) this.parameters.splice(current, 1);
      }
      if (!carry.resolved.has(`prop:${entry.name}`)) delete this.props[entry.name];
    }

    this.carryOver = null;
    this.lastCarryOverReport = carry.report;
    if (carry.report.dropped.length > 0) {
      this.props = { ...this.props };
      this.updateTimeDependent();
      Node.onPropParamsChanged?.(this.id);
    }
    return carry.report;
  }

  /** Called from param() for every declaration the new definition makes. */
  private reconcileParameter(parameter: NodeParameter, defaultValue: unknown, options: ParamOptions): void {
    const carry = this.carryOver;
    if (!carry) return;

    const key = `parameter:${parameter.name}`;
    if (carry.resolved.has(key)) return;
    carry.resolved.add(key);

    // The new definition's type wins outright, declared or inferred.
    const declared = (options.type ?? inferParamType(defaultValue)) as DataType;
    parameter.dataType = declared;
    const declaredType = carryType(declared);

    const crossKey = `prop:${parameter.name}`;
    const carried = carry.carried.get(key) ?? carry.carried.get(crossKey);
    if (!carried) {
      parameter.value = defaultValue as any;
      carry.report.defaulted.push(parameter.name);
      return;
    }
    carry.carried.delete(key);
    carry.carried.delete(crossKey);

    if (carryTypesMatch(carried.type, declaredType)) {
      parameter.value = carried.value as any;
      if (carried.expression || carried.channel) {
        this.props[parameter.name] = {
          ...(this.props[parameter.name] ?? {}),
          value: carried.value,
          ...(carried.expression ? { expression: carried.expression } : {}),
          ...(carried.channel ? { channel: carried.channel } : {}),
        } as Prop;
        carry.resolved.add(crossKey);
        this.updateTimeDependent();
      }
      carry.report.kept.push(parameter.name);
    } else {
      parameter.value = defaultValue as any;
      carry.report.retyped.push({ name: parameter.name, from: carried.type, to: declaredType });
    }
  }

  /** Called from addParm() for every prop the new definition declares. */
  private reconcileProp(name: string): void {
    const carry = this.carryOver;
    if (!carry) return;

    const key = `prop:${name}`;
    if (carry.resolved.has(key)) return;
    carry.resolved.add(key);

    const prop = this.props[name];
    const declaredType = carryType(prop?.type);
    const crossKey = `parameter:${name}`;
    const carried = carry.carried.get(key) ?? carry.carried.get(crossKey);
    if (!carried) {
      carry.report.defaulted.push(name);
      return;
    }
    carry.carried.delete(key);
    carry.carried.delete(crossKey);

    if (carryTypesMatch(carried.type, declaredType)) {
      this.props[name] = {
        ...prop,
        value: carried.value,
        ...(carried.expression ? { expression: carried.expression } : {}),
        ...(carried.channel ? { channel: carried.channel } : {}),
      } as Prop;
      if (carried.expression || carried.channel) this.updateTimeDependent();
      carry.report.kept.push(name);
    } else {
      carry.report.retyped.push({ name, from: carried.type, to: declaredType });
    }
  }

  // ============ Variadic Inputs ============

  setVariadic(defaultValue: any = null, options: PortOptions = {}): void {
    this.variadic = true;
    this.variadicDefault = defaultValue;
    this.variadicOptions = options;
    this.syncVariadicPorts();
  }

  getVariadicInputs(): InputPort[] {
    return this.inputs.filter(p => p.variadic && !p.options.hidden);
  }

  syncVariadicPorts(): void {
    if (!this.variadic) return;

    const existingPorts = this.inputs.filter(p => p.variadic);
    const usedCount = existingPorts.filter(p =>
      p.connections.length > 0 || (p.value !== null && p.value !== this.variadicDefault)
    ).length;

    for (let i = 0; i < usedCount + 1; i++) {
      const port = this.in(`input_${i}`, this.variadicDefault, {
        ...this.variadicOptions,
        hidden: false,
      });
      port.variadic = true;
      if (!port.onChange) {
        port.onChange = () => this.onUpdate?.();
      }
    }

    for (let i = usedCount + 1; i < existingPorts.length; i++) {
      if (existingPorts[i]) existingPorts[i].options.hidden = true;
    }
  }

  // ============ Path System ============

  /**
   * Get the full path of this node from the root
   * e.g., "/effects/blur1"
   */
  path(): string {
    const segments: string[] = [this.id];
    let current: Node | null = this.parent;
    while (current) {
      segments.unshift(current.id);
      current = current.parent;
    }
    return '/' + segments.join('/');
  }

  /**
   * Get child nodes (for subnet types)
   * Override in SubnetNode to return actual children
   */
  children(): Node[] {
    return this._children;
  }

  /**
   * Check if this node is a network (can contain children)
   * Override in SubnetNode to return true
   */
  isNetwork(): boolean {
    return false;
  }

  /**
   * Find a node by relative path from this node
   * Supports: "child", "../sibling", "./self", "../../parent/child"
   */
  node(relativePath: string): Node | null {
    if (!relativePath) return null;

    // Absolute path - resolve from root via graph
    if (relativePath.startsWith('/')) {
      return this.graph.nodeByPath(relativePath);
    }

    const segments = relativePath.split('/').filter(s => s.length > 0);
    let current: Node | null = this;

    for (const segment of segments) {
      if (!current) return null;

      if (segment === '.') {
        continue; // Stay at current
      }
      if (segment === '..') {
        current = current.parent; // Go up
        continue;
      }

      // Try as child node
      if (current.isNetwork()) {
        const child = current.children().find(c => c.id === segment);
        if (child) {
          current = child;
          continue;
        }
      }

      return null; // Segment not found
    }

    return current;
  }

  /**
   * Compute relative path from this node to another node
   */
  relativePathTo(other: Node): string {
    const thisPath = this.path().split('/').filter(s => s);
    const otherPath = other.path().split('/').filter(s => s);

    // Find common ancestor
    let commonLength = 0;
    while (
      commonLength < thisPath.length &&
      commonLength < otherPath.length &&
      thisPath[commonLength] === otherPath[commonLength]
    ) {
      commonLength++;
    }

    // Build relative path: go up from this, then down to other
    const ups = thisPath.length - commonLength;
    const downs = otherPath.slice(commonLength);

    const parts: string[] = [];
    for (let i = 0; i < ups; i++) {
      parts.push('..');
    }
    parts.push(...downs);

    return parts.join('/') || '.';
  }

  /**
   * Get nodes connected to this node's inputs
   */
  inputNodes(): Node[] {
    const nodes: Node[] = [];
    for (const input of this.inputs) {
      for (const conn of input.connections) {
        const node = this.graph.getNode(conn.from.nodeId);
        if (node && !nodes.includes(node)) {
          nodes.push(node);
        }
      }
    }
    return nodes;
  }

  /**
   * Get nodes connected to this node's outputs
   */
  outputNodes(): Node[] {
    const nodes: Node[] = [];
    for (const output of this.outputs) {
      for (const conn of output.connections) {
        const node = this.graph.getNode(conn.to.nodeId);
        if (node && !nodes.includes(node)) {
          nodes.push(node);
        }
      }
    }
    return nodes;
  }

  // ============ Pattern Matching (Globbing) ============

  /**
   * Convert a glob pattern to a regular expression
   * Supports: * (any chars), ? (single char), [abc] (char set), [!abc] (negated set)
   */
  private globToRegex(pattern: string): RegExp {
    let regex = '';
    let i = 0;
    while (i < pattern.length) {
      const char = pattern[i];
      switch (char) {
        case '*':
          regex += '.*';
          break;
        case '?':
          regex += '.';
          break;
        case '[':
          // Character class
          let j = i + 1;
          let classContent = '';
          if (pattern[j] === '!') {
            classContent = '^';
            j++;
          }
          while (j < pattern.length && pattern[j] !== ']') {
            classContent += pattern[j];
            j++;
          }
          regex += '[' + classContent + ']';
          i = j;
          break;
        case '.':
        case '+':
        case '^':
        case '$':
        case '(':
        case ')':
        case '{':
        case '}':
        case '|':
        case '\\':
          regex += '\\' + char;
          break;
        default:
          regex += char;
      }
      i++;
    }
    return new RegExp('^' + regex + '$');
  }

  /**
   * Match direct children against a pattern
   * Pattern syntax:
   *   * - match any characters
   *   ? - match single character
   *   [abc] - match character set
   *   [!abc] - exclude character set
   *   ^pattern - exclude matches (use with space: "* ^backup*")
   */
  glob(pattern: string): Node[] {
    const children = this.children();
    if (!pattern || pattern === '*') {
      return [...children];
    }

    // Handle exclusion patterns (e.g., "* ^backup*")
    const parts = pattern.split(/\s+/);
    const includePatterns: RegExp[] = [];
    const excludePatterns: RegExp[] = [];

    for (const part of parts) {
      if (part.startsWith('^')) {
        excludePatterns.push(this.globToRegex(part.slice(1)));
      } else {
        includePatterns.push(this.globToRegex(part));
      }
    }

    return children.filter(child => {
      // Must match at least one include pattern
      const included = includePatterns.length === 0 ||
        includePatterns.some(regex => regex.test(child.id));

      // Must not match any exclude pattern
      const excluded = excludePatterns.some(regex => regex.test(child.id));

      return included && !excluded;
    });
  }

  /**
   * Recursively match all descendants against a pattern
   * Pattern syntax same as glob(), plus:
   *   ** - match at any depth (prefix with **\/ to find nodes at any level)
   */
  recursiveGlob(pattern: string): Node[] {
    const results: Node[] = [];

    // Handle ** prefix for any-depth matching
    const isAnyDepth = pattern.startsWith('**/');
    const searchPattern = isAnyDepth ? pattern.slice(3) : pattern;

    const search = (node: Node, depth: number) => {
      const children = node.children();

      for (const child of children) {
        // For any-depth pattern, check all nodes at all levels
        if (isAnyDepth) {
          if (this.globToRegex(searchPattern).test(child.id)) {
            results.push(child);
          }
        } else if (depth === 0) {
          // For regular pattern, only match at target depth
          if (this.globToRegex(searchPattern).test(child.id)) {
            results.push(child);
          }
        }

        // Recurse into children (if network)
        if (child.isNetwork()) {
          search(child, isAnyDepth ? depth : depth - 1);
        }
      }
    };

    // If pattern is just "**", return all descendants
    if (pattern === '**') {
      const collectAll = (node: Node) => {
        for (const child of node.children()) {
          results.push(child);
          if (child.isNetwork()) {
            collectAll(child);
          }
        }
      };
      collectAll(this);
      return results;
    }

    // Count depth for non-any-depth patterns (e.g., "a/b/c" = depth 2)
    const pathDepth = isAnyDepth ? 0 : (pattern.split('/').length - 1);
    search(this, pathDepth);

    return results;
  }

  // ============ Behavior Toggles ============

  setBypass(value: boolean): void {
    this.bypass = value;
    this.markDirty();
  }

  setCook(value: boolean): void {
    // Exclusive per network: setting cook on one node clears it from siblings
    if (value && this.parent) {
      this.parent.children()
        .filter(n => n !== this && n.cook)
        .forEach(n => n.setCook(false));
    }

    this.cook = value;
    if (value) this.graph.cookingNodes.add(this);
    else this.graph.cookingNodes.delete(this);
    this.markDirty();
  }

  /**
   * Set time dependency flag (called by expression compiler)
   * Time-dependent nodes are marked dirty on each frame
   */
  setTimeDependent(value: boolean): void {
    this.isTimeDependent = value;
  }

  /**
   * Re-derive time dependency from every binding on the node.
   *
   * A keyed parameter is time-dependent for exactly the reason a
   * time-referencing expression is: its value changes with the frame, so a
   * per-frame cook has to recook the subgraph it feeds. One key is enough —
   * the value it holds is still a function of the frame everywhere else.
   */
  updateTimeDependent(): void {
    const hasTimeRef = Object.values(this.props).some(prop =>
      (prop.expression && expressionEngine.hasTimeReference(prop.expression)) ||
      !isEmptyChannel(prop.channel)
    );
    this.setTimeDependent(hasTimeRef);
  }

  shouldExecute(): boolean {
    if (this.bypass) return false;
    if (this.graph.cookingNodes.size > 0) {
      return this.cook || this.graph.isDownstreamOfCooking(this);
    }
    return true;
  }

  executeBypass(): void {
    this.inputs.forEach(input => {
      if (input.portType === 'param') {
        const matchingOutput = this.outputs.find(out => out.name === input.name || this.outputs.length === 1);
        if (matchingOutput) matchingOutput.setValue(input.value);
      }
    });
  }

  // ============ Dirty Tracking ============

  markDirty(): void {
    this.graph.scheduler.markStale(this);
  }

  /** @internal Scheduler-owned invalidation primitive. */
  invalidateCook(): void {
    this.cookGeneration++;
    this.setCookState('stale');
  }

  /** @internal Scheduler-owned state transition. */
  setCookState(state: CookState): void {
    if (this.cookState === state) return;
    this.cookState = state;
    this.graph.scheduler.notifyNodeStateChange();
  }

  /**
   * Calculate a lightweight fingerprint for an input value
   * Avoids expensive JSON.stringify on large objects like ImageBuffers
   */
  private getValueFingerprint(value: any): string {
    if (value === null || value === undefined) return 'null';
    if (typeof value !== 'object') return String(value);

    // For typed arrays (ImageBuffer channels), use length + sample values
    if (ArrayBuffer.isView(value)) {
      const arr = value as Float32Array;
      const len = arr.length;
      if (len === 0) return 'empty';
      // Sample first, middle, last values for quick fingerprint
      return `f32[${len}]:${arr[0]?.toFixed(4)},${arr[Math.floor(len/2)]?.toFixed(4)},${arr[len-1]?.toFixed(4)}`;
    }

    // For ImageBuffer-like objects, use dimensions
    if (value.width !== undefined && value.height !== undefined) {
      const channelCount = value.channelCount || value.channels?.length || 0;
      return `img:${value.width}x${value.height}x${channelCount}`;
    }

    // For HTMLCanvasElement/HTMLImageElement, use dimensions
    if ((typeof HTMLCanvasElement !== 'undefined' && value instanceof HTMLCanvasElement) ||
        (typeof HTMLImageElement !== 'undefined' && value instanceof HTMLImageElement)) {
      return `el:${value.width}x${value.height}`;
    }

    // For small objects, use JSON (but with a size limit)
    try {
      const json = JSON.stringify(value);
      if (json.length < 500) return json;
      return `obj:${json.length}:${json.slice(0, 100)}`;
    } catch {
      return `obj:${typeof value}`;
    }
  }

  private calculateInputHash(): string {
    return this.inputs.map(input => this.getValueFingerprint(input.value)).join('|');
  }

  get isDirty(): boolean {
    if (!this.hasExecuted || this.cookState !== 'clean') return true;
    return this.calculateInputHash() !== this.lastInputHash;
  }

  /**
   * Mark all downstream nodes as dirty (lazy propagation)
   */
  markDownstreamDirty(): void {
    this.graph.scheduler.markDownstreamStale(this);
  }

  /**
   * Request this node's output - triggers lazy evaluation
   * Executes dirty upstream dependencies first, then this node
   */
  async requestOutput(): Promise<void> {
    if (!this.isDirty) return;
    if (this.cookState === 'clean') this.markDirty();
    await this.graph.scheduler.flush();
  }

  // ============ Lifecycle ============

  protected setup(): void {
    // Override in subclasses
  }

  setFunction(fn: Function): void {
    this.nodeFunction = fn;
    // Reset execution state so the new function runs as initialization
    this.hasExecuted = false;
    this.markDirty();
  }

  async execute(): Promise<void> {
    // Check if this node has any execution logic
    const hasExecution = !!this.nodeFunction || this.onCook !== Node.prototype.onCook;

    if (!hasExecution) {
      this.hasExecuted = true;
      this.setCookState('clean');
      return;
    }

    const needsInitialization = !this.hasExecuted;

    if (!this.shouldExecute() && !needsInitialization && !this.isDirty) {
      this.executeBypass();
      this.setCookState('clean');
      return;
    }

    if (!needsInitialization && !this.isDirty) {
      return;
    }

    // Evaluate all expressions before execution
    this.evaluateAllExpressions();

    // Track cook time
    const startTime = performance.now();
    const startMemory = (performance as any).memory?.usedJSHeapSize ?? 0;
    const generation = this.cookGeneration;
    this.stagedOutputs = new Map();
    this.setCookState('cooking');
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      // Single entry point: onCook() handles both code-based and class-based nodes
      await Promise.race([
        Promise.resolve(this.onCook()),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error(`Node execution timeout after ${this.executionTimeout}ms`)),
            this.executionTimeout
          );
        })
      ]);

      if (generation === this.cookGeneration) {
        await this.callLifecycleHooks(needsInitialization);
        for (const [port, value] of this.stagedOutputs) {
          this.commitOutputValue(port, value);
        }
        this.error = null;
        this.hasExecuted = true;
        this.lastInputHash = this.calculateInputHash();
        // A deferred retarget only learns what the new definition declares by
        // watching it declare it, so the reconciliation closes here.
        const carryReport = this.finishParameterCarryOver();
        if (carryReport) Node.onParametersRetargeted?.(this.id, carryReport);
        this.setCookState('clean');
      } else {
        this.setCookState('stale');
      }

      // Update cook info on success
      this.updateCookInfo(startTime, startMemory);
    } catch (err: any) {
      if (generation === this.cookGeneration) {
        this.error = err as Error;
        this.setCookState('error');
      } else {
        this.setCookState('stale');
      }
      // Still update cook info on error
      this.updateCookInfo(startTime, startMemory);
      if (!err.message?.includes('timeout')) {
        console.error(`Error executing node ${this.id}:`, err);
      }
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      this.stagedOutputs = null;
    }
  }

  /**
   * Override this method in class-based nodes to implement cooking logic.
   * Base implementation calls nodeFunction if set (for code-based nodes).
   * Cook timing is handled automatically by execute().
   */
  protected onCook(): void | Promise<void> {
    // Base implementation calls nodeFunction for code-based nodes
    if (this.nodeFunction) {
      return this.nodeFunction(this, this.graph);
    }
  }

  /**
   * Update cook info after execution
   * Protected so subclasses can call it for manual cook tracking
   */
  protected updateCookInfo(startTime: number, startMemory: number = 0): void {
    const endTime = performance.now();
    const cookTime = endTime - startTime;

    this.cookInfo.lastCookTime = cookTime;
    this.cookInfo.totalCookTime += cookTime;
    this.cookInfo.cookCount++;
    this.cookInfo.averageCookTime = this.cookInfo.totalCookTime / this.cookInfo.cookCount;
    this.cookInfo.lastCookTimestamp = Date.now();

    // Track memory if available (Chrome only)
    const endMemory = (performance as any).memory?.usedJSHeapSize ?? 0;
    if (startMemory && endMemory) {
      const memoryUsed = endMemory - startMemory;
      if (memoryUsed > this.cookInfo.peakMemory) {
        this.cookInfo.peakMemory = memoryUsed;
      }
    }
  }

  /**
   * Start cook timing - returns start time to pass to endCook()
   * Use for class-based nodes that don't go through execute()
   */
  protected startCook(): number {
    return performance.now();
  }

  /**
   * End cook timing - call with the value returned from startCook()
   */
  protected endCook(startTime: number): void {
    this.updateCookInfo(startTime, 0);
  }

  /**
   * Reset cook statistics
   */
  resetCookInfo(): void {
    this.cookInfo = {
      lastCookTime: 0,
      totalCookTime: 0,
      cookCount: 0,
      averageCookTime: 0,
      lastCookTimestamp: 0,
      peakMemory: 0
    };
  }

  private async callLifecycleHooks(isFirstRun: boolean): Promise<void> {
    const isBrowserAPIError = (err: any): boolean => {
      const msg = err?.message || String(err);
      return msg.includes('document is not defined') || msg.includes('window is not defined') ||
             msg.includes('HTMLCanvasElement') || msg.includes('HTMLImageElement');
    };

    if (isFirstRun && this.onSetup) {
      try { await this.onSetup(); }
      catch (err: any) { if (!isBrowserAPIError(err)) console.error(`Error in onSetup for ${this.id}:`, err); }
    }

    if (this.onUpdate) {
      try { await this.onUpdate(); }
      catch (err: any) { if (!isBrowserAPIError(err)) console.error(`Error in onUpdate for ${this.id}:`, err); }
    }

    if (this.onRender) {
      try { await this.onRender(); }
      catch (err: any) { if (!isBrowserAPIError(err)) console.error(`Error in onRender for ${this.id}:`, err); }
    }

    if (isFirstRun && this.onReady) {
      try { this.onReady(); }
      catch (err: any) { if (!isBrowserAPIError(err)) console.error(`Error in onReady for ${this.id}:`, err); }
    }
  }

  // ============ Rename ============

  rename(newId: string): string {
    if (!newId?.trim()) return this.id;
    const sanitizedId = newId.trim().replace(/\s+/g, '');
    if (!sanitizedId) return this.id;
    const uniqueId = this.graph.generateUniqueNodeId(sanitizedId, this.id);
    if (this.graph.renameElement(this.id, uniqueId)) this.markDirty();
    return this.id;
  }

  protected isPreviewValue(value: unknown): value is HTMLCanvasElement | HTMLImageElement {
    return (typeof HTMLCanvasElement !== 'undefined' && value instanceof HTMLCanvasElement) ||
      (typeof HTMLImageElement !== 'undefined' && value instanceof HTMLImageElement);
  }

  // ============ Package Manager ============

  async require(packageName: string, version?: string): Promise<any> {
    if (!this.graph.packageManager) throw new Error('PackageManager not initialized');
    return this.graph.packageManager.load(packageName, version);
  }

  get assets() {
    return this.graph.assetManager;
  }

  // ============ Utilities ============

  log(...args: any[]): void {
    console.log(`[${this.id}]`, ...args);
  }

  resetPortTracking(): void {
    this.portsUsedDuringSetup.clear();
  }

  // ============ State Preservation ============

  preserveState() {
    return {
      inputs: this.inputs.map(p => ({ id: p.id, name: p.name, value: p.value, connections: p.connections.map(c => c.id) })),
      outputs: this.outputs.map(p => ({ id: p.id, name: p.name, value: p.value, connections: p.connections.map(c => c.id) })),
      props: Object.fromEntries(Object.entries(this.props).map(([k, p]) => [k, p.value])),
      bypass: this.bypass,
      cook: this.cook
    };
  }

  restoreState(state: any): void {
    state.inputs?.forEach((s: any) => {
      const port = this.inputs.find(p => p.id === s.id || p.name === s.name);
      if (port) port.value = s.value;
    });
    state.outputs?.forEach((s: any) => {
      const port = this.outputs.find(p => p.id === s.id || p.name === s.name);
      if (port) port.value = s.value;
    });
    if (state.props) {
      Object.entries(state.props).forEach(([k, v]) => {
        if (this.props[k]) this.props[k].value = v;
      });
    }
    if (state.bypass !== undefined) this.setBypass(state.bypass);
    if (state.cook !== undefined) this.setCook(state.cook);
  }

  // ============ Port Cleanup ============

  cleanupUnusedPorts(): void {
    const used = this.portsUsedDuringSetup;

    this.inputs = this.inputs.filter(port => {
      if (!used.has(`input_${port.name}`)) {
        port.connections.forEach(c => this.graph.disconnect(c.id));
        this._portMap.delete(port.id);
        return false;
      }
      return true;
    });

    this.outputs = this.outputs.filter(port => {
      if (!used.has(`output_${port.name}`)) {
        port.connections.forEach(c => this.graph.disconnect(c.id));
        this._portMap.delete(port.id);
        return false;
      }
      return true;
    });

    this.portsUsedDuringSetup.clear();
  }

  // ============ Serialization ============

  toJSON() {
    const fullType = typeToPackagePath(this.type);
    const result: any = {
      id: this.id,
      type: fullType,
      position: [this.position.x, this.position.y]
    };

    if (!isStandardLibraryNode(fullType) && this.code) {
      result.code = this.code;
    }

    if (this.comment?.trim()) result.comment = this.comment;

    const props = Object.fromEntries(
      Object.entries(this.props).map(([k, p]) => {
        let v = p.value;
        if (p.type === 'color' && isColorValue(v)) {
          const n = normalizeColor(v as any);
          v = [n.r, n.g, n.b, n.a ?? 1.0];
        }
        // Include expression if present
        if (p.expression) {
          return [k, { value: v, expression: p.expression }];
        }
        return [k, v];
      })
    );
    if (Object.keys(props).length > 0) result.props = props;

    if (this.bypass) result.bypass = true;
    if (this.cook) result.cook = true;

    return result;
  }
}
