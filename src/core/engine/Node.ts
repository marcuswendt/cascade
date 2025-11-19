import type { NodeContext, InputPort, OutputPort, PortOptions, PortType, Connection, Prop } from '../../types/node.types.js';
import type { Graph } from './Graph.js';

export class Node implements NodeContext {
  id: string;
  name: string;
  type: string;
  code: string;
  position: { x: number; y: number };
  preview: HTMLCanvasElement | HTMLImageElement | null = null;
  comment: string = '';
  error: Error | null = null;
  warning: string | null = null;
  isTemplate: boolean = false;
  isDirtyFlag: boolean = false; // Renamed to avoid conflict with isDirty() method
  
  inputs: InputPort[] = [];
  outputs: OutputPort[] = [];
  
  // Props System (v1.1)
  props: Record<string, Prop> = {};
  private propWatchers: Map<string, Function[]> = new Map();
  
  // Behavior Toggles (v1.2)
  bypassed: boolean = false;
  cooking: boolean = false;
  
  // Track if node function has been executed at least once
  private hasExecuted: boolean = false;
  bypassOpacity: number = 1.0;
  cookAnimation: boolean = false;
  
  // Execution timeout (in milliseconds, default 30 seconds)
  executionTimeout: number = 30000;
  
  onReady?: () => void;
  onDestroy?: () => void;
  
  private nodeFunction?: Function;
  private graph: Graph;
  
  // Track ports that are called during compilation to clean up unused ones
  private portsUsedDuringCompilation: Set<string> = new Set();
  
  // Track last execution time and input hash for dirty checking
  private lastExecutionTime: number = 0;
  private lastInputHash: string = '';
  
  constructor(id: string, type: string, graph: Graph) {
    this.id = id;
    this.type = type;
    this.name = type;
    this.code = '';
    this.position = { x: 0, y: 0 };
    this.graph = graph;
  }
  
  in<T>(name: string, defaultValue?: T, options: PortOptions = {}): InputPort<T> {
    const portType = name === 'trigger' ? 'trigger' : 'param';
    
    // Check if port with this name already exists
    const existingPort = this.inputs.find(p => p.name === name);
    if (existingPort) {
      // Mark as used during compilation
      this.portsUsedDuringCompilation.add(`input_${name}`);
      // Update options if changed
      if (options.type) {
        existingPort.dataType = options.type;
      }
      if (defaultValue !== undefined && existingPort.defaultValue !== defaultValue) {
        existingPort.defaultValue = defaultValue as T;
        if (existingPort.value === undefined || existingPort.value === existingPort.defaultValue) {
          existingPort.value = defaultValue as T;
        }
      }
      // Merge options
      Object.assign(existingPort.options, options);
      return existingPort as InputPort<T>;
    }
    
    // Create new port
    const port: InputPort<T> = {
      id: `${this.id}_in_${name}`,
      name,
      portType,
      dataType: options.type || 'any',
      value: defaultValue as T,
      defaultValue: defaultValue as T,
      options,
      connections: []
    };
    
    this.inputs.push(port as InputPort);
    this.portsUsedDuringCompilation.add(`input_${name}`);
    return port;
  }
  
