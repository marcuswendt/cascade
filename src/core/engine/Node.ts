import type { InputPort, OutputPort, PortOptions, PortType, Prop, VariadicConfig } from '../../types/node.types.js';
import type { Graph } from './Graph.js';
import { typeToPackagePath, isStandardLibraryNode } from '../../utils/nodeTypeUtils.js';
import { normalizeColor, isColorValue } from '../../utils/colorUtils.js';

export type ElementKind = 'computation' | 'annotation';

/**
 * Annotation style configuration
 */
export interface AnnotationStyle {
  fontSize?: number;
  fontWeight?: 'normal' | 'bold' | '600' | '700';
  fontStyle?: 'normal' | 'italic';
  textAlign?: 'left' | 'center' | 'right';
  color?: string;
  backgroundColor?: string;
  padding?: number;
  borderRadius?: number;
  borderLeft?: string;
  strokeWidth?: number;
  strokeColor?: string;
}

/**
 * Node - Unified base class for all graph elements
 *
 * This single class handles both computations and annotations.
 * The `kind` property distinguishes behavior where needed.
 */
export class Node {
  id: string;
  kind: ElementKind;
  type: string;
  position: { x: number; y: number };

  // Ports - available to all nodes
  inputs: InputPort[] = [];
  outputs: OutputPort[] = [];

  // Props system
  props: Record<string, Prop> = {};
  protected propWatchers: Map<string, Function[]> = new Map();

  // Variadic inputs
  protected variadicConfigs: Map<string, VariadicConfig> = new Map();

  // Visual
  preview: HTMLCanvasElement | HTMLImageElement | null = null;

  // Metadata
  comment: string = '';
  error: Error | null = null;
  warning: string | null = null;

  // Annotation-specific (only used when kind === 'annotation')
  size?: { width: number; height: number };
  style?: AnnotationStyle;
  caption?: string;
  containedElements?: string[];

  // Computation-specific
  code: string = '';
  isTemplate: boolean = false;
  bypassed: boolean = false;
  cooking: boolean = false;
  bypassOpacity: number = 1.0;
  cookAnimation: boolean = false;

  // Execution state
  protected hasExecuted: boolean = false;
  protected lastInputHash: string = '';
  protected manualDirty: boolean = false;
  executionTimeout: number = 30000;

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

  constructor(id: string, type: string, graph: Graph, kind: ElementKind = 'computation') {
    this.id = id;
    this.kind = kind;
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
      Object.assign(existingPort.options, options);
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
    this.portsUsedDuringSetup.add(`input_${name}`);
    return port;
  }

