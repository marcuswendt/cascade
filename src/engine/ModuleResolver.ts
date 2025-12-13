/**
 * ModuleResolver - Resolves module paths to source code
 *
 * Handles three source types:
 * 1. stdlib (cascade.*) - Standard library templates
 * 2. embedded (local.*) - Code stored in .cascade file
 * 3. project (<alias>.*) - External files in project packages
 */

import type {
  NodeSource,
  StdlibSource,
  EmbeddedSource,
  ProjectSource,
  ProjectPackage,
  EmbeddedModule,
  ExternalModule,
  FileStatus,
  CodeVersion
} from '../types/node.types.js';
import { getNodeClass } from '../utils/nodeTypeUtils.js';

export interface ModuleResolution {
  source: NodeSource;
  code: string;
  displayPath: string;  // Human-readable path for UI
  editable: boolean;
}

export interface ResolverConfig {
  projectPackages: ProjectPackage[];
  embeddedModules: Map<string, EmbeddedModule>;
  externalModules: Map<string, ExternalModule>;
  basePath?: string;  // Base path for resolving relative paths
}

export class ModuleResolver {
  private config: ResolverConfig;
  private fileReadFn?: (path: string) => Promise<string | null>;
  private fileExistsFn?: (path: string) => Promise<boolean>;

  constructor(config: ResolverConfig) {
    this.config = config;
  }

  /**
   * Set file system functions for reading external files
   * These are injected to allow different implementations (browser vs Node.js)
   */
  setFileSystemFunctions(
    readFn: (path: string) => Promise<string | null>,
    existsFn: (path: string) => Promise<boolean>
  ): void {
    this.fileReadFn = readFn;
    this.fileExistsFn = existsFn;
  }

  /**
   * Resolve a module path to its source code and metadata
   */
  async resolve(modulePath: string): Promise<ModuleResolution | null> {
    // 1. Check if it's a standard library module (cascade.*)
    if (modulePath.startsWith('cascade.')) {
      return this.resolveStdlib(modulePath);
    }

    // 2. Check if it's an embedded module (local.*)
    if (modulePath.startsWith('local.')) {
      return this.resolveEmbedded(modulePath);
    }

    // 3. Check project packages
    for (const pkg of this.config.projectPackages) {
      if (modulePath.startsWith(`${pkg.alias}.`)) {
        return this.resolveProject(modulePath, pkg);
      }
    }

    // 4. Fallback: check if it's in embedded modules by exact match
    if (this.config.embeddedModules.has(modulePath)) {
      return this.resolveEmbedded(modulePath);
    }

    return null;
  }

  /**
   * Resolve a standard library module
   * Class-based stdlib nodes don't have editable code
   */
  private resolveStdlib(modulePath: string): ModuleResolution | null {
    // Check if the node class exists
    const NodeClass = getNodeClass(modulePath);
    if (!NodeClass) {
      return null;
    }

    const source: StdlibSource = {
      type: 'stdlib',
      module: modulePath
    };

    // Extract library and type for display path
    const parts = modulePath.split('.');
    const displayPath = `<cascade>/${parts.slice(1).join('/')}.ts`;

    return {
      source,
      code: '', // Class-based nodes don't have editable code
      displayPath,
      editable: false
    };
  }

  /**
   * Resolve an embedded module
   */
  private resolveEmbedded(modulePath: string): ModuleResolution | null {
    const embedded = this.config.embeddedModules.get(modulePath);
    if (!embedded) {
      return null;
    }

    const source: EmbeddedSource = {
      type: 'embedded',
      module: modulePath,
      code: embedded.code,
      history: embedded.history || []
    };

    return {
      source,
      code: embedded.code,
      displayPath: '<embedded>',
      editable: true
    };
  }

