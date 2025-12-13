import type { InputPort, OutputPort, PortOptions, PortType, Prop } from '../types/node.types.js';
import type { Graph } from './Graph.js';
import { typeToPackagePath, isStandardLibraryNode } from '../utils/nodeTypeUtils.js';
import { normalizeColor, isColorValue } from '../utils/colorUtils.js';
import { expressionEngine } from '../engine/expressions/index.js';

/**
 * Node - Unified base class for all graph elements
 *
 * Subclasses override behavior as needed (e.g., Annotation overrides execute()).
 */
export class Node {
  // Static callback for UI reactivity (set by editor, not required for headless)
  static onPropParamsChanged?: (nodeId: string) => void;

  id: string;
  type: string;
  position: { x: number; y: number };

  // Ports - available to all nodes
  inputs: InputPort[] = [];
  outputs: OutputPort[] = [];

  // Props system
  props: Record<string, Prop> = {};
  protected propWatchers: Map<string, Function[]> = new Map();

  // Variadic inputs
  variadic: boolean = false;
  protected variadicDefault: any = null;

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
  protected manualDirty: boolean = false;
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
      options: {},

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

  /**
   * Add a parameter to this node
   * Short alias for defineProp - use in setup()
   */
  addParm<T>(name: string, config: Prop<T>): void {
    this.props[name] = config as Prop;
    this.markDirty();
  }

  /**
   * Define a parameter on this node
   * @deprecated Use addParm() instead
   */
  defineProp<T>(name: string, config: Prop<T>): void {
    this.addParm(name, config);
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
  } | null {
    const prop = this.props[name];
    if (!prop) return null;

    const self = this;
    return {
      name: () => name,
      path: () => `${self.path()}/${name}`,
      node: () => self,
      eval: () => prop.value,
      evalAsFloat: () => parseFloat(prop.value) || 0,
      evalAsInt: () => parseInt(prop.value, 10) || 0,
      evalAsString: () => String(prop.value ?? ''),
      rawValue: () => prop.value,
      set: (value: any) => self.updateProp(name, value),
      parmType: () => prop.type || 'any',
      // Expression support
      expression: () => prop.expression ?? null,
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
      hasExpression: () => !!prop.expression,
      expressionError: () => prop.expressionError ?? null
    };
  }

  /**
   * Evaluate a parameter value directly (shorthand for props access)
   * If the prop has an expression, evaluates it; otherwise returns the raw value
   */
  evalParm(name: string): any {
    const prop = this.props[name];
    if (!prop) return undefined;

    // If prop has an expression, evaluate it
    if (prop.expression) {
      return this.evaluateExpression(name);
    }

    return prop.value;
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
      if (prop.expression) {
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

  // ============ Variadic Inputs ============

  setVariadic(defaultValue: any = null): void {
    this.variadic = true;
    this.variadicDefault = defaultValue;
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
      const port = this.in(`input_${i}`, this.variadicDefault, { hidden: false });
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
   * Check all expressions and update time dependency flag
   */
  updateTimeDependent(): void {
    const hasTimeRef = Object.values(this.props).some(prop =>
      prop.expression && expressionEngine.hasTimeReference(prop.expression)
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

  /**
   * Mark all downstream nodes as dirty (lazy propagation)
   */
  markDownstreamDirty(): void {
    const visited = new Set<string>();

    const propagate = (node: Node) => {
      for (const output of node.outputs) {
        for (const conn of output.connections) {
          if (visited.has(conn.to.nodeId)) continue;
          visited.add(conn.to.nodeId);

          const downstream = this.graph.getNode(conn.to.nodeId);
          if (downstream) {
            downstream.manualDirty = true;
            propagate(downstream);
          }
        }
      }
    };

    propagate(this);
  }

  /**
   * Request this node's output - triggers lazy evaluation
   * Executes dirty upstream dependencies first, then this node
   */
  async requestOutput(): Promise<void> {
    if (!this.isDirty) return;

    // Collect dirty upstream nodes (depth-first for dependency order)
    const dirtyUpstream = this.collectDirtyUpstream();

    // Execute upstream in order (already sorted by depth-first collection)
    for (const node of dirtyUpstream) {
      if (node.isDirty) {
        await node.execute();
      }
    }

    // Execute this node
    await this.execute();
  }

  private collectDirtyUpstream(): Node[] {
    const result: Node[] = [];
    const visited = new Set<string>();

    const collect = (node: Node) => {
      for (const input of node.inputs) {
        for (const conn of input.connections) {
          if (visited.has(conn.from.nodeId)) continue;
          visited.add(conn.from.nodeId);

          const upstream = this.graph.getNode(conn.from.nodeId);
          if (upstream) {
            collect(upstream); // Depth-first: go deeper first
            if (upstream.isDirty) {
              result.push(upstream);
            }
          }
        }
      }
    };

    collect(this);
    return result;
  }

  // ============ Lifecycle ============

  protected setup(): void {
    // Override in subclasses
  }

  setFunction(fn: Function): void {
    this.nodeFunction = fn;
    // Reset execution state so the new function runs as initialization
    this.hasExecuted = false;
  }

  private createTimeoutPromise(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Node execution timeout after ${ms}ms`)), ms);
    });
  }

  async execute(): Promise<void> {
    // Check if this node has any execution logic
    const hasExecution = !!this.nodeFunction || this.onCook !== Node.prototype.onCook;

    if (!hasExecution) {
      return;
    }

    const needsInitialization = !this.hasExecuted;

    if (!this.shouldExecute() && !needsInitialization && !this.manualDirty) {
      this.executeBypass();
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

    try {
      // Single entry point: onCook() handles both code-based and class-based nodes
      await Promise.race([
        Promise.resolve(this.onCook()),
        this.createTimeoutPromise(this.executionTimeout)
      ]);

      this.error = null;
      this.hasExecuted = true;
      this.lastInputHash = this.calculateInputHash();
      this.manualDirty = false;

      await this.callLifecycleHooks(needsInitialization);

      // Update cook info on success
      this.updateCookInfo(startTime, startMemory);
    } catch (err: any) {
      this.error = err as Error;
      this.manualDirty = true;
      // Still update cook info on error
      this.updateCookInfo(startTime, startMemory);
      if (!err.message?.includes('timeout')) {
        console.error(`Error executing node ${this.id}:`, err);
      }
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