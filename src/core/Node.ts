import type { NodeContext, InputPort, OutputPort, PortOptions, PortType, Connection, Prop } from '@/types/node.types';
import type { Graph } from './Graph';

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
  isDirty: boolean = false;
  
  inputs: InputPort[] = [];
  outputs: OutputPort[] = [];
  
  // Props System (v1.1)
  props: Record<string, Prop> = {};
  private propWatchers: Map<string, Function[]> = new Map();
  
  // Behavior Toggles (v1.2)
  bypassed: boolean = false;
  cooking: boolean = false;
  bypassOpacity: number = 1.0;
  cookAnimation: boolean = false;
  
  onReady?: () => void;
  onDestroy?: () => void;
  
  private nodeFunction?: Function;
  private graph: Graph;
  
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
    return port;
  }
  
  out<T>(name: string, portType: PortType = 'param'): OutputPort<T> {
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
    return port;
  }
  
  setFunction(fn: Function) {
    this.nodeFunction = fn;
  }
  
  // Props System Methods (v1.1)
  defineProp<T>(name: string, config: Prop<T>): void {
    this.props[name] = config as Prop;
  }
  
  updateProp(name: string, value: any): void {
    if (this.props[name]) {
      this.props[name].value = value;
      
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
            callback(value, this.props[name]);
          } catch (err) {
            console.error(`Error in prop watcher for ${name}:`, err);
          }
        });
      }
      
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
    this.isDirty = true;
  }
  
  async execute() {
    // Check if should execute
    if (!this.shouldExecute()) {
      this.executeBypass();
      return;
    }
    
    if (this.nodeFunction) {
      try {
        await this.nodeFunction(this, this.graph);
        this.error = null;
      } catch (err) {
        this.error = err as Error;
        console.error(`Error executing node ${this.name}:`, err);
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
      const port = this.inputs.find(p => p.id === saved.id);
      if (port) {
        port.value = saved.value;
      }
    });
    
    state.outputs?.forEach((saved: any) => {
      const port = this.outputs.find(p => p.id === saved.id);
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
  
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      code: this.code,
      position: this.position,
      comment: this.comment,
      props: Object.entries(this.props).reduce((acc, [key, prop]) => {
        acc[key] = prop.value;
        return acc;
      }, {} as Record<string, any>),
      bypassed: this.bypassed,
      cooking: this.cooking
    };
  }
}

