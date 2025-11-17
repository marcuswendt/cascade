export type PortType = 'trigger' | 'param';
export type DataType = 'number' | 'string' | 'boolean' | 'color' | 'asset' | 'array' | 'object' | 'any';

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
  
  in<T>(name: string, defaultValue?: T, options?: PortOptions): InputPort<T>;
  out<T>(name: string, portType?: PortType): OutputPort<T>;
  
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

