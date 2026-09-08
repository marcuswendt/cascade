import { Node } from './Node.js';
import type { ParameterCarryOverReport, ParameterDeclaration } from './Node.js';
import { Annotation } from './annotations/Annotation.js';
import { ImageAnnotation } from './annotations/Image.js';
import { TextAnnotation } from './annotations/Text.js';
import { GroupAnnotation } from './annotations/Group.js';
import { LineAnnotation } from './annotations/Line.js';
import { PolylineAnnotation } from './annotations/Polyline.js';
import { AssetManager } from '../engine/AssetManager.js';
import { PackageManager } from '../engine/PackageManager.js';
import { ModuleResolver, createModuleResolver } from '../engine/ModuleResolver.js';
import { GraphValidator, type ValidationResult } from '../engine/GraphValidator.js';
import type {
  Connection,
  InputPort,
  OutputPort,
  ProjectPackage,
  EmbeddedModule,
  ExternalModule,
  ProjectConfig,
  NodeSource,
  NodeParameter
} from '../types/node.types.js';
import { packagePathToType, isStandardLibraryNode, getNodeClass, getNodeDisplayName } from '../utils/nodeTypeUtils.js';
import { loadProjectModule, loadEmbeddedModule } from '../engine/nodeModuleLoader.js';
import { normalizeColor, isColorValue } from '../utils/colorUtils.js';
import { canConnect, normalizeType } from '../types/coreTypes.js';
import { CookScheduler } from './CookScheduler.js';

// Current file format version
export const GRAPH_FORMAT_VERSION = '0.2';

/**
 * Parse a port ID to extract element ID, port type, and index
 * Format: ${elementId}_${portType}_${index}
 */
function parsePortId(portId: string): { elementId: string; portType: 'input' | 'output'; index: number } {
  const parts = portId.split('_');
  if (parts.length < 3) {
    throw new Error(`Invalid port ID format: ${portId}`);
  }
  const portType = parts[parts.length - 2] as 'input' | 'output';
  const index = parseInt(parts[parts.length - 1], 10);
  if (isNaN(index)) {
    throw new Error(`Invalid port index in port ID: ${portId}`);
  }
  const elementId = parts.slice(0, -2).join('_');
  return { elementId, portType, index };
}

/**
 * Create a port ID from element ID, port type, and index
 */
function createPortId(elementId: string, portType: 'input' | 'output', index: number): string {
  return `${elementId}_${portType}_${index}`;
}

export type ExecutionState = 'idle' | 'running' | 'paused' | 'stopped';

/** A parameter as the incoming definition declares it. Re-exported name kept
 *  deliberately short: this is what a Definition panel already has in hand. */
export type RetargetParameterDeclaration = ParameterDeclaration;

/**
 * The outcome of Graph.retargetDefinition — flat, JSON-serialisable, and
 * enough on its own to render an honest summary:
 *
 *   "kept 4 · 1 new · 3 dropped: weight, dot_scale, seed"
 *
 * `ok` is false only when the retarget itself could not happen (no such node);
 * `error` then says why. `deferred` means the new definition's parameter list
 * was not supplied, so nothing could be reconciled yet — the arrays are empty
 * and the real report arrives on the next successful cook, via
 * Node.onParametersRetargeted or node.lastCarryOverReport.
 */
export interface RetargetResult extends ParameterCarryOverReport {
  ok: boolean;
  deferred: boolean;
  error?: string;
}

/**
 * Type representing annotation data structure used in UI
 */
export type CanvasAnnotation = Annotation & {
  content?: string;
  src?: string;
  endPosition?: { x: number; y: number };
  points?: { x: number; y: number }[];
};

export class Graph {
  private _elements: Node[] = [];
  private _elementMap: Map<string, Node> = new Map(); // O(1) lookup cache
  connections: Connection[] = [];
  private _connectionMap: Map<string, Connection> = new Map(); // O(1) connection lookup
  private connectionIdCounter: number = 0;
  packageManager: PackageManager;
  assetManager: AssetManager;
  moduleResolver: ModuleResolver;

  // Project configuration (v0.2)
  project: ProjectConfig = { packages: [] };
  private createdAt = new Date().toISOString();

  get created(): string { return this.createdAt; }

  /**
   * Unified elements array (computations and annotations)
   */
  get elements(): Node[] {
    return this._elements;
  }

  set elements(value: Node[]) {
    this._elements = value;
    // Rebuild the element map for O(1) lookups
    this._elementMap.clear();
    for (const el of value) {
      this._elementMap.set(el.id, el);
    }
  }

  // Execution Control
  cookingNodes: Set<Node> = new Set();
  readonly scheduler: CookScheduler;

  // Execution state
  executionState: ExecutionState = 'idle';

  // Cached topological order (invalidated when graph structure changes)
  private cachedTopologicalOrder: string[] | null = null;
  
  constructor(assetManager?: AssetManager, packageManager?: PackageManager, moduleResolver?: ModuleResolver) {
    this.assetManager = assetManager || new AssetManager();
    this.packageManager = packageManager || new PackageManager();
    this.moduleResolver = moduleResolver || createModuleResolver();
    this.scheduler = new CookScheduler(this);
  }
  
  /**
   * Helper to check if an element is an annotation
   * Uses marker property for reliability (survives HMR and serialization)
   */
  private isAnnotation(element: Node): element is CanvasAnnotation {
    return (element as any).isAnnotation === true;
  }

  /**
   * Get all computations (non-annotation nodes)
   */
  get nodes(): Node[] {
    return this._elements.filter(e => !this.isAnnotation(e)) as Node[];
  }

  /**
   * Set computations (triggers Svelte reactivity)
   */
  set nodes(value: Node[]) {
    this._elements = [...this._elements.filter(e => this.isAnnotation(e)), ...value];
  }

  /**
   * Get all annotations
   */
  get annotations(): CanvasAnnotation[] {
    return this._elements.filter(e => this.isAnnotation(e)) as CanvasAnnotation[];
  }

  /**
   * Set annotations (triggers Svelte reactivity)
   */
  set annotations(value: CanvasAnnotation[]) {
    this._elements = [...this._elements.filter(e => !this.isAnnotation(e)), ...value];
  }
  
  /**
   * Generates a unique element ID based on a base ID.
   * If the base ID ends in a number (e.g., "Checkers1"), strips it and increments.
   * Always appends a number starting from 1 (e.g., "Checkers1", "Checkers2").
   * Ensures the ID has no spaces.
   * @param baseId The base ID to use (typically the element type or existing node ID)
   * @param excludeElementId Optional element ID to exclude from uniqueness check (useful when renaming)
   * @returns A unique element ID with no spaces
   */
  generateUniqueNodeId(baseId: string, excludeElementId?: string): string {
    // Remove spaces from base ID
    const sanitizedBaseId = baseId.replace(/\s+/g, '');

    // Strip trailing numbers to get the base name
    // e.g., "Checkers1" -> "Checkers", "Checkers123" -> "Checkers", "Checkers" -> "Checkers"
    const match = sanitizedBaseId.match(/^(.+?)(\d+)?$/);
    const baseName = match ? match[1] : sanitizedBaseId;

    // Always use numbered versions starting from 1
    let counter = 1;
    let candidateId = `${baseName}${counter}`;

    // Find the first available numbered ID
    while (this._elements.some(
      element => element.id === candidateId && (!excludeElementId || element.id !== excludeElementId)
    )) {
      counter++;
      candidateId = `${baseName}${counter}`;
    }

    return candidateId;
  }

  /**
   * Get any element by ID (O(1) using Map cache)
   */
  getElement(id: string): Node | null {
    return this._elementMap.get(id) || null;
  }

  /**
   * Get a computation by ID (type-safe)
   */
  getNode(nodeId: string): Node | null {
    const element = this.getElement(nodeId);
    return element && !this.isAnnotation(element) ? element : null;
  }

  /**
   * Get an annotation by ID (type-safe)
   */
  getAnnotation(id: string): Annotation | null {
    const element = this.getElement(id);
    return element && this.isAnnotation(element) ? element as Annotation : null;
  }