  out<T>(name: string, portType: PortType = 'param'): OutputPort<T> {
    const existingPort = this.outputs.find(p => p.name === name);
    if (existingPort) {
      this.portsUsedDuringSetup.add(`output_${name}`);
      if (existingPort.portType !== portType) existingPort.portType = portType;
      return existingPort as OutputPort<T>;
    }

    const portIndex = this.outputs.length;
    const port: OutputPort<T> = {
      id: `${this.id}_out_${portIndex}`,
      name,
      portType,
      dataType: 'any',
      value: undefined as T,
      connections: [],

      setValue: (value: T) => {
        port.value = value;
        port.connections.forEach(conn => {
          const targetNode = this.graph.getNode(conn.to.nodeId);
          if (targetNode) {
            const targetPort = targetNode.inputs.find(p => p.id === conn.to.portId);
            if (targetPort) {
              targetPort.value = value;
              if (targetPort.onChange) targetPort.onChange(value);
            }
          }
        });
      },

      trigger: (props?: any) => {
        port.connections.forEach(conn => {
          const targetNode = this.graph.getNode(conn.to.nodeId);
          if (targetNode) {
            const targetPort = targetNode.inputs.find(p => p.id === conn.to.portId);
            if (targetPort && targetPort.onTrigger) targetPort.onTrigger(props);
          }
        });
      }
    };

    this.outputs.push(port as OutputPort);
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

  getPort(portId: string): InputPort | OutputPort | null {
    return this.inputs.find(p => p.id === portId) || this.outputs.find(p => p.id === portId) || null;
  }

  // ============ Props System ============

  defineProp<T>(name: string, config: Prop<T>): void {
    this.props[name] = config as Prop;
    this.markDirty();
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
  }

  watchProp(name: string, callback: Function): void {
    if (!this.propWatchers.has(name)) this.propWatchers.set(name, []);
    this.propWatchers.get(name)!.push(callback);
  }

  // ============ Variadic Inputs ============

  defineVariadicInput(baseName: string, config: Partial<Omit<VariadicConfig, 'baseName'>> = {}): void {
    const fullConfig: VariadicConfig = {
      baseName,
      minCount: config.minCount ?? 1,
      maxCount: config.maxCount,
      defaultValue: config.defaultValue ?? null,
      portOptions: config.portOptions ?? {}
    };
    this.variadicConfigs.set(baseName, fullConfig);
    this.syncVariadicPorts(baseName);
  }

  getVariadicInputs(baseName: string): InputPort[] {
    return this.inputs.filter(p => p.name.startsWith(`${baseName}_`) && !p.options.hidden);
  }

  syncVariadicPorts(baseName: string): void {
    const config = this.variadicConfigs.get(baseName);
    if (!config) return;

    const existingPorts = this.inputs.filter(p => p.name.startsWith(`${baseName}_`));
    const usedCount = existingPorts.filter(p =>
      p.connections.length > 0 || (p.value !== null && p.value !== config.defaultValue)
    ).length;

    const targetCount = Math.max(config.minCount, Math.min(usedCount + 1, config.maxCount ?? Infinity));

    for (let i = 0; i < targetCount; i++) {
      this.in(`${baseName}_${i}`, config.defaultValue, { ...config.portOptions, hidden: false });
    }

    for (let i = targetCount; i < existingPorts.length; i++) {
      if (existingPorts[i]) existingPorts[i].options.hidden = true;
    }
  }

  getVariadicConfigs(): Map<string, VariadicConfig> {
    return this.variadicConfigs;
  }

  // ============ Behavior Toggles ============

  setBypassed(value: boolean): void {
    this.bypassed = value;
    this.bypassOpacity = value ? 0.5 : 1.0;
    this.markDirty();
  }

  setCooking(value: boolean): void {
    this.cooking = value;
    this.cookAnimation = value;
    if (value) this.graph.cookingNodes.add(this);
    else this.graph.cookingNodes.delete(this);
    this.markDirty();
  }

  shouldExecute(): boolean {
    if (this.bypassed) return false;
    if (this.graph.cookingNodes.size > 0) {
      return this.cooking || this.graph.isDownstreamOfCooking(this);
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
    this.manualDirty = true;
  }

  private calculateInputHash(): string {
    return this.inputs.map(input => {
      const value = input.value;
      if (value === null || value === undefined) return 'null';
      if (typeof value === 'object') {
        try { return JSON.stringify(value); }
        catch { return String(value); }
      }
      return String(value);
    }).join('|');
  }

  get isDirty(): boolean {
    if (!this.hasExecuted || this.manualDirty) return true;
    return this.calculateInputHash() !== this.lastInputHash;
  }

  // ============ Lifecycle ============

  protected setup(): void {
    // Override in subclasses
  }

  setFunction(fn: Function): void {
    this.nodeFunction = fn;
  }

  private createTimeoutPromise(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Node execution timeout after ${ms}ms`)), ms);
    });
  }

  async execute(): Promise<void> {
    // Annotations don't execute
    if (this.kind === 'annotation') return;
    if (!this.nodeFunction) return;

    const needsInitialization = !this.hasExecuted;

    if (!this.shouldExecute() && !needsInitialization) {
      this.executeBypass();
      return;
    }

    if (!needsInitialization && !this.isDirty) return;

    try {
      await Promise.race([
        this.nodeFunction(this, this.graph),
        this.createTimeoutPromise(this.executionTimeout)
      ]);

      this.error = null;
      this.hasExecuted = true;
      this.lastInputHash = this.calculateInputHash();
      this.manualDirty = false;

      await this.callLifecycleHooks(needsInitialization);
    } catch (err: any) {
      this.error = err as Error;
      this.manualDirty = true;
      if (!err.message?.includes('timeout')) {
        console.error(`Error executing node ${this.id}:`, err);
      }
    }
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
    this.id = this.graph.generateUniqueNodeId(sanitizedId, this.id);
    this.markDirty();
    return this.id;
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
      bypassed: this.bypassed,
      cooking: this.cooking
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
    if (state.bypassed !== undefined) this.setBypassed(state.bypassed);
    if (state.cooking !== undefined) this.setCooking(state.cooking);
  }

  // ============ Port Cleanup ============

  cleanupUnusedPorts(): void {
    const used = this.portsUsedDuringSetup;

    this.inputs = this.inputs.filter(port => {
      if (!used.has(`input_${port.name}`)) {
        port.connections.forEach(c => this.graph.disconnect(c.id));
        return false;
      }
      return true;
    });

    this.outputs = this.outputs.filter(port => {
      if (!used.has(`output_${port.name}`)) {
        port.connections.forEach(c => this.graph.disconnect(c.id));
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
        return [k, v];
      })
    );
    if (Object.keys(props).length > 0) result.props = props;

    if (this.bypassed) result.bypass = true;
    if (this.cooking) result.cook = true;

    return result;
  }
}

// Re-export for backwards compatibility during transition
export { Node as Computation };