  /**
   * Resolve a project module from an external file
   */
  private async resolveProject(
    modulePath: string,
    pkg: ProjectPackage
  ): Promise<ModuleResolution | null> {
    // Convert module path to file path
    // e.g., 'myproject.filters.Blur' with alias 'myproject' and path './src'
    // becomes './src/filters/Blur.ts'
    const relativeParts = modulePath.replace(`${pkg.alias}.`, '').split('.');
    const filePath = `${pkg.path}/${relativeParts.join('/')}.ts`;

    // Check for cached external module
    const external = this.config.externalModules.get(modulePath);
    let code: string | null = null;
    let status: FileStatus = 'synced';

    // Try to read the file
    if (this.fileReadFn && this.fileExistsFn) {
      const fullPath = this.resolvePath(filePath);
      const exists = await this.fileExistsFn(fullPath);

      if (exists) {
        code = await this.fileReadFn(fullPath);
        if (code !== null) {
          // Check if external file was modified
          if (external && external.cachedCode !== code) {
            status = 'modified-external';
          }
        }
      } else {
        status = 'missing';
        // Use cached code if available
        code = external?.cachedCode || null;
      }
    } else if (external) {
      // No file system access, use cached code
      code = external.cachedCode;
    }

    if (code === null) {
      return null;
    }

    const source: ProjectSource = {
      type: 'project',
      module: modulePath,
      file: filePath,
      cachedCode: code,
      lastSync: new Date().toISOString(),
      status
    };

    return {
      source,
      code,
      displayPath: filePath,
      editable: true
    };
  }

  /**
   * Resolve a relative path to an absolute path
   */
  private resolvePath(relativePath: string): string {
    if (!this.config.basePath) {
      return relativePath;
    }
    // Simple path joining - in browser this would be different
    if (relativePath.startsWith('./')) {
      return `${this.config.basePath}/${relativePath.slice(2)}`;
    }
    if (relativePath.startsWith('/')) {
      return relativePath;
    }
    return `${this.config.basePath}/${relativePath}`;
  }

  /**
   * Determine the source type for a given module path
   */
  getSourceType(modulePath: string): 'stdlib' | 'embedded' | 'project' | null {
    if (modulePath.startsWith('cascade.')) {
      return 'stdlib';
    }
    if (modulePath.startsWith('local.')) {
      return 'embedded';
    }
    for (const pkg of this.config.projectPackages) {
      if (modulePath.startsWith(`${pkg.alias}.`)) {
        return 'project';
      }
    }
    if (this.config.embeddedModules.has(modulePath)) {
      return 'embedded';
    }
    return null;
  }

  /**
   * Create a new embedded module from stdlib (duplicate)
   */
  duplicateToEmbedded(
    stdlibPath: string,
    newName?: string
  ): { modulePath: string; module: EmbeddedModule } | null {
    const resolution = this.resolveStdlib(stdlibPath);
    if (!resolution) {
      return null;
    }

    // Generate module name
    const typeName = stdlibPath.split('.').pop() || 'Custom';
    const baseName = newName || typeName;
    let modulePath = `local.${baseName}`;

    // Ensure unique name
    let counter = 1;
    while (this.config.embeddedModules.has(modulePath)) {
      modulePath = `local.${baseName}${counter}`;
      counter++;
    }

    const now = new Date().toISOString();
    const initialVersion: CodeVersion = {
      code: resolution.code,
      timestamp: now,
      author: 'user'
    };

    const module: EmbeddedModule = {
      code: resolution.code,
      history: [initialVersion],
      created: now,
      modified: now
    };

    // Add to embedded modules
    this.config.embeddedModules.set(modulePath, module);

    return { modulePath, module };
  }

  /**
   * Create an external file from an embedded module (extract)
   */
  async extractToProject(
    embeddedPath: string,
    pkg: ProjectPackage,
    fileName: string
  ): Promise<{ modulePath: string; filePath: string } | null> {
    const embedded = this.config.embeddedModules.get(embeddedPath);
    if (!embedded) {
      return null;
    }

    // Build the file path and module path
    const filePath = `${pkg.path}/${fileName}.ts`;
    const modulePath = `${pkg.alias}.${fileName.replace(/\//g, '.')}`;

    // Store as external module
    const external: ExternalModule = {
      file: filePath,
      cachedCode: embedded.code,
      lastSync: new Date().toISOString()
    };
    this.config.externalModules.set(modulePath, external);

    // Note: Actual file writing would be handled by the caller
    // This just updates the resolver's state

    return { modulePath, filePath };
  }

