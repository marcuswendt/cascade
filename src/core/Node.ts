import type { NodeContext, InputPort, OutputPort, PortOptions, PortType, Connection } from '@/types/node.types';
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
  
  async execute() {
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
      }))
    };
  }
  
  restoreState(state: any) {
    state.inputs.forEach((saved: any) => {
      const port = this.inputs.find(p => p.id === saved.id);
      if (port) {
        port.value = saved.value;
      }
    });
    
    state.outputs.forEach((saved: any) => {
      const port = this.outputs.find(p => p.id === saved.id);
      if (port) {
        port.value = saved.value;
      }
    });
  }
  
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      code: this.code,
      position: this.position,
      comment: this.comment
    };
  }
}