  /**
   * Get a node by absolute path (e.g., "/effects/blur1")
   */
  nodeByPath(path: string): Node | null {
    if (!path.startsWith('/')) return null;

    const segments = path.slice(1).split('/').filter(s => s.length > 0);
    if (segments.length === 0) return null;

    let current = this.nodes.find(node => !node.parent && node.id === segments[0]) ?? null;
    for (let index = 1; current && index < segments.length; index++) {
      if (!current.isNetwork()) return null;
      current = current.children().find(child => child.id === segments[index]) ?? null;
    }
    return current;
  }

  /**
   * Add an element to the graph
   */
  addElement(element: Node): void {
    this._elements.push(element);
    this._elementMap.set(element.id, element);
    this.invalidateTopologicalOrder();
  }

  /**
   * Move an element between networks while keeping both sides of the parent
   * relationship consistent. Structural editor code must use this instead of
   * mutating `parent` or `_children` directly.
   */
  reparentElement(element: Node, parent: Node | null): boolean {
    if (parent) {
      if (!parent.isNetwork() || parent === element) return false;
      for (let ancestor: Node | null = parent; ancestor; ancestor = ancestor.parent) {
        if (ancestor === element) return false;
      }
    }
    if (element.parent === parent) return true;

    const previous = element.parent;
    if (previous) {
      const removeChild = (previous as any).removeChild;
      if (typeof removeChild === 'function') removeChild.call(previous, element);
      else {
        (previous as any)._children = previous.children().filter(child => child !== element);
        element.parent = null;
      }
    }

    if (parent) {
      const addChild = (parent as any).addChild;
      if (typeof addChild === 'function') addChild.call(parent, element);
      else {
        element.parent = parent;
        (parent as any)._children.push(element);
      }
    }
    this.invalidateTopologicalOrder();
    return true;
  }

  /**
   * Remove an element from the graph
   */
  removeElement(id: string): void {
    const element = this._elementMap.get(id);
    if (!element) return;

    const removed: Node[] = [];
    const visited = new Set<Node>();
    const collect = (candidate: Node): void => {
      if (visited.has(candidate)) return;
      visited.add(candidate);
      candidate.children().forEach(collect);
      removed.push(candidate);
    };
    collect(element);

    const removedIds = new Set(removed.map(candidate => candidate.id));
    this.connections
      .filter(connection => removedIds.has(connection.from.nodeId) || removedIds.has(connection.to.nodeId))
      .forEach(connection => this.disconnect(connection.id));

    const pending = (this as any)._connectionsToRestore;
    if (Array.isArray(pending)) {
      (this as any)._connectionsToRestore = pending.filter((connection: any) => {
        const fromId = Array.isArray(connection?.[0]) ? connection[0][0] : undefined;
        const toId = Array.isArray(connection?.[1]) ? connection[1][0] : undefined;
        return !removedIds.has(fromId) && !removedIds.has(toId);
      });
    }

    this._elements = this._elements.filter(candidate => !removedIds.has(candidate.id));
    for (const candidate of removed) {
      this._elementMap.delete(candidate.id);
      this.cookingNodes.delete(candidate);
    }

    // `removed` is deepest-first, so every child is detached before its parent.
    for (const candidate of removed) {
      const parent = candidate.parent;
      if (parent) {
        const removeChild = (parent as any).removeChild;
        if (typeof removeChild === 'function') removeChild.call(parent, candidate);
        else candidate.parent = null;
      }
    }

    this.invalidateTopologicalOrder();
    for (const candidate of removed) candidate.onDestroy?.();
  }

  /**
   * Rename an element's ID, updating internal maps
   */
  renameElement(oldId: string, newId: string): boolean {
    const element = this._elementMap.get(oldId);
    if (!element || !newId || (oldId !== newId && this._elementMap.has(newId))) return false;
    if (oldId === newId) return true;

    const renamedPorts = element.renameId(newId);
    this._elementMap.delete(oldId);
    this._elementMap.set(newId, element);

    for (const connection of this.connections) {
      if (connection.from.nodeId === oldId) connection.from.nodeId = newId;
      if (connection.to.nodeId === oldId) connection.to.nodeId = newId;
      connection.from.portId = renamedPorts.get(connection.from.portId) ?? connection.from.portId;
      connection.to.portId = renamedPorts.get(connection.to.portId) ?? connection.to.portId;
    }

    const pending = (this as any)._connectionsToRestore;
    if (Array.isArray(pending)) {
      for (const connection of pending) {
        for (const endpoint of Array.isArray(connection) ? connection : []) {
          if (Array.isArray(endpoint) && endpoint[0] === oldId) endpoint[0] = newId;
        }
      }
    }
    for (const annotation of this.annotations) {
      if (Array.isArray(annotation.containedElements)) {
        annotation.containedElements = annotation.containedElements.map(id => id === oldId ? newId : id);
      }
    }

    this.invalidateTopologicalOrder();
    return true;
  }

  addNode(type: string, position: { x: number; y: number }): Node {
    // Get display name for ID generation (uses metadata if available, falls back to type)
    const displayName = getNodeDisplayName(type);
    // Convert to lowercase with underscores (e.g., "Prompt to Image" -> "prompt_to_image")
    const baseId = displayName.toLowerCase().replace(/\s+/g, '_');

    // Generate unique ID automatically based on display name
    const id = this.generateUniqueNodeId(baseId);

    // Try to get a class-based node first (for stdlib nodes)
    const NodeClass = getNodeClass(type);
    let node: Node;

    if (NodeClass) {
      // Class-based node - instantiate directly
      node = new NodeClass(id, this);
    } else {
      // Fallback: create base Node for custom/function-based nodes
      node = new Node(id, packagePathToType(type), this);
    }

    // Store full module path and source type for serialization
    // This ensures custom nodes (local.*) are saved correctly
    (node as any).modulePath = type;
    if (isStandardLibraryNode(type)) {
      (node as any).sourceType = 'stdlib';
    } else if (type.startsWith('local.')) {
      (node as any).sourceType = 'embedded';
    } else {
      // Check module resolver for project modules
      const sourceType = this.moduleResolver.getSourceType(type);
      (node as any).sourceType = sourceType || 'embedded';
    }

    node.position = position;
    this.addElement(node);

    return node;
  }
  
  /**
   * Point an existing node instance at a different module.
   *
   * Duplicating a built-in into an editable copy, and promoting an embedded
   * node to a file, both keep the node where it is on the canvas with its
   * connections and parameter values intact and only change which module
   * supplies `execute`. The compiled module is captured once when a node is
   * loaded, so swapping the path alone would leave the old code running.
   *
   * Ports and parameters are untouched on purpose: both callers move IDENTICAL
   * code, so the ports and settings the next cook declares are the ones already
   * there, and reconciling them would only be a chance to be wrong.
   *
   * Switching to a different VERSION of a definition is a different move — use
   * retargetDefinition, which reconciles and reports.
   */
  retargetModule(
    nodeId: string,
    modulePath: string,
    source: 'embedded' | 'project',
    code?: string,
  ): boolean {
    return this.retargetDefinition(nodeId, modulePath, source, code, {
      preserveParameters: false,
    }).ok;
  }

  /**
   * Point a node at a different definition and carry its settings across.
   *
   * The general form of retargetModule. One code path: the module swap is
   * identical, and what differs is whether a reconciliation is asked for.
   * retargetModule is the case where it is not — identical code drops nothing,
   * so its report would be empty anyway, and skipping it keeps a working path
   * working. Everything else goes through the reconciler.
   *
   * Policy (see ParameterCarryOverReport in Node.ts):
   *   - a parameter surviving by NAME and TYPE keeps its value, and its
   *     expression with it
   *   - one the new definition adds takes its declared default
   *   - one the new definition no longer has is dropped AND REPORTED, with the
   *     value it held, so a caller can offer it back
   *   - same name, different type is a conflict: the new type wins with its
   *     default and the conflict is reported. No coercion is attempted
   *
   * Pass `options.parameters` when the new definition's declarations are known
   * (a Definition panel has them) and the result is complete on return. Without
   * them the result is `deferred: true` — a module's parameters are only known
   * once its code declares them, which happens on the next cook.
   */
  retargetDefinition(
    nodeId: string,
    modulePath: string,
    source: 'embedded' | 'project',
    code?: string,
    options: {
      parameters?: RetargetParameterDeclaration[];
      /** Default true. False reproduces retargetModule's untouched behaviour. */
      preserveParameters?: boolean;
    } = {},
  ): RetargetResult {
    const blank = (): ParameterCarryOverReport => ({ kept: [], defaulted: [], dropped: [], retyped: [] });

    const node = this.getNode(nodeId);
    if (!node) {
      return { ok: false, deferred: false, ...blank(), error: `no node with id ${nodeId}` };
    }

    const preserve = options.preserveParameters !== false;
    if (preserve) node.beginParameterCarryOver();

    (node as any).modulePath = modulePath;
    (node as any).sourceType = source;
    if (source === 'embedded' && code !== undefined) node.code = code;

    const modulePromise = source === 'project'
      ? loadProjectModule(modulePath)
      : loadEmbeddedModule(code ?? node.code);
    node.setFunction((n: unknown, g: unknown) => modulePromise.then((m) => m.execute(n, g)));
    modulePromise.catch((error) => {
      // The retarget did not happen, so nothing may be reported as dropped.
      node.abandonParameterCarryOver();
      console.warn('Failed to compile ' + modulePath + ':', error);
    });

    node.markDirty();

    if (preserve && options.parameters) {
      const report = node.applyParameterDeclarations(options.parameters) ?? blank();
      return { ok: true, deferred: false, ...report };
    }

    return { ok: true, deferred: preserve, ...blank() };
  }

