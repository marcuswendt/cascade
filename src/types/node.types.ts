export type PortType = 'trigger' | 'param';
export type DataType = 'number' | 'string' | 'boolean' | 'color' | 'asset' | 'array' | 'object' | 'any';
export type PropControlType = 'number' | 'slider' | 'text' | 'textarea' | 'color' | 'image' | 'boolean' | 'select' | 'vector' | 'range' | 'button' | 'folder' | 'group';

export interface PortOptions {
  type?: DataType;
  min?: number;
  max?: number;
  step?: number;
  values?: any[];
  accept?: string[];
  description?: string;
  hidden?: boolean;
  published?: boolean;
  multiline?: boolean;
}

export interface InputPort<T = any> {
  id: string;
  name: string;
  portType: PortType;
  dataType: DataType;
  value: T;
  defaultValue: T;
  options: PortOptions;
  connections: Connection[];
  onChange?: (value: T) => void;
  onTrigger?: (props?: any) => void;
}

export interface OutputPort<T = any> {
  id: string;
  name: string;
  portType: PortType;
  dataType: DataType;
  value: T;
  connections: Connection[];
  setValue: (value: T) => void;
  trigger: (props?: any) => void;
}

export interface NodeContext {
  id: string;
  name: string;
  type: string;
  code: string;
  position: { x: number; y: number };
  preview: HTMLCanvasElement | HTMLImageElement | null;
  comment: string;
  error: Error | null;
  warning: string | null;
  isTemplate: boolean;
  isDirty: boolean;
  
  inputs: InputPort[];
  outputs: OutputPort[];
  
  // Props System (v1.1)
  props: Record<string, Prop>;
  
  // Behavior Toggles (v1.2)
  bypassed: boolean;
  cooking: boolean;
  
  in<T>(name: string, defaultValue?: T, options?: PortOptions): InputPort<T>;
  out<T>(name: string, portType?: PortType): OutputPort<T>;
  
  // Props Methods
  defineProp<T>(name: string, config: Prop<T>): void;
  updateProp(name: string, value: any): void;
  watchProp(name: string, callback: Function): void;
  
  // Behavior Toggle Methods
  setBypassed(value: boolean): void;
  setCooking(value: boolean): void;
  shouldExecute(): boolean;
  executeBypass(): void;
  
  onReady?: () => void;
  onDestroy?: () => void;
  
  log(...args: any[]): void;
  require(packageName: string): Promise<any>;
}

export interface Connection {
  id: string;
  from: { nodeId: string; portId: string };
  to: { nodeId: string; portId: string };
  type: PortType;
}

export interface Prop<T = any> {
  value: T;
  
  // Parameters
  params?: {
    min?: number | number[];
    max?: number | number[];
    step?: number;
    options?: Array<T | { value: T; label: string }>;
    accept?: string;  // For file inputs
    locked?: boolean; // For vector inputs
  };
  
  // Callbacks
  onChange?: (prop: Prop<T>, context: NodeContext) => void | Promise<void>;
  
  // Display
  displayName?: string | null;
  type?: PropControlType;
  
  // Visibility
  disabled?: boolean | (() => boolean);
  hidden?: boolean | (() => boolean);
  
  // Organization
  folder?: string;
  group?: string;
}