  /**
   * Update embedded module code and record in history
   */
  updateEmbeddedCode(
    modulePath: string,
    newCode: string,
    author: 'user' | 'ai' = 'user',
    prompt?: string
  ): boolean {
    const embedded = this.config.embeddedModules.get(modulePath);
    if (!embedded) {
      return false;
    }

    const now = new Date().toISOString();
    const version: CodeVersion = {
      code: newCode,
      timestamp: now,
      author,
      prompt
    };

    embedded.history.push(version);
    embedded.code = newCode;
    embedded.modified = now;

    return true;
  }

  /**
   * Restore embedded module to a previous version
   */
  restoreVersion(modulePath: string, versionIndex: number): boolean {
    const embedded = this.config.embeddedModules.get(modulePath);
    if (!embedded || versionIndex < 0 || versionIndex >= embedded.history.length) {
      return false;
    }

    const version = embedded.history[versionIndex];
    embedded.code = version.code;
    embedded.modified = new Date().toISOString();

    // Add restoration as a new history entry
    embedded.history.push({
      code: version.code,
      timestamp: embedded.modified,
      author: 'user'
    });

    return true;
  }

  /**
   * Get all registered project packages
   */
  getProjectPackages(): ProjectPackage[] {
    return [...this.config.projectPackages];
  }

  /**
   * Add a project package
   */
  addProjectPackage(pkg: ProjectPackage): void {
    // Check for duplicate alias
    const existing = this.config.projectPackages.find(p => p.alias === pkg.alias);
    if (existing) {
      existing.path = pkg.path;
    } else {
      this.config.projectPackages.push(pkg);
    }
  }

  /**
   * Remove a project package
   */
  removeProjectPackage(alias: string): boolean {
    const index = this.config.projectPackages.findIndex(p => p.alias === alias);
    if (index >= 0) {
      this.config.projectPackages.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Sync an external module with its file
   */
  async syncExternalModule(modulePath: string): Promise<FileStatus> {
    const external = this.config.externalModules.get(modulePath);
    if (!external || !this.fileReadFn || !this.fileExistsFn) {
      return 'missing';
    }

    const fullPath = this.resolvePath(external.file);
    const exists = await this.fileExistsFn(fullPath);

    if (!exists) {
      return 'missing';
    }

    const code = await this.fileReadFn(fullPath);
    if (code === null) {
      return 'missing';
    }

    external.cachedCode = code;
    external.lastSync = new Date().toISOString();

    return 'synced';
  }

  /**
   * Export configuration for serialization
   */
  exportConfig(): {
    projectPackages: ProjectPackage[];
    embeddedModules: Record<string, EmbeddedModule>;
    externalModules: Record<string, ExternalModule>;
  } {
    return {
      projectPackages: [...this.config.projectPackages],
      embeddedModules: Object.fromEntries(this.config.embeddedModules),
      externalModules: Object.fromEntries(this.config.externalModules)
    };
  }

  /**
   * Import configuration from deserialization
   */
  importConfig(config: {
    projectPackages?: ProjectPackage[];
    embeddedModules?: Record<string, EmbeddedModule>;
    externalModules?: Record<string, ExternalModule>;
  }): void {
    if (config.projectPackages) {
      this.config.projectPackages = [...config.projectPackages];
    }
    if (config.embeddedModules) {
      this.config.embeddedModules = new Map(Object.entries(config.embeddedModules));
    }
    if (config.externalModules) {
      this.config.externalModules = new Map(Object.entries(config.externalModules));
    }
  }
}

/**
 * Create a ModuleResolver with empty configuration
 */
export function createModuleResolver(basePath?: string): ModuleResolver {
  return new ModuleResolver({
    projectPackages: [],
    embeddedModules: new Map(),
    externalModules: new Map(),
    basePath
  });
}