  /** The report from a deferred retarget, once its cook has run. Null until
   *  then, and null for a node that was never retargeted. */
  getRetargetReport(nodeId: string): ParameterCarryOverReport | null {
    return this.getNode(nodeId)?.lastCarryOverReport ?? null;
  }

  removeNode(nodeId: string) {
    this.removeElement(nodeId);
  }
  
  /**
   * Validate a connection before creating it
   * Works with any element type (nodes and annotations)
   */
  validateConnection(fromPort: any, toPort: any): { valid: boolean; error?: string } {
    // Parse port IDs to get element IDs
    let fromElementId: string;
    let toElementId: string;
    
    try {
      const fromParsed = parsePortId(fromPort.id);
      const toParsed = parsePortId(toPort.id);
      fromElementId = fromParsed.elementId;
      toElementId = toParsed.elementId;
    } catch (err) {
      return { valid: false, error: `Invalid port ID format: ${err}` };
    }
    
    const fromElement = this.getElement(fromElementId);
    const toElement = this.getElement(toElementId);
    
    if (!fromElement || !toElement) {
      return { valid: false, error: 'Element not found' };
    }
    
    // For node-to-node connections, use GraphValidator
    // For annotation-to-node or other combinations, allow them
    if (!this.isAnnotation(fromElement) && !this.isAnnotation(toElement)) {
      const error = GraphValidator.validateConnection(
        this,
        fromElementId,
        toElementId,
        fromPort.id,
        toPort.id
      );
      
      if (error) {
        return { valid: false, error: error.message };
      }
    }
    
    return { valid: true };
  }

  /**
   * Check data type compatibility between ports
   * Returns a warning message if types don't match, or null if compatible
   */
  checkDataTypeCompatibility(fromPort: any, toPort: any): string | null {
    const fromType = normalizeType(fromPort.dataType);
    const toType = normalizeType(toPort.dataType);

    // The core rule, in coreTypes.ts: widening is implicit, narrowing is not.
    // vec2i feeds vec2 because nothing is lost; vec2 into vec2i would silently
    // drop the fraction, and texture into image is a GPU readback — both are
    // real operations and belong in the graph rather than happening invisibly.
    if (canConnect(fromType, toType)) return null;

    // Legacy pairs from before the core set existed, kept so old graphs load.
    const legacy: Record<string, string[]> = {
      number: ['number[]', 'string'],
      float: ['number[]'],
      int: ['number[]'],
      string: ['number', 'float', 'int'],
    };
    if (legacy[fromType]?.includes(toType)) return null;

    return `Type mismatch: connecting ${fromType} to ${toType}`;
  }

  /**
   * Update type mismatch warnings on a node based on its input connections
   */
  updateTypeMismatchWarnings(nodeId: string): void {
    const node = this.getNode(nodeId);
    if (!node) return;

    const warnings: string[] = [];

    // Check each input port's connections
    for (const inputPort of node.inputs) {
      for (const conn of inputPort.connections) {
        const fromNode = this.getNode(conn.from.nodeId);
        if (!fromNode) continue;

        const fromPort = fromNode.outputs.find(p => p.id === conn.from.portId);
        if (!fromPort) continue;

        const warning = this.checkDataTypeCompatibility(fromPort, inputPort);
        if (warning) {
          warnings.push(warning);
        }
      }
    }

    // Set or clear the warning on the node
    if (warnings.length > 0) {
      node.warning = warnings.join('; ');
    } else if (node.warning?.startsWith('Type mismatch')) {
      // Only clear if it was a type mismatch warning
      node.warning = null;
    }
  }

  connect(fromPort: any, toPort: any): Connection {
    // Validate connection first
    const validation = this.validateConnection(fromPort, toPort);
    if (!validation.valid) {
      throw new Error(`Invalid connection: ${validation.error}`);
    }

    // For non-variadic input ports, remove existing connections first (replacement behavior)
    if (!toPort.variadic && toPort.connections && toPort.connections.length > 0) {
      // Get connection IDs to remove
      const connectionsToRemove = [...toPort.connections];
      for (const conn of connectionsToRemove) {
        this.disconnect(conn.id);
      }
    }

    // Parse port IDs to get element IDs
    const fromParsed = parsePortId(fromPort.id);
    const toParsed = parsePortId(toPort.id);
    
    // Use a counter to ensure unique IDs even if connections are created in the same millisecond
    const connection: Connection = {
      id: `conn_${Date.now()}_${++this.connectionIdCounter}`,
      from: { 
        nodeId: fromParsed.elementId, 
        portId: fromPort.id 
      },
      to: { 
        nodeId: toParsed.elementId, 
        portId: toPort.id 
      },
      type: fromPort.portType
    };
    
    // Check for duplicates before adding
    const existing = this.connections.find(c => 
      c.from.nodeId === connection.from.nodeId &&
      c.from.portId === connection.from.portId &&
      c.to.nodeId === connection.to.nodeId &&
      c.to.portId === connection.to.portId
    );
    
    if (existing) {
      // Return existing connection instead of creating duplicate
      return existing;
    }
    
    this.connections.push(connection);
    this._connectionMap.set(connection.id, connection);
    fromPort.connections.push(connection);
    toPort.connections.push(connection);
    
    // Invalidate cached topological order when graph structure changes
    this.invalidateTopologicalOrder();
    
    // Propagate existing value from output port to input port when connection is made
    if (fromPort.value !== undefined && fromPort.value !== null) {
      toPort.value = fromPort.value;
      // Trigger onChange callback if it exists
      if (toPort.onChange) {
        try {
          toPort.onChange(fromPort.value);
        } catch (err) {
          console.error(`Error in onChange callback for port ${toPort.name}:`, err);
        }
      }
    }

    // Sync variadic ports on the target node
    this.syncVariadicPortsOnNode(toParsed.elementId);

    // Check for type mismatches and set warnings on the target node
    this.updateTypeMismatchWarnings(toParsed.elementId);

    // A structural input change invalidates exactly the target branch. This is
    // also what advances the bounded cold-load fixpoint as ports appear and
    // pending connections become bindable between passes.
    this.getNode(toParsed.elementId)?.markDirty();

    return connection;
  }

  disconnect(connectionId: string) {
    // O(1) connection lookup via map
    const conn = this._connectionMap.get(connectionId);
    if (!conn) return;

    // Direct O(1) removal from source and target ports only (not all elements)
    const sourceNode = this.getElement(conn.from.nodeId);
    const targetNode = this.getElement(conn.to.nodeId);

    if (sourceNode) {
      const sourcePort = sourceNode.getPort(conn.from.portId);
      if (sourcePort) {
        sourcePort.connections = sourcePort.connections.filter(c => c.id !== connectionId);
      }
    }

    if (targetNode) {
      const targetPort = targetNode.getPort(conn.to.portId) as InputPort | undefined;
      if (targetPort) {
        targetPort.connections = targetPort.connections.filter(c => c.id !== connectionId);
        if (targetPort.connections.length === 0) {
          targetPort.value = targetPort.defaultValue;
          try {
            targetPort.onChange?.(targetPort.defaultValue);
          } catch (err) {
            console.error(`Error in onChange callback for port ${targetPort.name}:`, err);
          }
        }
      }
    }

    // Remove from array and map
    const index = this.connections.findIndex(c => c.id === connectionId);
    if (index >= 0) {
      this.connections.splice(index, 1);
    }
    this._connectionMap.delete(connectionId);

    // Invalidate cached topological order when graph structure changes
    this.invalidateTopologicalOrder();

    // Sync variadic ports on the target node
    this.syncVariadicPortsOnNode(conn.to.nodeId);

    // Re-check type mismatches after disconnection
    this.updateTypeMismatchWarnings(conn.to.nodeId);
    this.getNode(conn.to.nodeId)?.markDirty();
  }

