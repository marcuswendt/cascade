import { Node } from './Node.js';
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
  OutputPort,
  ProjectPackage,
  EmbeddedModule,
  ExternalModule,
  ProjectConfig,
  NodeSource
} from '../types/node.types.js';
import { packagePathToType, isStandardLibraryNode, getNodeClass, compileCustomNode } from '../utils/nodeTypeUtils.js';
import { normalizeColor, isColorValue } from '../utils/colorUtils.js';

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
  connections: Connection[] = [];
  private connectionIdCounter: number = 0;
  packageManager: PackageManager;
  assetManager: AssetManager;
  moduleResolver: ModuleResolver;

  // Project configuration (v0.2)
  project: ProjectConfig = { packages: [] };

  /**
   * Unified elements array (computations and annotations)
   */
  get elements(): Node[] {
    return this._elements;
  }

  set elements(value: Node[]) {
    this._elements = value;
  }

  // Execution Control
  cookingNodes: Set<Node> = new Set();

  // Execution state
  executionState: ExecutionState = 'idle';

  // Cached topological order (invalidated when graph structure changes)
  private cachedTopologicalOrder: string[] | null = null;
  
  constructor(assetManager?: AssetManager, packageManager?: PackageManager, moduleResolver?: ModuleResolver) {
    this.assetManager = assetManager || new AssetManager();
    this.packageManager = packageManager || new PackageManager();
    this.moduleResolver = moduleResolver || createModuleResolver();
  }
  
  /**
   * Get all computations (non-annotation nodes)
   */
  get nodes(): Node[] {
    return this._elements.filter(e => !(e instanceof Annotation)) as Node[];
  }

  /**
   * Set computations (triggers Svelte reactivity)
   */
  set nodes(value: Node[]) {
    this._elements = [...this._elements.filter(e => e instanceof Annotation), ...value];
  }

  /**
   * Get all annotations
   */
  get annotations(): CanvasAnnotation[] {
    return this._elements.filter(e => e instanceof Annotation) as CanvasAnnotation[];
  }

  /**
   * Set annotations (triggers Svelte reactivity)
   */
  set annotations(value: CanvasAnnotation[]) {
    this._elements = [...this._elements.filter(e => !(e instanceof Annotation)), ...value];
  }
  
  /**
   * Generates a unique element ID based on a base ID.
   * Always appends a number starting from 1 (e.g., "Checkers1", "Checkers2").
   * Ensures the ID has no spaces.
   * @param baseId The base ID to use (typically the element type)
   * @param excludeElementId Optional element ID to exclude from uniqueness check (useful when renaming)
   * @returns A unique element ID with no spaces
   */
  generateUniqueNodeId(baseId: string, excludeElementId?: string): string {
    // Remove spaces from base ID
    const sanitizedBaseId = baseId.replace(/\s+/g, '');
    
    // Always use numbered versions starting from 1
    let counter = 1;
    let candidateId = `${sanitizedBaseId}${counter}`;
    
    // Find the first available numbered ID
    while (this._elements.some(
      element => element.id === candidateId && (!excludeElementId || element.id !== excludeElementId)
    )) {
      counter++;
      candidateId = `${sanitizedBaseId}${counter}`;
    }
    
    return candidateId;
  }

  /**
   * Get any element by ID
   */
  getElement(id: string): Node | null {
    return this._elements.find(e => e.id === id) || null;
  }

  /**
   * Get a computation by ID (type-safe)
   */
  getNode(nodeId: string): Node | null {
    const element = this.getElement(nodeId);
    return element && !(element instanceof Annotation) ? element : null;
  }

  /**
   * Get an annotation by ID (type-safe)
   */
  getAnnotation(id: string): Annotation | null {
    const element = this.getElement(id);
    return element instanceof Annotation ? element : null;
  }

  /**
   * Get a node by absolute path (e.g., "/effects/blur1")
   */
  nodeByPath(path: string): Node | null {
    if (!path.startsWith('/')) return null;

    const segments = path.slice(1).split('/').filter(s => s.length > 0);
    if (segments.length === 0) return null;

    // For now, flat graph - just find by ID (last segment)
    // When subnets are implemented, this will traverse the hierarchy
    const nodeId = segments[segments.length - 1];
    return this.getNode(nodeId);
  }

  /**
   * Add an element to the graph
   */
  addElement(element: Node): void {
    this._elements.push(element);
    this.invalidateTopologicalOrder();
  }

  /**
   * Remove an element from the graph
   */
  removeElement(id: string): void {
    const index = this._elements.findIndex(e => e.id === id);
    if (index >= 0) {
      const element = this._elements[index];
      
      // Call onDestroy if element has the method
      if (element.onDestroy) {
        element.onDestroy();
      }
      
      // Remove connections
      this.connections = this.connections.filter(
        c => c.from.nodeId !== id && c.to.nodeId !== id
      );
      
      // Remove element
      this._elements.splice(index, 1);
      
      this.invalidateTopologicalOrder();
    }
  }
  
  addNode(type: string, position: { x: number; y: number }): Node {
    // Type should be a package path, but we'll convert to short type for internal use
    const shortType = packagePathToType(type);

    // Generate unique ID automatically based on short type
    const id = this.generateUniqueNodeId(shortType);

    // Try to get a class-based node first (for stdlib nodes)
    const NodeClass = getNodeClass(type);
    let node: Node;

    if (NodeClass) {
      // Class-based node - instantiate directly
      node = new NodeClass(id, this);
    } else {
      // Fallback: create base Node for custom/function-based nodes
      node = new Node(id, shortType, this);
    }

    node.position = position;
    this.addElement(node);

    return node;
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
    if (!(fromElement instanceof Annotation) && !(toElement instanceof Annotation)) {
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
    const fromType = fromPort.dataType || 'any';
    const toType = toPort.dataType || 'any';

    // 'any' type is compatible with everything
    if (fromType === 'any' || toType === 'any') {
      return null;
    }

    // Exact match
    if (fromType === toType) {
      return null;
    }

    // Allowed implicit conversions
    const implicitConversions: Record<string, string[]> = {
      'number': ['number[]', 'string'],      // number can become array or string
      'int': ['number', 'number[]', 'string'],
      'float': ['number', 'number[]', 'string'],
      'boolean': ['number', 'string'],
      'string': ['number'],                   // string can be parsed as number
    };

    const allowed = implicitConversions[fromType];
    if (allowed && allowed.includes(toType)) {
      return null; // Implicit conversion allowed
    }

    // Type mismatch - return warning
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

    return connection;
  }

  disconnect(connectionId: string) {
    const index = this.connections.findIndex(c => c.id === connectionId);
    if (index >= 0) {
      const conn = this.connections[index];
      
      // Remove from all element port connections
      this._elements.forEach(element => {
        element.inputs.forEach(p => {
          p.connections = p.connections.filter(c => c.id !== connectionId);
        });
        element.outputs.forEach(p => {
          p.connections = p.connections.filter(c => c.id !== connectionId);
        });
      });
      
      this.connections.splice(index, 1);

      // Invalidate cached topological order when graph structure changes
      this.invalidateTopologicalOrder();

      // Sync variadic ports on the target node
      this.syncVariadicPortsOnNode(conn.to.nodeId);

      // Re-check type mismatches after disconnection
      this.updateTypeMismatchWarnings(conn.to.nodeId);
    }
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
    if (this.executionState === 'running') {
      console.warn('Graph execution already in progress');
      return;
    }

    this.executionState = 'running';
    
    try {
      if (entryNode) {
        // Execute from specific entry point
        await this.executeFromEntry(entryNode);
      } else {
        // Execute all entry points (computations with no input connections)
        const entryPoints = this.nodes
          .filter(comp => comp.inputs.every(p => p.connections.length === 0));
        
        if (entryPoints.length === 0) {
          console.warn('No entry points found in graph');
          return;
        }
        
        // Execute all entry points in parallel
        await Promise.all(entryPoints.map(node => this.executeFromEntry(node)));
      }
    } finally {
      this.executionState = 'idle';
    }
  }
  
  /**
   * Get or compute topological order for the entire graph
   * Caches the result until graph structure changes
   */
  private getTopologicalOrder(): string[] {
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
  
  /**
   * Execute from a specific entry computation using topological sort
   */
  private async executeFromEntry(entryNode: Node) {
    // Build dependency graph starting from entry computation
    const nodesToExecute = new Set<Node>();
    const visited = new Set<string>();

    const collectDownstream = (node: Node) => {
      if (visited.has(node.id)) return;
      visited.add(node.id);
      nodesToExecute.add(node);
      
      // Collect all downstream computations
      for (const output of node.outputs) {
        for (const conn of output.connections) {
          const downstreamNode = this.getNode(conn.to.nodeId);
          if (downstreamNode) {
            collectDownstream(downstreamNode);
          }
        }
      }
    };
    
    collectDownstream(entryNode);
    
    // Create a subgraph with only these computations for topological sort
    const subgraph = new Graph(this.assetManager, this.packageManager);
    subgraph._elements = Array.from(nodesToExecute);
    subgraph.connections = this.connections.filter(conn => {
      const fromNode = this.getNode(conn.from.nodeId);
      const toNode = this.getNode(conn.to.nodeId);
      return fromNode && toNode && nodesToExecute.has(fromNode) && nodesToExecute.has(toNode);
    });
    
    // Get topological order for this subgraph
    const sortedNodeIds = GraphValidator.topologicalSort(subgraph);
    
    // Group computations by dependency level for parallel execution
    const nodeLevels: Node[][] = [];
    const nodeToLevel = new Map<string, number>();
    
    // Calculate level for each computation (distance from entry point)
    const calculateLevel = (nodeId: string): number => {
      if (nodeToLevel.has(nodeId)) {
        return nodeToLevel.get(nodeId)!;
      }
      
      const node = this.getNode(nodeId);
      if (!node) return 0;
      
      let maxUpstreamLevel = -1;
      for (const input of node.inputs) {
        for (const conn of input.connections) {
          const upstreamLevel = calculateLevel(conn.from.nodeId);
          maxUpstreamLevel = Math.max(maxUpstreamLevel, upstreamLevel);
        }
      }
      
      const level = maxUpstreamLevel + 1;
      nodeToLevel.set(nodeId, level);
      
      // Ensure level array is large enough
      while (nodeLevels.length <= level) {
        nodeLevels.push([]);
      }
      nodeLevels[level].push(node);
      
      return level;
    };
    
    // Calculate levels for all computations
    sortedNodeIds.forEach(nodeId => calculateLevel(nodeId));
    
    // Execute computations level by level, with parallel execution within each level
    for (const level of nodeLevels) {
      await Promise.all(level.map(node => node.execute()));
    }
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

    if (annotation instanceof Annotation) {
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
            if (targetElement && !(targetElement instanceof Annotation)) {
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
            if (targetElement && !(targetElement instanceof Annotation)) {
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
              if (targetElement && !(targetElement instanceof Annotation)) {
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
              if (targetElement && !(targetElement instanceof Annotation)) {
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
        created: new Date().toISOString(),
        modified: new Date().toISOString()
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

        // Return as [[elementId, portIndex], [elementId, portIndex]]
        return [[fromParsed.elementId, fromParsed.index], [toParsed.elementId, toParsed.index]];
      } catch (err) {
        console.warn(`Failed to parse port ID in connection: ${err}`);
        return null;
      }
    }).filter((conn): conn is [[string, number], [string, number]] => conn !== null);
    if (connections.length > 0) {
      result.connections = connections;
    }

    return result;
  }

  /**
   * Serialize a node with v0.2 source information
   */
  private nodeToJSON(node: Node): any {
    const fullType = node.type.includes('.') ? node.type : `cascade.lens.${node.type}`;
    const isStdlib = isStandardLibraryNode(fullType);

    const result: any = {
      id: node.id,
      module: fullType,
      position: [node.position.x, node.position.y]
    };

    // Determine source type
    if (isStdlib) {
      result.source = 'stdlib';
    } else if (fullType.startsWith('local.')) {
      result.source = 'embedded';
    } else {
      // Check if it's a project module
      const sourceType = this.moduleResolver.getSourceType(fullType);
      result.source = sourceType || 'embedded';

      // For project modules, include file reference
      if (sourceType === 'project') {
        const config = this.moduleResolver.exportConfig();
        const external = config.externalModules[fullType];
        if (external) {
          result.file = external.file;
        }
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

    // Serialize props (value and expression if present)
    const props = Object.entries(node.props).reduce((acc, [key, prop]) => {
      let value = prop.value;
      if (prop.type === 'color' && isColorValue(value)) {
        const normalized = normalizeColor(value as any);
        value = [normalized.r, normalized.g, normalized.b, normalized.a ?? 1.0];
      }

      // If prop has an expression, save both value and expression
      if (prop.expression) {
        acc[key] = { value, expression: prop.expression };
      } else {
        acc[key] = value;
      }
      return acc;
    }, {} as Record<string, any>);
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

    return result;
  }

  static fromJSON(json: any, assetManager?: AssetManager, packageManager?: PackageManager): Graph {
    const graph = new Graph(assetManager, packageManager);
    const version = json.version || '0.1';

    // Load project configuration (v0.2)
    if (json.project) {
      graph.project = {
        name: json.metadata?.name,
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
        console.warn(`Invalid node type format: ${nodeType}. Expected package path (e.g., "cascade.lens.Color"). Skipping node.`);
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
      graph.addElement(node);

      // Ports (inputs/outputs) are no longer serialized - they are defined in node code
      // and will be created when the node code executes. For backward compatibility,
      // we still support restoring ports from old saved files if they exist.
      if (nodeData.inputs && Array.isArray(nodeData.inputs)) {
        nodeData.inputs.forEach((portData: any) => {
          // Create port using the stored metadata
          const port = node.in(portData.name, portData.defaultValue, {
            type: portData.dataType || 'any'
          });
          // Restore port ID to match saved ID (needed for connection restoration)
          if (port.id !== portData.id) {
            (port as any).id = portData.id;
          }
        });
      }

      if (nodeData.outputs && Array.isArray(nodeData.outputs)) {
        nodeData.outputs.forEach((portData: any) => {
          // Create port using the stored metadata
          const port = node.out(portData.name, portData.portType || 'param');
          // Restore port ID to match saved ID (needed for connection restoration)
          if (port.id !== portData.id) {
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

          // Props will be defined when node code executes
          // For now, we store the values to restore later
          if (!node.props[key]) {
            node.props[key] = { value: normalizedValue } as any;
          } else {
            node.props[key].value = normalizedValue;
          }

          // Restore expression if present
          if (expression) {
            node.props[key].expression = expression;
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
      // Only compile function for custom nodes with code
      if (!NodeClass && node.code) {
        try {
          const nodeFunction = compileCustomNode(node.code);
          node.setFunction(nodeFunction);
        } catch (err) {
          console.warn('Failed to compile node ' + node.id + ':', err);
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

    const [fromNodeId, fromPortIndex] = connData[0];
    const [toNodeId, toPortIndex] = connData[1];

    if (typeof fromPortIndex !== 'number' || typeof toPortIndex !== 'number') {
      return false;
    }

    const fromElement = this.getElement(fromNodeId);
    const toElement = this.getElement(toNodeId);
    if (!fromElement || !toElement) return false;

    // Access ports directly from arrays (works for both computations and annotations)
    const fromPort = fromElement.outputs?.[fromPortIndex];
    const toPort = toElement.inputs?.[toPortIndex];
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
    } catch {
      return false;
    }
  }

  /**
   * Restore connections that were stored during fromJSON
   */
  restoreConnections(): void {
    const connectionsToRestore = (this as any)._connectionsToRestore || [];
    if (connectionsToRestore.length === 0) return;

    connectionsToRestore.forEach((connData: any) => {
      this.tryRestoreConnection(connData, true);
    });

    delete (this as any)._connectionsToRestore;
  }
}

