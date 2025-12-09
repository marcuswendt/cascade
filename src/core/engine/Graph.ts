import { Computation } from './Computation.js';
import { Node } from './Node.js';
import { Annotation } from '../../nodes/annotations/Annotation.js';
import { ImageAnnotation } from '../../nodes/annotations/Image.js';
import { TextAnnotation } from '../../nodes/annotations/Text.js';
import { GroupAnnotation } from '../../nodes/annotations/Group.js';
import { LineAnnotation } from '../../nodes/annotations/Line.js';
import { PolylineAnnotation } from '../../nodes/annotations/Polyline.js';
import { AssetManager } from './AssetManager.js';
import { PackageManager } from './PackageManager.js';
import { GraphValidator, type ValidationResult } from './GraphValidator.js';
import type { Connection, OutputPort } from '../../types/node.types.js';
import { packagePathToType, getNodeTemplateCode } from '../../utils/nodeTypeUtils.js';
import { normalizeColor, isColorValue } from '../../utils/colorUtils.js';

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

  /**
   * Unified elements array (computations and annotations)
   */
  get elements(): Node[] {
    return this._elements;
  }

  set elements(value: Node[]) {
    this._elements = value;
  }

  // Execution Control (v1.2)
  cookingNodes: Set<Computation> = new Set();
  multiCookMode: boolean = false;
  
  // Execution state
  executionState: ExecutionState = 'idle';
  private executionQueue: Computation[] = [];
  
  // Cached topological order (invalidated when graph structure changes)
  private cachedTopologicalOrder: string[] | null = null;
  
  constructor(assetManager?: AssetManager, packageManager?: PackageManager) {
    this.assetManager = assetManager || new AssetManager();
    this.packageManager = packageManager || new PackageManager();
  }
  
  /**
   * Get all computations (computed property for backward compatibility)
   */
  get nodes(): Computation[] {
    return this._elements.filter(e => e.type === 'computation') as Computation[];
  }
  
  /**
   * Set computations (for reactivity in Svelte - backward compatibility)
   */
  set nodes(value: Computation[]) {
    // Remove old computations, keep annotations
    this._elements = this._elements.filter(e => e.type !== 'computation');
    // Add new computations
    value.forEach(comp => this._elements.push(comp));
  }
  
  /**
   * Get all annotations (computed property for backward compatibility)
   */
  get annotations(): Annotation[] {
    return this._elements.filter(e => e.type !== 'computation') as Annotation[];
  }
  
  /**
   * Set annotations (for reactivity in Svelte - backward compatibility)
   */
  set annotations(value: Annotation[]) {
    // Remove old annotations, keep nodes
    this._elements = this._elements.filter(e => e.type === 'computation');
    // Add new annotations
    value.forEach(ann => this._elements.push(ann));
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
  getNode(nodeId: string): Computation | null {
    const element = this.getElement(nodeId);
    return element && element.type === 'computation' ? element as Computation : null;
  }

  /**
   * Get an annotation by ID (type-safe)
   */
  getAnnotation(id: string): Annotation | null {
    const element = this.getElement(id);
    return element && element.type !== 'computation' ? element as Annotation : null;
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
      
      // Call onDestroy if it's a computation and has the method
      if (element instanceof Computation && element.onDestroy) {
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
  
  addNode(type: string, position: { x: number; y: number }): Computation {
    // Type should be a package path, but we'll convert to short type for internal use
    const shortType = packagePathToType(type);
    
    // Generate unique ID automatically based on short type
    const id = this.generateUniqueNodeId(shortType);
    const computation = new Computation(id, shortType, this);
    computation.position = position;
    this.addElement(computation);
    
    return computation;
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
    if (fromElement.type === 'computation' && toElement.type === 'computation') {
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
  
  connect(fromPort: any, toPort: any): Connection {
    // Validate connection first
    const validation = this.validateConnection(fromPort, toPort);
    if (!validation.valid) {
      throw new Error(`Invalid connection: ${validation.error}`);
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
  async execute(entryNode?: Computation) {
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
        const entryPoints = this._elements
          .filter(e => e.type === 'computation')
          .map(e => e as Computation)
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
  private async executeFromEntry(entryNode: Computation) {
    // Build dependency graph starting from entry computation
    const nodesToExecute = new Set<Computation>();
    const visited = new Set<string>();
    
    const collectDownstream = (node: Computation) => {
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
    const nodeLevels: Computation[][] = [];
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
    // Stop all execution (for future use with timers/intervals)
    this._elements
      .filter(e => e.type === 'computation')
      .forEach(comp => {
        if ((comp as Computation).onDestroy) {
          // Could be enhanced to stop specific operations
        }
      });
  }
  
  reset() {
    // Reset all computation states
    this._elements
      .filter(e => e.type === 'computation')
      .forEach(comp => {
        const c = comp as Computation;
        c.error = null;
        c.warning = null;
        c.markDirty(); // Mark as dirty to force re-execution
      });
    this.cookingNodes.clear();
    this.multiCookMode = false;
    this.executionState = 'idle';
    this.executionQueue = [];
  }
  
  // Behavior Control (v1.2)
  clearCookingNodes(except?: Computation): void {
    if (except) {
      this.cookingNodes.forEach(comp => {
        if (comp !== except) {
          comp.setCooking(false);
        }
      });
    } else {
      this.cookingNodes.forEach(comp => {
        comp.setCooking(false);
      });
    }
  }
  
  isDownstreamOfCooking(node: Computation): boolean {
    // Check if computation is downstream of any cooking computation
    const visited = new Set<string>();
    
    const checkUpstream = (n: Computation): boolean => {
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
  
  // Annotation Management (v1.3)
  // Note: These methods are kept for backward compatibility but will be updated to use Annotation classes
  addAnnotation(annotation: Annotation | any): void {
    // Convert plain objects to Annotation instances if needed
    let annotationInstance: Annotation;
    
    if (annotation instanceof Annotation) {
      annotationInstance = annotation;
    } else {
      // Create appropriate annotation type from plain object
      const annData = annotation;
      switch (annData.type) {
        case 'image':
          annotationInstance = new ImageAnnotation(annData.id);
          (annotationInstance as any).src = annData.src;
          break;
        case 'text':
          annotationInstance = new TextAnnotation(annData.id);
          (annotationInstance as any).content = annData.content;
          break;
        case 'group':
          annotationInstance = new GroupAnnotation(annData.id);
          break;
        case 'line':
          annotationInstance = new LineAnnotation(annData.id);
          if (annData.endPosition) {
            (annotationInstance as any).endPosition = annData.endPosition;
          }
          break;
        case 'polyline':
          annotationInstance = new PolylineAnnotation(annData.id);
          if (annData.points) {
            (annotationInstance as any).points = annData.points;
          }
          break;
        default:
          annotationInstance = new Annotation(annData.id, annData.type);
      }
      
      // Copy properties from plain object
      annotationInstance.position = annData.position || { x: 0, y: 0 };
      if (annData.size) {
        annotationInstance.size = annData.size;
      }
      if (annData.style) {
        annotationInstance.style = { ...annData.style };
      }
      if (annData.caption !== undefined) {
        annotationInstance.caption = annData.caption;
      }
      if (annData.containedElements) {
        annotationInstance.containedElements = annData.containedElements;
      }
    }
    
    this.addElement(annotationInstance);
    // Initialize ports for annotations that support them
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
    // Clear existing ports
    annotation.outputs = [];

    if (annotation.type === 'image') {
      const imageAnnotation = annotation as any; // Type assertion for now
      // Always create the port, even if src is not set yet
      // Create image output port with index-based ID
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
          // Propagate to connected inputs
          port.connections.forEach(conn => {
            const toParsed = parsePortId(conn.to.portId);
            const targetElement = this.getElement(toParsed.elementId);
            if (targetElement) {
              const targetPort = targetElement.getInputPort(toParsed.index);
              if (targetPort) {
                targetPort.value = value;
                if (targetPort.onChange) {
                  targetPort.onChange(value);
                }
              }
            }
          });
        },
        trigger: (props?: any) => {
          // Trigger connected nodes
          port.connections.forEach(conn => {
            const toParsed = parsePortId(conn.to.portId);
            const targetElement = this.getElement(toParsed.elementId);
            if (targetElement && targetElement.type === 'computation') {
              const targetPort = targetElement.getInputPort(toParsed.index);
              if (targetPort && targetPort.onTrigger) {
                targetPort.onTrigger(props);
              }
            }
          });
        }
      };

      annotation.outputs.push(port);

      // Load image asynchronously if src is set
      if (imageAnnotation.src) {
        try {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          
          await new Promise<void>((resolve, reject) => {
            img.onload = () => {
              port.setValue(img);
              resolve();
            };
            img.onerror = reject;
            // Handle both absolute and relative paths
            const src = imageAnnotation.src.startsWith('/') || imageAnnotation.src.startsWith('http') 
              ? imageAnnotation.src 
              : `/${imageAnnotation.src}`;
            img.src = src;
          });
        } catch (error) {
          console.error(`Failed to load image for annotation ${annotation.id}:`, error);
        }
      }
    } else if (annotation.type === 'text') {
      const textAnnotation = annotation as any; // Type assertion for now
      if (textAnnotation.content !== undefined) {
        // Create text output port with index-based ID
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
            // Propagate to connected inputs
            port.connections.forEach(conn => {
              const toParsed = parsePortId(conn.to.portId);
              const targetElement = this.getElement(toParsed.elementId);
              if (targetElement) {
                const targetPort = targetElement.getInputPort(toParsed.index);
                if (targetPort) {
                  targetPort.value = value;
                  if (targetPort.onChange) {
                    targetPort.onChange(value);
                  }
                }
              }
            });
          },
          trigger: (props?: any) => {
            // Trigger connected nodes
            port.connections.forEach(conn => {
              const toParsed = parsePortId(conn.to.portId);
              const targetElement = this.getElement(toParsed.elementId);
              if (targetElement && targetElement.type === 'computation') {
                const targetPort = targetElement.getInputPort(toParsed.index);
                if (targetPort && targetPort.onTrigger) {
                  targetPort.onTrigger(props);
                }
              }
            });
          }
        };

        annotation.outputs.push(port);
      }
    }
  }
  
  toJSON() {
    const result: any = {
      version: '0.1',
      metadata: {
        name: 'Cascade Graph',
        created: new Date().toISOString(),
        modified: new Date().toISOString()
      }
    };
    
    // Only include packages if not empty
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
    // Separate elements by type
    const annotations = this._elements.filter(e => e.type !== 'computation') as Annotation[];
    const nodes = this._elements.filter(e => e.type === 'computation') as Computation[];
    
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
    
    result.nodes = nodes.map(n => n.toJSON());
    
    // Only include connections if not empty
    const connections = this.connections.map(conn => {
      // Parse port IDs to get element IDs and indices
      try {
        const fromParsed = parsePortId(conn.from.portId);
        const toParsed = parsePortId(conn.to.portId);
        
        const fromElement = this.getElement(fromParsed.elementId);
        const toElement = this.getElement(toParsed.elementId);
        
        if (!fromElement || !toElement) return null;
        
        // Verify port indices match
        const fromPort = fromElement.getOutputPort(fromParsed.index);
        const toPort = toElement.getInputPort(toParsed.index);
        
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
    
    // Execution section is redundant:
    // - entryPoints are computed dynamically from nodes with no input connections
    // - cookingNodes are derived from the 'cook' flag on each node
    // Both are restored automatically when nodes are loaded
    
    return result;
  }

  static fromJSON(json: any, assetManager?: AssetManager, packageManager?: PackageManager): Graph {
    const graph = new Graph(assetManager, packageManager);
    
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
        const baseId = nodeData.name || nodeData.type;
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
      
      // Type must be a package path (e.g., "cascade.lens.Color")
      const nodeType = nodeData.type;
      if (!nodeType || !nodeType.includes('.')) {
        console.warn(`Invalid node type format: ${nodeType}. Expected package path (e.g., "cascade.lens.Color"). Skipping node.`);
        return;
      }
      
      // Extract short type name for internal representation
      const shortType = packagePathToType(nodeType);
      
      // Try to load template code for standard library nodes
      let nodeCode = nodeData.code || '';
      const templateCode = getNodeTemplateCode(nodeType);
      if (templateCode) {
        // Use template code instead of stored code for standard library nodes
        nodeCode = templateCode;
      }
      
      // Create computation with the short type name (internal representation)
      const node = new Computation(nodeId, shortType, graph);
      
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
        Object.entries(nodeData.props).forEach(([key, value]: [string, any]) => {
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
        });
      }
      
      // Restore behavior toggles (support both old and new field names)
      const bypassValue = nodeData.bypass !== undefined ? nodeData.bypass : nodeData.bypassed;
      if (bypassValue !== undefined) {
        node.setBypassed(bypassValue);
      }
      const cookValue = nodeData.cook !== undefined ? nodeData.cook : nodeData.cooking;
      if (cookValue !== undefined) {
        node.setCooking(cookValue);
      }
      
      // Restore node function if code exists
      if (node.code) {
        try {
          // Wrap code in async function to support top-level await
          // The function should return a promise that resolves when the async code completes
          const wrappedCode = `return (async function(node, graph) {\n${node.code}\n})(node, graph);`;
          const nodeFunction = new Function('node', 'graph', wrappedCode) as (node: any, graph: any) => Promise<any>;
          node.setFunction(nodeFunction);
        } catch (err) {
          console.warn('Failed to compile node ' + node.id + ':', err);
        }
      }
    });
    
    // Restore connections (ports may not exist yet if nodes haven't executed)
    // Connections will be fully validated after nodes execute
    const connectionsToRestore = json.connections || [];
    
    // Restore annotations (support both array and object position formats)
    if (json.annotations && Array.isArray(json.annotations)) {
      const annotations: Annotation[] = json.annotations.map((annData: any) => {
        let annotation: Annotation;
        const position = Array.isArray(annData.position) 
          ? { x: annData.position[0] || 0, y: annData.position[1] || 0 }
          : { x: annData.position?.x || 0, y: annData.position?.y || 0 };
        
        // Create appropriate annotation type
        switch (annData.type) {
          case 'image':
            annotation = new ImageAnnotation(annData.id);
            (annotation as any).src = annData.src;
            break;
          case 'text':
            annotation = new TextAnnotation(annData.id);
            (annotation as any).content = annData.content;
            break;
          case 'group':
            annotation = new GroupAnnotation(annData.id);
            break;
          case 'line':
            annotation = new LineAnnotation(annData.id);
            if (annData.endPosition) {
              (annotation as any).endPosition = Array.isArray(annData.endPosition)
                ? { x: annData.endPosition[0] || 0, y: annData.endPosition[1] || 0 }
                : { x: annData.endPosition.x || 0, y: annData.endPosition.y || 0 };
            }
            break;
          case 'polyline':
            annotation = new PolylineAnnotation(annData.id);
            if (annData.points) {
              (annotation as any).points = annData.points.map((p: any) => 
                Array.isArray(p) 
                  ? { x: p[0] || 0, y: p[1] || 0 }
                  : { x: p.x || 0, y: p.y || 0 }
              );
            }
            break;
          default:
            // Fallback to base annotation
            annotation = new Annotation(annData.id, annData.type);
        }
        
        annotation.position = position;
        if (annData.size) {
          annotation.size = { width: annData.size.width, height: annData.size.height };
        }
        if (annData.style) {
          annotation.style = { ...annData.style };
        }
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
    
    // Store connections to restore after nodes execute (for CLI/headless environments)
    // In browser, connections are restored here but may fail silently if ports don't exist yet
    (graph as any)._connectionsToRestore = connectionsToRestore;
    
    // Try to restore connections now (will work if nodes were already executed)
    // If ports don't exist, they'll be restored later when restoreConnections() is called
    connectionsToRestore.forEach((connData: any) => {
      // Support both old format (object with nodeId/portId) and new format (array with indices)
      let fromNodeId: string, fromPortIndex: number | string;
      let toNodeId: string, toPortIndex: number | string;
      
      if (Array.isArray(connData) && Array.isArray(connData[0]) && Array.isArray(connData[1])) {
        // New format: [[nodeId, portIndex], [nodeId, portIndex]]
        [fromNodeId, fromPortIndex] = connData[0];
        [toNodeId, toPortIndex] = connData[1];
      } else if (connData.from && connData.to) {
        // Old format: { from: { nodeId, portId }, to: { nodeId, portId } }
        fromNodeId = connData.from.nodeId;
        toNodeId = connData.to.nodeId;
        const fromNode = graph.getNode(fromNodeId);
        const toNode = graph.getNode(toNodeId);
        if (fromNode && toNode) {
          const fromPort = fromNode.outputs.find(p => p.id === connData.from.portId);
          const toPort = toNode.inputs.find(p => p.id === connData.to.portId);
          if (fromPort && toPort) {
            try {
              graph.connect(fromPort, toPort);
            } catch (err) {
              // Connection failed - will be retried after nodes execute
            }
          }
        }
        return; // Skip new format processing for old format
      } else {
        return; // Invalid format
      }
      
      // New format: use indices
      // Works for any element type (nodes and annotations)
      const fromElement = graph.getElement(fromNodeId);
      const toElement = graph.getElement(toNodeId);
      if (fromElement && toElement && typeof fromPortIndex === 'number' && typeof toPortIndex === 'number') {
        const fromPort = fromElement.getOutputPort(fromPortIndex);
        const toPort = toElement.getInputPort(toPortIndex);
        if (fromPort && toPort) {
          try {
            graph.connect(fromPort, toPort);
          } catch (err) {
            // Connection failed - will be retried after nodes execute
          }
        }
      }
    });
    
    return graph;
  }
  
  /**
   * Wait for annotation ports to be initialized
   * Call this before executing nodes that depend on annotation outputs
   */
  async waitForAnnotationPorts(): Promise<void> {
    const initPromise = (this as any)._annotationPortsInitialized;
    if (initPromise) {
      await initPromise;
    }
  }

  /**
   * Restore connections that were stored during fromJSON
   * Call this after nodes have been executed to ensure ports exist
   */
  restoreConnections(): void {
    const connectionsToRestore = (this as any)._connectionsToRestore || [];
    if (connectionsToRestore.length === 0) return;
    
    connectionsToRestore.forEach((connData: any) => {
      // Support both old format (object with nodeId/portId) and new format (array with indices)
      let fromNodeId: string, fromPortIndex: number | string;
      let toNodeId: string, toPortIndex: number | string;
      
      if (Array.isArray(connData) && Array.isArray(connData[0]) && Array.isArray(connData[1])) {
        // New format: [[nodeId, portIndex], [nodeId, portIndex]]
        [fromNodeId, fromPortIndex] = connData[0];
        [toNodeId, toPortIndex] = connData[1];
      } else if (connData.from && connData.to) {
        // Old format: { from: { nodeId, portId }, to: { nodeId, portId } }
        fromNodeId = connData.from.nodeId;
        toNodeId = connData.to.nodeId;
        const fromNode = this.getNode(fromNodeId);
        const toNode = this.getNode(toNodeId);
        if (fromNode && toNode) {
          const fromPort = fromNode.outputs.find(p => p.id === connData.from.portId);
          const toPort = toNode.inputs.find(p => p.id === connData.to.portId);
          if (fromPort && toPort) {
            // Check if connection already exists
            const exists = this.connections.some(c => 
              c.from.nodeId === fromNodeId &&
              c.from.portId === fromPort.id &&
              c.to.nodeId === toNodeId &&
              c.to.portId === toPort.id
            );
            if (!exists) {
              try {
                this.connect(fromPort, toPort);
              } catch (err) {
                // Connection validation failed - skip it
              }
            }
          }
        }
        return; // Skip new format processing for old format
      } else {
        return; // Invalid format
      }
      
      // New format: use indices
      // Works for any element type (nodes and annotations)
      const fromElement = this.getElement(fromNodeId);
      const toElement = this.getElement(toNodeId);
      if (fromElement && toElement && typeof fromPortIndex === 'number' && typeof toPortIndex === 'number') {
        const fromPort = fromElement.getOutputPort(fromPortIndex);
        const toPort = toElement.getInputPort(toPortIndex);
        if (fromPort && toPort) {
          // Check if connection already exists
          const exists = this.connections.some(c => 
            c.from.nodeId === fromNodeId &&
            c.from.portId === fromPort.id &&
            c.to.nodeId === toNodeId &&
            c.to.portId === toPort.id
          );
          if (!exists) {
            try {
              this.connect(fromPort, toPort);
            } catch (err) {
              // Connection validation failed - skip it
            }
          }
        }
      }
    });
    
    // Clean up
    delete (this as any)._connectionsToRestore;
  }
}