  /**
   * Sync variadic ports on a node after connection changes
   */
  private syncVariadicPortsOnNode(nodeId: string): void {
    const node = this.getNode(nodeId);
    if (node) {
      node.syncVariadicPorts();
    }
  }

  /**
   * Validate the entire graph
   */
  validate(): ValidationResult {
    return GraphValidator.validateGraph(this);
  }
  
  /**
   * Execute graph using topological sort for proper ordering
   */
  async execute(entryNode?: Node) {
    this.executionState = 'running';
    try {
      await this.scheduler.flush(entryNode);
    } finally {
      this.executionState = 'idle';
    }
  }
  
  /**
   * Get or compute topological order for the entire graph
   * Caches the result until graph structure changes
   */
  getTopologicalOrder(): string[] {
    if (this.cachedTopologicalOrder) {
      return this.cachedTopologicalOrder;
    }
    
    this.cachedTopologicalOrder = GraphValidator.topologicalSort(this);
    return this.cachedTopologicalOrder;
  }
  
  /**
   * Invalidate cached topological order (call when graph structure changes)
   */
  private invalidateTopologicalOrder(): void {
    this.cachedTopologicalOrder = null;
  }
  
  stop() {
    this.executionState = 'stopped';
  }

  reset() {
    this.nodes.forEach(node => {
      node.error = null;
      node.warning = null;
      node.markDirty();
    });
    this.cookingNodes.clear();
    this.executionState = 'idle';
  }
  
  // Behavior Control (v1.2)
  clearCookingNodes(except?: Node): void {
    if (except) {
      this.cookingNodes.forEach(comp => {
        if (comp !== except) {
          comp.setCook(false);
        }
      });
    } else {
      this.cookingNodes.forEach(comp => {
        comp.setCook(false);
      });
    }
  }
  
  isDownstreamOfCooking(node: Node): boolean {
    // Check if computation is downstream of any cooking computation
    const visited = new Set<string>();
    
    const checkUpstream = (n: Node): boolean => {
      if (visited.has(n.id)) return false;
      visited.add(n.id);
      
      if (this.cookingNodes.has(n)) {
        return true;
      }
      
      // Check all upstream computations
      for (const input of n.inputs) {
        for (const conn of input.connections) {
          const upstreamNode = this.getNode(conn.from.nodeId);
          if (upstreamNode && checkUpstream(upstreamNode)) {
            return true;
          }
        }
      }
      
      return false;
    };
    
    return checkUpstream(node);
  }
  
  addAnnotation(annotation: Annotation | any): void {
    let annotationInstance: Annotation;

    if (this.isAnnotation(annotation)) {
      annotationInstance = annotation;
    } else {
      const annData = annotation;
      // Normalize type to PascalCase for switch matching
      const normalizedType = annData.type.charAt(0).toUpperCase() + annData.type.slice(1).toLowerCase();

      switch (normalizedType) {
        case 'Image':
          annotationInstance = new ImageAnnotation(annData.id, this);
          (annotationInstance as ImageAnnotation).src = annData.src;
          break;
        case 'Text':
          annotationInstance = new TextAnnotation(annData.id, this);
          (annotationInstance as TextAnnotation).content = annData.content;
          break;
        case 'Group':
          annotationInstance = new GroupAnnotation(annData.id, this);
          (annotationInstance as any).content = annData.content;
          break;
        case 'Line':
          annotationInstance = new LineAnnotation(annData.id, this);
          if (annData.endPosition) {
            (annotationInstance as LineAnnotation).endPosition = annData.endPosition;
          }
          break;
        case 'Polyline':
          annotationInstance = new PolylineAnnotation(annData.id, this);
          if (annData.points) {
            (annotationInstance as PolylineAnnotation).points = annData.points;
          }
          break;
        default:
          // Fallback: create base Annotation and copy all type-specific properties
          annotationInstance = new Annotation(annData.id, annData.type, this);
          if (annData.content !== undefined) (annotationInstance as any).content = annData.content;
          if (annData.src !== undefined) (annotationInstance as any).src = annData.src;
          if (annData.endPosition) (annotationInstance as any).endPosition = annData.endPosition;
          if (annData.points) (annotationInstance as any).points = annData.points;
      }

      annotationInstance.position = annData.position || { x: 0, y: 0 };
      if (annData.size) annotationInstance.size = annData.size;
      if (annData.style) annotationInstance.style = { ...annData.style };
      if (annData.caption !== undefined) annotationInstance.caption = annData.caption;
      if (annData.containedElements) annotationInstance.containedElements = annData.containedElements;
    }

    this.addElement(annotationInstance);
    this.initializeAnnotationPorts(annotationInstance).catch(err => {
      console.error(`Failed to initialize ports for annotation ${annotationInstance.id}:`, err);
    });
  }
  
  removeAnnotation(id: string): void {
    this.removeElement(id);
  }

  /**
   * Initialize output ports for an annotation based on its type
   * Annotations always have exactly one output at index 0
   */
  async initializeAnnotationPorts(annotation: Annotation): Promise<void> {
    annotation.outputs = [];

    if (annotation.type === 'Image') {
      const imageAnnotation = annotation as ImageAnnotation;
      const portId = createPortId(annotation.id, 'output', 0);
      const port: OutputPort<HTMLImageElement> = {
        id: portId,
        name: 'image',
        portType: 'param',
        dataType: 'asset',
        value: null as any,
        connections: [],
        setValue: (value: HTMLImageElement) => {
          port.value = value;
          port.connections.forEach(conn => {
            const toParsed = parsePortId(conn.to.portId);
            const targetElement = this.getElement(toParsed.elementId);
            if (targetElement && !this.isAnnotation(targetElement)) {
              const targetPort = targetElement.getInputPort(toParsed.index);
              if (targetPort) {
                targetPort.value = value;
                targetPort.onChange?.(value);
              }
            }
          });
        },
        trigger: (props?: any) => {
          port.connections.forEach(conn => {
            const toParsed = parsePortId(conn.to.portId);
            const targetElement = this.getElement(toParsed.elementId);
            if (targetElement && !this.isAnnotation(targetElement)) {
              const targetPort = targetElement.getInputPort(toParsed.index);
              targetPort?.onTrigger?.(props);
            }
          });
        }
      };

      annotation.outputs.push(port);

      const imageSrc = imageAnnotation.src;
      if (imageSrc) {
        try {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          await new Promise<void>((resolve, reject) => {
            img.onload = () => { port.setValue(img); resolve(); };
            img.onerror = reject;
            img.src = imageSrc.startsWith('/') || imageSrc.startsWith('http') || imageSrc.startsWith('data:')
              ? imageSrc : `/${imageSrc}`;
          });
        } catch (error) {
          console.error(`Failed to load image for annotation ${annotation.id}:`, error);
        }
      }
    } else if (annotation.type === 'Text') {
      const textAnnotation = annotation as TextAnnotation;
      if (textAnnotation.content !== undefined) {
        const portId = createPortId(annotation.id, 'output', 0);
        const port: OutputPort<string> = {
          id: portId,
          name: 'text',
          portType: 'param',
          dataType: 'string',
          value: textAnnotation.content,
          connections: [],
          setValue: (value: string) => {
            port.value = value;
            port.connections.forEach(conn => {
              const toParsed = parsePortId(conn.to.portId);
              const targetElement = this.getElement(toParsed.elementId);
              if (targetElement && !this.isAnnotation(targetElement)) {
                const targetPort = targetElement.getInputPort(toParsed.index);
                if (targetPort) {
                  targetPort.value = value;
                  targetPort.onChange?.(value);
                }
              }
            });
          },
          trigger: (props?: any) => {
            port.connections.forEach(conn => {
              const toParsed = parsePortId(conn.to.portId);
              const targetElement = this.getElement(toParsed.elementId);
              if (targetElement && !this.isAnnotation(targetElement)) {
                const targetPort = targetElement.getInputPort(toParsed.index);
                targetPort?.onTrigger?.(props);
              }
            });
          }
        };
        annotation.outputs.push(port);
      }
    }
  }