  out<T>(name: string, portType: PortType = 'param'): OutputPort<T> {
    // Check if port with this name already exists
    const existingPort = this.outputs.find(p => p.name === name);
    if (existingPort) {
      // Mark as used during compilation
      this.portsUsedDuringCompilation.add(`output_${name}`);
      // Update portType if changed
      if (existingPort.portType !== portType) {
        existingPort.portType = portType;
      }
      return existingPort as OutputPort<T>;
    }
    
    // Create new port
    const port: OutputPort<T> = {
      id: `${this.id}_out_${name}`,
      name,
      portType,
      dataType: 'any',
      value: undefined as T,
      connections: [],
      
      setValue: (value: T) => {
        port.value = value;
        // Propagate to connected inputs
        port.connections.forEach(conn => {
          const targetNode = this.graph.getNode(conn.to.nodeId);
          if (targetNode) {
            const targetPort = targetNode.inputs.find(p => p.id === conn.to.portId);
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
          const targetNode = this.graph.getNode(conn.to.nodeId);
          if (targetNode) {
            const targetPort = targetNode.inputs.find(p => p.id === conn.to.portId);
            if (targetPort && targetPort.onTrigger) {
              targetPort.onTrigger(props);
            }
          }
        });
      }
    };
    
    this.outputs.push(port as OutputPort);
    this.portsUsedDuringCompilation.add(`output_${name}`);
    return port;
  }
  
  setFunction(fn: Function) {
    this.nodeFunction = fn;
  }
  
  // Props System Methods (v1.1)
  defineProp<T>(name: string, config: Prop<T>): void {
    this.props[name] = config as Prop;
    // Mark dirty to trigger reactivity
    this.markDirty();
  }
  
  updateProp(name: string, value: any): void {
    if (this.props[name]) {
      // For arrays, always create a new array reference to ensure reactivity
      const newValue = Array.isArray(value) ? [...value] : value;
      
      // Recreate the prop object to ensure reactivity
      this.props[name] = {
        ...this.props[name],
        value: newValue
      };
      
      // Call onChange callback
      if (this.props[name].onChange) {
        try {
          this.props[name].onChange!(this.props[name], this);
        } catch (err) {
          console.error(`Error in prop onChange for ${name}:`, err);
        }
      }
      
      // Notify watchers
      const watchers = this.propWatchers.get(name);
      if (watchers) {
        watchers.forEach(callback => {
          try {
            callback(newValue, this.props[name]);
          } catch (err) {
            console.error(`Error in prop watcher for ${name}:`, err);
          }
        });
      }
      
      // Also recreate the entire props object to ensure reactivity
      this.props = { ...this.props };
      
      // Note: UI-specific reactivity triggers (like Svelte stores) should be handled
      // in the editor layer, not in the core engine
      
      this.markDirty();
    }
  }
  
  watchProp(name: string, callback: Function): void {
    if (!this.propWatchers.has(name)) {
      this.propWatchers.set(name, []);
    }
    this.propWatchers.get(name)!.push(callback);
  }
  
  // Behavior Toggle Methods (v1.2)
  setBypassed(value: boolean): void {
    this.bypassed = value;
    this.bypassOpacity = value ? 0.5 : 1.0;
    this.markDirty();
  }
  
  setCooking(value: boolean): void {
    this.cooking = value;
    this.cookAnimation = value;
    if (value) {
      this.graph.cookingNodes.add(this);
    } else {
      this.graph.cookingNodes.delete(this);
    }
    this.markDirty();
  }
  
  shouldExecute(): boolean {
    if (this.bypassed) {
      return false;
    }
    if (this.graph.cookingNodes.size > 0) {
      return this.cooking || this.graph.isDownstreamOfCooking(this);
    }
    return true;
  }
  
  executeBypass(): void {
    // Pass inputs to outputs without executing
    this.inputs.forEach(input => {
      if (input.portType === 'param') {
        const value = input.value;
        // Find matching output port and set its value
        const matchingOutput = this.outputs.find(out => {
          // Try to match by name or find first available
          return out.name === input.name || this.outputs.length === 1;
        });
        if (matchingOutput) {
          matchingOutput.setValue(value);
        }
      }
    });
  }
  
  markDirty(): void {
    this.isDirtyFlag = true;
  }
  
  /**
   * Renames the node, ensuring the new name is unique.
   * If the requested name is not unique, generates a unique variant.
   * @param newName The desired new name
   * @returns The actual name that was set (may differ if original wasn't unique)
   */
  rename(newName: string): string {
    if (!newName || !newName.trim()) {
      return this.name; // Don't allow empty names
    }
    
    const trimmedName = newName.trim();
    // Use the graph's unique name generator, excluding this node from the check
    const uniqueName = this.graph.generateUniqueNodeName(trimmedName, this.id);
    this.name = uniqueName;
    this.markDirty();
    return uniqueName;
  }
  
  /**
   * Create a timeout promise that rejects after specified milliseconds
   */
  private createTimeoutPromise(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Node execution timeout after ${ms}ms`));
      }, ms);
    });
  }
  
  /**
   * Calculate hash of input values for dirty checking
   */
  private calculateInputHash(): string {
    const inputValues = this.inputs.map(input => {
      const value = input.value;
      // Simple hash - can be improved for complex objects
      if (value === null || value === undefined) return 'null';
      if (typeof value === 'object') {
        try {
          return JSON.stringify(value);
        } catch {
          return String(value);
        }
      }
      return String(value);
    }).join('|');
    
    return inputValues;
  }
  
  /**
   * Check if node is dirty (inputs have changed since last execution)
   */
  isDirtyCheck(): boolean {
    if (!this.hasExecuted) return true; // Always execute first time
    
    const currentHash = this.calculateInputHash();
    return currentHash !== this.lastInputHash;
  }
  
  // Keep isDirty as a getter for interface compatibility
  get isDirty(): boolean {
    return this.isDirtyFlag || this.isDirtyCheck();
  }
  
  async execute() {
    if (this.nodeFunction) {
      // If node hasn't been executed yet, always run the function at least once
      // to set up props, ports, and onReady callback, even if bypassed
      const needsInitialization = !this.hasExecuted;
      
      // Check if should execute
      if (!this.shouldExecute() && !needsInitialization) {
        this.executeBypass();
        return;
      }
      
      // Check if node is dirty (for incremental execution)
      if (!needsInitialization && !this.isDirtyCheck()) {
        // Node hasn't changed, skip execution
        return;
      }
      
      try {
        // Execute with timeout
        const executionPromise = this.nodeFunction(this, this.graph);
        const timeoutPromise = this.createTimeoutPromise(this.executionTimeout);
        
        await Promise.race([executionPromise, timeoutPromise]);
        
        this.error = null;
        this.hasExecuted = true;
        this.lastExecutionTime = Date.now();
        this.lastInputHash = this.calculateInputHash();
        this.isDirtyFlag = false;
        
        // Call onReady callback after node function has been set up
        // This allows nodes to perform initial setup like rendering previews
        if (this.onReady) {
          try {
            this.onReady();
          } catch (err: any) {
            // In Node.js environment, browser API errors are expected for browser-only nodes
            // Only log if it's not a browser API error
            const errMsg = err?.message || String(err);
            const isBrowserAPIError = 
              errMsg.includes('document is not defined') ||
              errMsg.includes('window is not defined') ||
              errMsg.includes('HTMLCanvasElement') ||
              errMsg.includes('HTMLImageElement');
            
            if (!isBrowserAPIError) {
              console.error(`Error in onReady callback for node ${this.name}:`, err);
            }
          }
        }
      } catch (err: any) {
        // Mark node as errored but don't break execution
        this.error = err as Error;
        this.isDirtyFlag = true; // Mark as dirty so it will retry on next execution
        
        // Only log non-timeout errors (timeout errors are expected)
        if (!err.message?.includes('timeout')) {
          console.error(`Error executing node ${this.name}:`, err);
        }
        
        // Don't throw - allow graph execution to continue
      }
    }
  }
  
  log(...args: any[]) {
    console.log(`[${this.name}]`, ...args);
  }
  
  async require(packageName: string, version?: string): Promise<any> {
    if (!this.graph.packageManager) {
      throw new Error('PackageManager not initialized');
    }
    return this.graph.packageManager.load(packageName, version);
  }
  
  // Add property getter for assets
  get assets() {
    return this.graph.assetManager;
  }
  
  preserveState() {
    return {
      inputs: this.inputs.map(p => ({
        id: p.id,
        name: p.name,
        value: p.value,
        connections: p.connections.map(c => c.id)
      })),
      outputs: this.outputs.map(p => ({
        id: p.id,
        name: p.name,
        value: p.value,
        connections: p.connections.map(c => c.id)
      })),
      props: Object.entries(this.props).reduce((acc, [key, prop]) => {
        acc[key] = prop.value;
        return acc;
      }, {} as Record<string, any>),
      bypassed: this.bypassed,
      cooking: this.cooking
    };
  }
  
  restoreState(state: any) {
    state.inputs?.forEach((saved: any) => {
      const port = this.inputs.find(p => p.id === saved.id || p.name === saved.name);
      if (port) {
        port.value = saved.value;
      }
    });
    
    state.outputs?.forEach((saved: any) => {
      const port = this.outputs.find(p => p.id === saved.id || p.name === saved.name);
      if (port) {
        port.value = saved.value;
      }
    });
    
    // Restore props
    if (state.props) {
      Object.entries(state.props).forEach(([key, value]: [string, any]) => {
        if (this.props[key]) {
          this.props[key].value = value;
        }
      });
    }
    
    // Restore behavior toggles
    if (state.bypassed !== undefined) {
      this.setBypassed(state.bypassed);
    }
    if (state.cooking !== undefined) {
      this.setCooking(state.cooking);
    }
  }
  
  // Clean up ports that were not used during compilation
  cleanupUnusedPorts() {
    const usedPorts = this.portsUsedDuringCompilation;
    
    // Remove unused input ports and disconnect them
    this.inputs = this.inputs.filter(port => {
      const isUsed = usedPorts.has(`input_${port.name}`);
      if (!isUsed) {
        // Disconnect all connections from this port
        port.connections.forEach(conn => {
          this.graph.disconnect(conn.id);
        });
      }
      return isUsed;
    });
    
    // Remove unused output ports and disconnect them
    this.outputs = this.outputs.filter(port => {
      const isUsed = usedPorts.has(`output_${port.name}`);
      if (!isUsed) {
        // Disconnect all connections from this port
        port.connections.forEach(conn => {
          this.graph.disconnect(conn.id);
        });
      }
      return isUsed;
    });
    
    // Clear the tracking set for next compilation
    this.portsUsedDuringCompilation.clear();
  }
  
  // Reset port tracking at the start of compilation
  resetPortTracking() {
    this.portsUsedDuringCompilation.clear();
  }
  
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      code: this.code,
      position: this.position,
      comment: this.comment,
      // Store port metadata to avoid execution for port discovery
      inputs: this.inputs.map(port => ({
        id: port.id,
        name: port.name,
        portType: port.portType,
        dataType: port.dataType,
        defaultValue: port.defaultValue
      })),
      outputs: this.outputs.map(port => ({
        id: port.id,
        name: port.name,
        portType: port.portType,
        dataType: port.dataType
      })),
      props: Object.entries(this.props).reduce((acc, [key, prop]) => {
        acc[key] = prop.value;
        return acc;
      }, {} as Record<string, any>),
      bypassed: this.bypassed,
      cooking: this.cooking
    };
  }
}

