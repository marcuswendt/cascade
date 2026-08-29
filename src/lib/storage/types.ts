/**
 * Storage Adapter Types
 *
 * Defines the interface for storage backends (local filesystem, cloud, etc.)
 * This abstraction allows the same editor to work with different storage systems.
 */

/**
 * Project metadata
 */
export interface Project {
  name: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Graph content structure (matches existing .cascade file format)
 */
export interface GraphContent {
  name: string;
  nodes: unknown[];
  connections: unknown[];
  annotations?: unknown[];
  viewport?: {
    x: number;
    y: number;
    zoom: number;
  };
}

/**
 * Graph metadata with content
 */
export interface Graph {
  slug: string;
  name: string;
  content: GraphContent;
  updatedAt: Date;
}

/**
 * Asset file information
 */
export interface Asset {
  filename: string;
  path: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * Storage adapter interface
 *
 * Implementations:
 * - LocalStorageAdapter: Filesystem-based storage for Electron app
 * - CloudStorageAdapter: (Future) Cloud-based storage for web app
 */
export interface StorageAdapter {
  /** Project root path or identifier */
  readonly projectRoot: string;

  // ============ Project Metadata ============

  /** Get project metadata */
  getProject(): Promise<Project>;

  /** Update project metadata */
  updateProject(data: Partial<Project>): Promise<Project>;

  // ============ Graphs ============

  /** List all graphs in the project */
  listGraphs(): Promise<Graph[]>;

  /** Get a specific graph by slug */
  getGraph(slug: string): Promise<Graph | null>;

  /** Save a graph (create or update) */
  saveGraph(slug: string, content: GraphContent): Promise<Graph>;

  /** Create a new graph with the given name */
  createGraph(name: string): Promise<Graph>;

  /** Delete a graph */
  deleteGraph(slug: string): Promise<void>;

  /** Rename a graph */
  renameGraph(slug: string, newName: string): Promise<Graph>;

  // ============ Assets ============

  /** List all assets in the project */
  listAssets(): Promise<Asset[]>;

  /** Get URL for an asset (for display in the app) */
  getAssetUrl(path: string): string;

  /** Import an asset file into the project */
  importAsset(file: File, targetPath?: string): Promise<Asset>;

  /** Delete an asset */
  deleteAsset(path: string): Promise<void>;
}

/**
 * Result type for adapter operations that can fail
 */
export interface StorageResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}