  // ============ Path Validation ============

  /**
   * Validate all expressions in the graph for broken paths
   * Returns warnings for any expressions referencing non-existent nodes or parameters
   */
  validateExpressionPaths(): { valid: boolean; warnings: { location: string; expression: string; brokenPath: string; suggestion?: string }[] } {
    type PathWarning = { location: string; expression: string; brokenPath: string; suggestion?: string };
    const warnings: PathWarning[] = [];

    // Regex to extract path references from ch(), chs(), chv() calls
    const pathRefPattern = /\b(?:ch|chs|chv)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

    for (const node of this.nodes) {
      for (const [propName, prop] of Object.entries(node.props)) {
        if (!prop.expression) continue;

        const location = `${node.path()}/${propName}`;
        const matches = prop.expression.matchAll(pathRefPattern);

        for (const match of matches) {
          const referencedPath = match[1];
          const resolvedNode = this.resolvePathFromNode(node, referencedPath);

          if (!resolvedNode.node) {
            warnings.push({
              location,
              expression: prop.expression,
              brokenPath: referencedPath,
              suggestion: this.suggestPathFix(node, referencedPath)
            });
          } else if (resolvedNode.parmName && !resolvedNode.node.props[resolvedNode.parmName]) {
            // Path resolved to a node but parameter doesn't exist
            warnings.push({
              location,
              expression: prop.expression,
              brokenPath: referencedPath,
              suggestion: `Parameter "${resolvedNode.parmName}" not found on node "${resolvedNode.node.id}"`
            });
          }
        }
      }
    }

    return {
      valid: warnings.length === 0,
      warnings
    };
  }

  /**
   * Resolve a path from a node's context, returning both the node and optional parameter name
   */
  private resolvePathFromNode(fromNode: Node, path: string): { node: Node | null; parmName?: string } {
    // Split path into node path and optional parameter
    const lastSlash = path.lastIndexOf('/');
    let nodePath: string;
    let parmName: string | undefined;

    // Check if the last segment could be a parameter (not a node)
    if (lastSlash > 0) {
      const possibleParm = path.substring(lastSlash + 1);
      const possibleNodePath = path.substring(0, lastSlash);

      // Try to resolve as node first
      const asNode = fromNode.node(path);
      if (asNode) {
        return { node: asNode };
      }

      // Try as node path + parameter
      const parentNode = fromNode.node(possibleNodePath);
      if (parentNode) {
        return { node: parentNode, parmName: possibleParm };
      }
    }

    // Try resolving the whole path as a node
    return { node: fromNode.node(path) };
  }

