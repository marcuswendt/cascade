export type PortType = 'trigger' | 'param';
export type DataType = 'number' | 'string' | 'boolean' | 'color' | 'asset' | 'array' | 'object' | 'any';
export type PropControlType = 'number' | 'int' | 'slider' | 'text' | 'textarea' | 'color' | 'image' | 'boolean' | 'select' | 'vector' | 'vec2' | 'vec3' | 'vec2i' | 'vec3i' | 'range' | 'button' | 'folder' | 'group' | 'colorramp';

// ============================================================================
// Node Source System (v0.2)
// ============================================================================

/**
 * File status for project (external) modules
 */
export type FileStatus = 'synced' | 'missing' | 'conflict' | 'modified-external';

/**
 * Code version entry for history tracking
 */
export interface CodeVersion {
  code: string;
  timestamp: string;
  author: 'user' | 'ai';
  prompt?: string;  // AI prompt if author is 'ai'
}

/**
 * Standard library source - read-only, loaded from templates
 */
export interface StdlibSource {
  type: 'stdlib';
  module: string;  // e.g., 'cascade.lens.Color'
}

/**
 * Embedded source - stored inline in .cascade file, editable
 */
export interface EmbeddedSource {
  type: 'embedded';
  module: string;  // e.g., 'local.MyCustomNode'
  code: string;
  history: CodeVersion[];
}

/**
 * Project source - stored in external file, editable externally
 */
export interface ProjectSource {
  type: 'project';
  module: string;       // e.g., 'myproject.filters.Blur'
  file: string;         // relative path e.g., './src/filters/Blur.ts'
  cachedCode: string;   // backup copy for when file is missing
  lastSync: string;     // ISO timestamp of last sync
  status: FileStatus;
}

/**
 * Union type for all node sources
 */
export type NodeSource = StdlibSource | EmbeddedSource | ProjectSource;

/**
 * Project package definition - maps an alias to a filesystem path
 */
export interface ProjectPackage {
  path: string;    // relative or absolute path to package root
  alias: string;   // module prefix e.g., 'myproject'
}

/**
 * Embedded module stored in .cascade file
 */
export interface EmbeddedModule {
  code: string;
  history: CodeVersion[];
  created?: string;
  modified?: string;
}

/**
 * External module reference stored in .cascade file
 */
export interface ExternalModule {
  file: string;         // relative path to .ts file
  cachedCode: string;   // backup copy
  lastSync: string;     // ISO timestamp
}

/**
 * Project configuration in .cascade file
 */
export interface ProjectConfig {
  name?: string;
  packages: ProjectPackage[];
}

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
  variadic?: boolean;  // True if this port belongs to a variadic group
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
  options?: PortOptions;
  setValue: (value: T) => void;
  trigger: (props?: any) => void;
}

export interface Connection {
  id: string;
  from: { nodeId: string; portId: string };
  to: { nodeId: string; portId: string };
  type: PortType;
}

// ============================================================================
// Props System
// ============================================================================

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
    integer?: boolean; // Explicit integer mode
    small?: boolean; // For button inputs - compact size
  };

  // Callbacks - context is the Node instance
  onChange?: (prop: Prop<T>, context: any) => void | Promise<void>;

  // Display
  displayName?: string | null;
  type?: PropControlType;

  // Visibility
  disabled?: boolean | (() => boolean);
  hidden?: boolean | (() => boolean);
  condition?: () => boolean; // Alternative to hidden - shows when true

  // Organization
  folder?: string;
  group?: string;

  // Expression support (for path-based parameter references)
  expression?: string;           // TypeScript expression (e.g., "ch('../timer1/value') * 2")
  expressionError?: string;      // Validation error message if expression is invalid
}