  /**
   * Try to suggest a fix for a broken path
   */
  private suggestPathFix(fromNode: Node, brokenPath: string): string | undefined {
    // Extract the target node name from the path
    const segments = brokenPath.replace(/^\.?\.?\//, '').split('/');
    const targetName = segments[segments.length - 1];

    // Search for nodes with similar names in the graph
    const allNodes = this.nodes;
    const similar = allNodes.filter(n =>
      n.id.toLowerCase().includes(targetName.toLowerCase()) ||
      targetName.toLowerCase().includes(n.id.toLowerCase())
    );

    if (similar.length > 0) {
      const suggestion = similar[0];
      return `Did you mean "${suggestion.path()}"?`;
    }

    return undefined;
  }

  toJSON() {
    const result: any = {
      version: GRAPH_FORMAT_VERSION,
      metadata: {
        name: this.project.name || 'Cascade Graph',
        created: this.createdAt,
        modified: new Date().toISOString(),
        ...(this.project.description ? { description: this.project.description } : {}),
        ...(this.project.author ? { author: this.project.author } : {})
      }
    };

    // Project configuration (v0.2)
    if (this.project.packages.length > 0) {
      result.project = {
        packages: this.project.packages.map(pkg => ({
          path: pkg.path,
          alias: pkg.alias
        }))
      };
    }

    // Embedded modules (v0.2) - modules stored inline in the file
    const resolverConfig = this.moduleResolver.exportConfig();
    if (Object.keys(resolverConfig.embeddedModules).length > 0) {
      result.embeddedModules = resolverConfig.embeddedModules;
    }

    // External modules (v0.2) - references to project files with cached code
    if (Object.keys(resolverConfig.externalModules).length > 0) {
      result.externalModules = resolverConfig.externalModules;
    }

    // NPM packages (for runtime dependencies)
    const packages = this.packageManager.getCachedPackages().map((pkg: string) => {
      const [name, version] = pkg.split('@');
      return { name, version: version || 'latest' };
    });
    if (packages.length > 0) {
      result.packages = packages;
    }

    // Only include assets if manifest is not empty
    const assets = this.assetManager.list().map(asset => ({
      id: asset.id,
      path: asset.path,
      type: asset.type,
      size: asset.size
    }));
    if (assets.length > 0) {
      result.assets = { manifest: assets };
    }

    // Order: 1. annotations, 2. nodes, 3. connections (logical loading order)
    const annotations = this.annotations;
    const nodes = this.nodes;

    // Only include annotations if not empty
    if (annotations.length > 0) {
      result.annotations = annotations.map(ann => {
        const serialized: any = {
          id: ann.id,
          type: ann.type,
          position: [ann.position.x, ann.position.y]
        };
        const annAny = ann as any; // Type assertion for accessing specific properties
        if (annAny.content !== undefined) serialized.content = annAny.content;
        if (annAny.src !== undefined) serialized.src = annAny.src;
        if (ann.size) serialized.size = ann.size;
        if (annAny.points) serialized.points = annAny.points.map((p: { x: number; y: number }) => [p.x, p.y]);
        if (annAny.endPosition) serialized.endPosition = [annAny.endPosition.x, annAny.endPosition.y];
        if (ann.style) serialized.style = ann.style;
        if (ann.caption !== undefined) serialized.caption = ann.caption;
        if (ann.containedElements) serialized.containedElements = ann.containedElements;
        // Positions are relative to the parent subnet when this field is present.
        if (ann.parent) serialized.parent = ann.parent.id;
        return serialized;
      });
    }

    result.nodes = nodes.map(n => this.nodeToJSON(n));

    // Only include connections if not empty
    const connections = this.connections.map(conn => {
      // Parse port IDs to get element IDs and indices
      try {
        const fromParsed = parsePortId(conn.from.portId);
        const toParsed = parsePortId(conn.to.portId);

        const fromElement = this.getElement(fromParsed.elementId);
        const toElement = this.getElement(toParsed.elementId);

        if (!fromElement || !toElement) return null;

        // Verify port indices match - access ports directly from arrays (works for both computations and annotations)
        const fromPort = fromElement.outputs?.[fromParsed.index];
        const toPort = toElement.inputs?.[toParsed.index];

        if (!fromPort || !toPort) return null;

        // [[elementId, portIndex, portName], [elementId, portIndex, portName]].
        // The NAME is what a reader should use; the index stays as a fallback
        // for files and readers that predate it. Index alone was fragile: a
        // node's ports are created in the order its code calls in()/out(), so
        // any input pre-seeded in the file takes an earlier index and shifts
        // every connection after it — silently rewiring the graph.
        return [
          [fromParsed.elementId, fromParsed.index, fromPort.name],
          [toParsed.elementId, toParsed.index, toPort.name],
        ];
      } catch (err) {
        console.warn(`Failed to parse port ID in connection: ${err}`);
        return null;
      }
    }).filter((conn): conn is [[string, number, string], [string, number, string]] => conn !== null);
    if (connections.length > 0) {
      result.connections = connections;
    }

    return result;
  }

  /**
   * Serialize a node with v0.2 source information
   */
  private nodeToJSON(node: Node): any {
    // Use stored modulePath if available (set by addNode or fromJSON)
    // Otherwise fall back to deriving from node.type
    const nodeAny = node as any;
    const fullType = nodeAny.modulePath || (node.type.includes('.') ? node.type : `cascade.image.${node.type}`);

    // Use stored sourceType if available, otherwise derive it
    let sourceType = nodeAny.sourceType;
    if (!sourceType) {
      if (isStandardLibraryNode(fullType)) {
        sourceType = 'stdlib';
      } else if (fullType.startsWith('local.')) {
        sourceType = 'embedded';
      } else {
        sourceType = this.moduleResolver.getSourceType(fullType) || 'embedded';
      }
    }

    const result: any = {
      id: node.id,
      module: fullType,
      position: [node.position.x, node.position.y],
      source: sourceType
    };

    // For project modules, include file reference
    if (sourceType === 'project') {
      const config = this.moduleResolver.exportConfig();
      const external = config.externalModules[fullType];
      if (external) {
        result.file = external.file;
      }
    }

    // Only include code for non-stdlib embedded nodes
    if (result.source === 'embedded' && node.code) {
      result.code = node.code;
    }

    // Only include comment if not empty
    if (node.comment && node.comment.trim()) {
      result.comment = node.comment;
    }

    // A node's colour is a grouping the author chose; it belongs in the file.
    if ((node as any).color) {
      result.color = (node as any).color;
    }

    // Positions are relative to the parent subnet when this field is present.
    if (node.parent) {
      result.parent = node.parent.id;
    }

    /**
     * Parameters — the node's own values. Only those that differ from the code
     * default, plus anything promoted to a pin, so a file records decisions
     * rather than restating every default a module already has.
     */
    // The RAW value throughout: `parameter.value` resolves a keyframe channel
    // or an expression, so writing it would freeze an animated parameter at
    // whatever frame the save happened on.
    const rawParameterValue = (p: NodeParameter) => node.rawParameterValue(p.name);
    const changedParameters = (node.parameters ?? [])
      .filter(p => p.promoted || JSON.stringify(rawParameterValue(p)) !== JSON.stringify(p.defaultValue));
    const parameters = changedParameters
      .filter(p => p.documentField !== 'props')
      .map(p => (p.promoted
        ? { name: p.name, value: rawParameterValue(p), promoted: true }
        : { name: p.name, value: rawParameterValue(p) }));
    if (parameters.length > 0) {
      result.params = parameters;
    }

    /**
     * Serialize the value of every UNCONNECTED input port.
     *
     * This is where a node's parameters actually live: a node declares them
     * with `node.in(name, default)`, so a value someone set in the Inspector is
     * a port value and nothing else. Without this, saving discarded every one
     * of them — the graph reloaded with code defaults, and a setting that was
     * live a moment ago was simply gone. Caught by a save wiping the default
     * source out of a project graph, after which the loader had nothing to load.
     *
     * A connected port is skipped: its value belongs to the node upstream and
     * is recomputed on the next cook, so writing it down would only preserve a
     * stale copy.
     */
    const inputValues = node.inputs
      .filter(port => (port.connections?.length ?? 0) === 0)
      .filter(port => port.value !== undefined && port.value !== null)
      .filter(port => typeof port.value !== 'function')
      .map(port => ({ name: port.name, defaultValue: port.value, dataType: port.dataType }))
      .filter(port => port.defaultValue !== '' || port.dataType === 'string');

    if (inputValues.length > 0) {
      result.inputs = inputValues;
    }

    // Serialize props (value and expression if present)
    const props = Object.entries(node.props).reduce((acc, [key, prop]) => {
      // A prop that only backs a `param()` declaration is already written
      // above, in `params`. Writing it here as well would restate every
      // default in the file and leave a stray duplicate row in any older build
      // that opened it. It earns a props entry only when it carries a binding
      // — an expression or a channel — which is the one thing `params` cannot
      // express.
      const keyed = (prop.channel?.keys?.length ?? 0) > 0;
      if (prop.fromParameter && !prop.expression && !keyed) return acc;

      let value = prop.value;
      if (prop.type === 'color' && isColorValue(value)) {
        const normalized = normalizeColor(value as any);
        value = [normalized.r, normalized.g, normalized.b, normalized.a ?? 1.0];
      }

      // A prop may carry an expression, a keyframe channel, both, or neither.
      // Node owns the shape because Node owns the bindings; this keeps the
      // three-way decision in one place rather than growing another branch
      // here every time a binding is added.
      acc[key] = node.serializePropValue(key, value);
      return acc;
    }, {} as Record<string, any>);
    for (const parameter of changedParameters) {
      if (parameter.documentField === 'props') props[parameter.name] = parameter.value;
    }
    if (Object.keys(props).length > 0) {
      result.props = props;
    }

    // Behavior toggles
    if (node.bypass) {
      result.bypass = true;
    }
    if (node.cook) {
      result.cook = true;
    }

    // Call node's serialize() method if it exists (polymorphic serialization)
    if (typeof (node as any).serialize === 'function') {
      const nodeState = (node as any).serialize();
      if (nodeState && Object.keys(nodeState).length > 0) {
        result.state = nodeState;
      }
    }

    return result;
  }

  static fromJSON(json: any, assetManager?: AssetManager, packageManager?: PackageManager): Graph {
    const graph = new Graph(assetManager, packageManager);
    const version = json.version || '0.1';
    if (typeof json.metadata?.created === 'string') graph.createdAt = json.metadata.created;

    /**
     * The project's name, read whether or not the file carries a `project`
     * block. It used to be read only inside the `if (json.project)` below, so
     * a graph with no npm packages — which is most of them — dropped its name
     * on load and then wrote 'Cascade Graph' back over it on the next save.
     * The name is metadata about the graph, not about its packages.
     */
    graph.project = {
      ...graph.project,
      ...(typeof json.metadata?.name === 'string' ? { name: json.metadata.name } : {}),
      ...(typeof json.metadata?.description === 'string' ? { description: json.metadata.description } : {}),
      ...(typeof json.metadata?.author === 'string' ? { author: json.metadata.author } : {}),
    };

    // Load project configuration (v0.2)
    if (json.project) {
      graph.project = {
        ...graph.project,
        name: json.metadata?.name ?? graph.project.name,
        description: json.metadata?.description ?? graph.project.description,
        author: json.metadata?.author ?? graph.project.author,
        packages: json.project.packages || []
      };
      // Update module resolver with project packages
      json.project.packages?.forEach((pkg: ProjectPackage) => {
        graph.moduleResolver.addProjectPackage(pkg);
      });
    }

    // Load embedded modules (v0.2)
    if (json.embeddedModules) {
      graph.moduleResolver.importConfig({
        embeddedModules: json.embeddedModules
      });
    }

    // Load external modules (v0.2)
    if (json.externalModules) {
      graph.moduleResolver.importConfig({
        externalModules: json.externalModules
      });
    }

    // Load packages if specified (for future use)
    if (json.packages && Array.isArray(json.packages)) {
      // Packages will be loaded on-demand when nodes require them
      // We could preload them here, but it's better to load on-demand
    }

    // Create nodes
    json.nodes.forEach((nodeData: any) => {
      // Use the saved ID directly, or generate a unique one if not present
      let nodeId = nodeData.id;
      if (!nodeId) {
        // Fallback: use name if available (for backward compatibility), otherwise use type
        const baseId = nodeData.name || nodeData.type || nodeData.module;
        nodeId = graph.generateUniqueNodeId(baseId);
      } else {
        // Check if ID is unique, if not, generate a unique variant
        let counter = 1;
        let candidateId = nodeId;
        while (graph.elements.some(e => e.id === candidateId)) {
          counter++;
          candidateId = `${nodeId}${counter}`;
        }
        nodeId = candidateId;
      }

      // Support both v0.1 'type' and v0.2 'module' fields
      const nodeType = nodeData.module || nodeData.type;
      if (!nodeType || !nodeType.includes('.')) {
        console.warn(`Invalid node type format: ${nodeType}. Expected package path (e.g., "cascade.image.Color"). Skipping node.`);
        return;
      }

      // Extract short type name for internal representation
      const shortType = packagePathToType(nodeType);

      // Determine source and get code for custom nodes
      const source = nodeData.source || (isStandardLibraryNode(nodeType) ? 'stdlib' : 'embedded');
      let nodeCode = '';

      if (source === 'embedded') {
        // Check embedded modules first (v0.2), then inline code
        const embeddedModule = json.embeddedModules?.[nodeType];
        nodeCode = embeddedModule?.code || nodeData.code || '';
      } else if (source === 'project') {
        // Project source - use cached code from external modules
        const externalModule = json.externalModules?.[nodeType];
        nodeCode = externalModule?.cachedCode || nodeData.code || '';
      }
      // stdlib nodes use class-based instantiation, no code needed

      // Try to get a class-based node first (for stdlib nodes)
      const NodeClass = getNodeClass(nodeType);
      let node: Node;

      if (NodeClass) {
        // Class-based node - instantiate directly
        node = new NodeClass(nodeId, graph);
      } else if (nodeType.startsWith('cascade.')) {
        throw new Error(`Unknown Cascade node type: ${nodeType}`);
      } else {
        // Fallback: create base Node for custom/function-based nodes
        node = new Node(nodeId, shortType, graph);
      }

      // Store full module path for source tracking
      (node as any).modulePath = nodeType;
      (node as any).sourceType = source;

      // Support both array [x, y] and object { x, y } formats for backward compatibility
      if (Array.isArray(nodeData.position)) {
        node.position = { x: nodeData.position[0] || 0, y: nodeData.position[1] || 0 };
      } else if (nodeData.position && typeof nodeData.position === 'object') {
        node.position = { x: nodeData.position.x || 0, y: nodeData.position.y || 0 };
      } else {
        node.position = { x: 0, y: 0 };
      }
      node.code = nodeCode;
      node.comment = nodeData.comment || '';
      if (nodeData.color) (node as any).color = nodeData.color;

      // Parameters are restored BEFORE the node's code runs, so that when
      // param() declares one it finds the saved value already there rather than
      // resetting it to the code default.
      if (Array.isArray(nodeData.params)) {
        nodeData.params.forEach((saved: any) => {
          if (!saved?.name) return;
          const declared = node.parameters.find(parameter => parameter.name === saved.name);
          if (declared) {
            declared.value = saved.value;
            declared.promoted = Boolean(saved.promoted);
          } else {
            node.parameters.push({
              name: saved.name,
              value: saved.value,
              defaultValue: saved.value,
              dataType: 'any',
              promoted: Boolean(saved.promoted),
              options: {},
            });
          }
          // A promoted parameter needs its pin to exist now, or the connection
          // into it has nothing to bind to on the first pass.
          if (saved.promoted) {
            const port = node.in(saved.name, saved.value);
            (port as any).fromParameter = saved.name;
          }
        });
      }
      graph.addElement(node);

      // Runtime documents accept either the legacy port array or the compact
      // name/value record. A class node's declared schema remains authoritative:
      // authored values override its live value, never its type or reset default.
      const restoreInput = (
        name: string,
        value: unknown,
        hasValue: boolean,
        saved: { dataType?: any; id?: string } = {},
      ) => {
        if (!name) return;
        const declared = node.inputs.find(port => port.name === name);
        const port = declared ?? node.in(
          name,
          hasValue ? value : undefined,
          saved.dataType ? { type: saved.dataType } : {},
        );
        if (declared && hasValue) declared.value = value;

        // Never replace a generated ID with an absent one. The generated ID is
        // what name-based, hand-authored documents need for connections.
        if (saved.id && port.id !== saved.id) (port as any).id = saved.id;
      };

      if (Array.isArray(nodeData.inputs)) {
        nodeData.inputs.forEach((saved: any) => {
          if (!saved || typeof saved !== 'object') return;
          const hasDefault = Object.prototype.hasOwnProperty.call(saved, 'defaultValue');
          const hasValue = Object.prototype.hasOwnProperty.call(saved, 'value');
          restoreInput(
            saved.name,
            hasDefault ? saved.defaultValue : saved.value,
            hasDefault || hasValue,
            saved,
          );
        });
      } else if (nodeData.inputs && typeof nodeData.inputs === 'object') {
        Object.entries(nodeData.inputs).forEach(([name, value]) => {
          restoreInput(name, value, true);
        });
      }

      if (nodeData.outputs && Array.isArray(nodeData.outputs)) {
        nodeData.outputs.forEach((portData: any) => {
          // Create port using the stored metadata
          const port = node.out(portData.name, portData.portType || 'param');
          // Same guard as the inputs above — never overwrite a generated id
          // with an absent one.
          if (portData.id && port.id !== portData.id) {
            (port as any).id = portData.id;
          }
        });
      }

      // Restore props
      if (nodeData.props) {
        Object.entries(nodeData.props).forEach(([key, propData]: [string, any]) => {
          // Check if propData is an object with value/expression or just a raw value
          let value: any;
          let expression: string | undefined;

          if (propData && typeof propData === 'object' && 'value' in propData) {
            // New format: { value: ..., expression?: ... }
            value = propData.value;
            expression = propData.expression;
          } else {
            // Old format: just the value
            value = propData;
          }

          // Normalize color values (support array format [r,g,b,a] and object format for backward compatibility)
          // Colors are stored internally as ColorObject, so normalizeColor handles the conversion
          let normalizedValue = value;
          if (isColorValue(value)) {
            const normalized = normalizeColor(value);
            // Store as ColorObject internally (normalizeColor already handles array/object/string formats)
            normalizedValue = normalized.a !== undefined && normalized.a !== 1.0
              ? { r: normalized.r, g: normalized.g, b: normalized.b, a: normalized.a }
              : { r: normalized.r, g: normalized.g, b: normalized.b };
          }

          const definitionProp = node.parameters.find(parameter =>
            parameter.name === key && parameter.documentField === 'props'
          );
          if (definitionProp) {
            // Definition props are Studio parameters but public document props.
            // Keep their contract value shape (not legacy UI color objects).
            definitionProp.value = value;
          } else if (!node.props[key]) {
            // Dynamic node props may be defined after the module first executes.
            node.props[key] = { value: normalizedValue } as any;
          } else {
            node.props[key].value = normalizedValue;
          }

          // Restore expression if present
          if (expression && !definitionProp) {
            node.props[key].expression = expression;
          }
          // And the keyframe channel, which also has to reinstate the node's
          // time-dependence — a keyed parameter loaded from disk must be
          // recooked per frame exactly as one keyed in the session is.
          if (propData?.channel && !definitionProp) {
            node.restorePropChannel(key, propData.channel);
          }
        });
      }

      // Restore behavior toggles
      if (nodeData.bypass !== undefined) {
        node.setBypass(nodeData.bypass);
      }
      if (nodeData.cook !== undefined) {
        node.setCook(nodeData.cook);
      }

      // Set up node function - class-based nodes don't need this (they use setup())
      // Custom nodes (project or embedded) are real ES modules compiled
      // server-side (see nodeModuleLoader.ts) — the load is async, but
      // setFunction can be called with a stable wrapper immediately: it
      // awaits the compiled module the first time this node actually
      // executes, which always happens after fromJSON returns.
      // Gate on source === 'project' as well as node.code: a project
      // module's real content lives on disk (loadProjectModule always
      // fetches fresh), so node.code — only ever a legacy cached snapshot
      // for that source type — can be empty in a hand-authored or minimal
      // .cascade file without that meaning "no function to wire up."
      if (!NodeClass && (source === 'project' || node.code)) {
        const modulePromise = source === 'project' ? loadProjectModule(nodeType) : loadEmbeddedModule(node.code);
        node.setFunction((n: unknown, g: unknown) =>
          modulePromise.then((m) => m.execute(n, g))
        );
        modulePromise.catch((err) => {
          console.warn('Failed to compile node ' + node.id + ':', err);
        });
      }

      // Call node's deserialize() method if it exists (polymorphic deserialization)
      // This restores node-specific state such as cached data.
      if (nodeData.state && typeof (node as any).deserialize === 'function') {
        try {
          (node as any).deserialize(nodeData.state);
        } catch (err) {
          console.warn('Failed to deserialize state for node ' + node.id + ':', err);
        }
      }
    });
    
    // Restore connections (ports may not exist yet if nodes haven't executed)
    // Connections will be fully validated after nodes execute
    const connectionsToRestore = json.connections || [];
    
    // Restore annotations
    if (json.annotations && Array.isArray(json.annotations)) {
      const annotations: Annotation[] = json.annotations.map((annData: any) => {
        let annotation: Annotation;
        const position = Array.isArray(annData.position)
          ? { x: annData.position[0] || 0, y: annData.position[1] || 0 }
          : { x: annData.position?.x || 0, y: annData.position?.y || 0 };

        // Normalize type to PascalCase for switch matching
        const normalizedType = annData.type.charAt(0).toUpperCase() + annData.type.slice(1).toLowerCase();

        switch (normalizedType) {
          case 'Image':
            annotation = new ImageAnnotation(annData.id, graph);
            (annotation as ImageAnnotation).src = annData.src;
            break;
          case 'Text':
            annotation = new TextAnnotation(annData.id, graph);
            (annotation as TextAnnotation).content = annData.content;
            break;
          case 'Group':
            annotation = new GroupAnnotation(annData.id, graph);
            (annotation as any).content = annData.content;
            break;
          case 'Line':
            annotation = new LineAnnotation(annData.id, graph);
            if (annData.endPosition) {
              (annotation as LineAnnotation).endPosition = Array.isArray(annData.endPosition)
                ? { x: annData.endPosition[0] || 0, y: annData.endPosition[1] || 0 }
                : { x: annData.endPosition.x || 0, y: annData.endPosition.y || 0 };
            }
            break;
          case 'Polyline':
            annotation = new PolylineAnnotation(annData.id, graph);
            if (annData.points) {
              (annotation as PolylineAnnotation).points = annData.points.map((p: any) =>
                Array.isArray(p)
                  ? { x: p[0] || 0, y: p[1] || 0 }
                  : { x: p.x || 0, y: p.y || 0 }
              );
            }
            break;
          default:
            annotation = new Annotation(annData.id, annData.type, graph);
        }

        annotation.position = position;
        if (annData.size) annotation.size = { width: annData.size.width, height: annData.size.height };
        if (annData.style) annotation.style = { ...annData.style };
        if (annData.caption !== undefined) annotation.caption = annData.caption;
        if (annData.containedElements) annotation.containedElements = annData.containedElements;

        return annotation;
      });
      
      // Add annotations to graph
      annotations.forEach(ann => graph.addElement(ann));
      
      // Store the promise for annotation port initialization so callers can await it
      (graph as any)._annotationPortsInitialized = Promise.all(
        annotations.map(ann => graph.initializeAnnotationPorts(ann))
      ).catch(err => {
        console.error('Failed to initialize some annotation ports:', err);
      });
    } else {
      // No annotations, so initialization is already complete
      (graph as any)._annotationPortsInitialized = Promise.resolve();
    }

    const authoredElements = [
      ...(Array.isArray(json.nodes) ? json.nodes : []),
      ...(Array.isArray(json.annotations) ? json.annotations : []),
    ];
    for (const elementData of authoredElements) {
      if (typeof elementData?.parent !== 'string') continue;

      const child = graph.getElement(elementData.id);
      const parent = graph.getElement(elementData.parent);
      const warn = (reason: string) => console.warn(
        `Parent link for "${elementData.id}" to "${elementData.parent}" ignored: ${reason}; element loaded at root.`
      );

      if (!child) continue;
      if (!parent) {
        warn('parent does not exist');
        continue;
      }
      if (child === parent) {
        warn('self-parenting is invalid');
        continue;
      }
      if (!parent.isNetwork()) {
        warn('parent is not a network');
        continue;
      }

      let ancestor: Node | null = parent;
      let closesCycle = false;
      const visited = new Set<Node>();
      while (ancestor && !visited.has(ancestor)) {
        if (ancestor === child) {
          closesCycle = true;
          break;
        }
        visited.add(ancestor);
        ancestor = ancestor.parent;
      }
      if (closesCycle) {
        warn('parent cycle detected');
        continue;
      }

      graph.reparentElement(child, parent);
    }

    const depth = (node: Node): number => {
      let value = 0;
      let parent = node.parent;
      const visited = new Set<Node>();
      while (parent && !visited.has(parent)) {
        visited.add(parent);
        value++;
        parent = parent.parent;
      }
      return value;
    };
    graph.nodes
      .filter(node => node.isNetwork())
      .sort((left, right) => depth(right) - depth(left))
      .forEach(node => (node as any).syncPorts?.());
    
    // Store connections to restore after nodes execute
    (graph as any)._connectionsToRestore = connectionsToRestore;

    // Try to restore connections now (will work if nodes were already executed)
    connectionsToRestore.forEach((connData: any) => {
      graph.tryRestoreConnection(connData, false);
    });

    return graph;
  }
  
  async waitForAnnotationPorts(): Promise<void> {
    const initPromise = (this as any)._annotationPortsInitialized;
    if (initPromise) {
      await initPromise;
    }
  }

  /**
   * Try to restore a single connection from serialized data
   * @internal
   */
  tryRestoreConnection(connData: any, checkDuplicates = false): boolean {
    if (!Array.isArray(connData) || !Array.isArray(connData[0]) || !Array.isArray(connData[1])) {
      return false;
    }

    const [fromNodeId, fromPortIndex, fromPortName] = connData[0];
    const [toNodeId, toPortIndex, toPortName] = connData[1];

    if (typeof fromPortIndex !== 'number' || typeof toPortIndex !== 'number') {
      return false;
    }

    const fromElement = this.getElement(fromNodeId);
    const toElement = this.getElement(toNodeId);
    if (!fromElement || !toElement) return false;

    // Name first, index as the fallback. A port's index depends on the order the
    // node's code happens to declare its ports, which changes whenever an input
    // is pre-seeded in the file or a parameter is added to the module; the name
    // doesn't. Files written before names existed still resolve by index.
    const byName = <T extends { name?: string }>(ports: T[] | undefined, name: unknown) =>
      typeof name === 'string' ? ports?.find(p => p.name === name) : undefined;

    /**
     * When the file names a port, ONLY the name resolves it — never the index.
     *
     * Falling back to the index when a named port isn't found yet is worse than
     * failing: a port that a node creates late in its own code simply doesn't
     * exist during the first passes, and the fallback then binds the wire to
     * whatever happens to sit at that index. Seen live: an edge meant for
     * `brightness_contribution` landed on `brightness`, so the blend read a
     * weight where it expected an image and quietly produced nothing. Waiting a
     * pass costs nothing; guessing costs a silently miswired graph.
     */
    const resolve = <T extends { name?: string }>(ports: T[] | undefined, name: unknown, index: number) =>
      typeof name === 'string' ? byName(ports, name) : ports?.[index];

    const fromPort = resolve(fromElement.outputs, fromPortName, fromPortIndex);
    const toPort = resolve(toElement.inputs, toPortName, toPortIndex);
    // Not an error: the target's ports may not exist until its code has run.
    // restoreConnections() keeps this one pending and tries again next pass.
    if (!fromPort || !toPort) return false;

    if (checkDuplicates) {
      const exists = this.connections.some(c =>
        c.from.nodeId === fromNodeId &&
        c.from.portId === fromPort.id &&
        c.to.nodeId === toNodeId &&
        c.to.portId === toPort.id
      );
      if (exists) return true;
    }

    try {
      this.connect(fromPort, toPort);
      return true;
    } catch (err) {
      // A rejection here IS a fault — both ports exist and the graph still
      // refused the edge. Silence cost a day: every connection into a
      // hand-authored node failed this way and the graph simply sat there.
      console.warn(`[connect] ${fromNodeId}[${fromPortIndex}] -> ${toNodeId}[${toPortIndex}] rejected:`, err);
      return false;
    }
  }

  /**
   * Restore connections that were stored during fromJSON
   */
  /**
   * Bind the connections a loaded file described, and KEEP the ones that could
   * not bind yet.
   *
   * A node's ports are created by running its code, so on load a connection
   * into a node that hasn't executed has no port to attach to. This used to
   * drop those connections on the floor — the pending list was deleted after
   * one pass — which meant a graph of code-defined nodes came up almost
   * entirely unwired, and nothing downstream of a source ever ran. Anything
   * still unresolved stays pending, so calling this again after another cook
   * finishes the job.
   */
  restoreConnections(): void {
    const connectionsToRestore = (this as any)._connectionsToRestore || [];
    if (connectionsToRestore.length === 0) return;

    const stillPending = connectionsToRestore.filter(
      (connData: any) => !this.tryRestoreConnection(connData, true)
    );

    if (stillPending.length > 0) {
      (this as any)._connectionsToRestore = stillPending;
    } else {
      delete (this as any)._connectionsToRestore;
    }
  }
}
