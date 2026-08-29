/**
 * Single-project model — round 32 re-scope, per Marcus's own architecture:
 * Cascade is a generic framework/CLI, not a multi-project manager. A
 * "project" is just any existing git repo with a `.cascade` graph file at
 * its root and a `nodes/<module-name>/index.ts` folder for custom nodes
 * (an existing artwork repo becomes a project exactly as it already sits —
 * no migration, no separate projects database). `cascade .` starts a
 * server scoped to CWD (or an explicit path argument); there is no
 * project list/switch inside the app — switching projects means running
 * `cascade` in a different directory.
 *
 * This replaces the earlier multi-project PROJECTS_DIR model entirely —
 * everything here is scoped to ONE fixed PROJECT_ROOT, set once at
 * startup (see cli.ts), not per-request.
 */
import fs from 'fs/promises';
import fssync from 'fs';
import path from 'path';
import { resolveWithinRoot, PathSafetyError } from './pathSafety.js';
import { ShellService } from './shell/service.js';

export { PathSafetyError };

export interface ProjectPanelMeta {
  readonly name: string;
  readonly title: string;
  readonly icon: string | null;
  readonly rendererTypes?: readonly string[];
}

export class ProjectRoot {
  readonly root: string;
  readonly shell: ShellService;
  /** Graph named explicitly on the command line (`cascade artwork.cascade`),
   * relative to the root. Null when `cascade` was pointed at a directory —
   * resolveDefaultGraph() then picks one by convention. */
  readonly explicitGraph: string | null;

  constructor(root: string, explicitGraph: string | null = null) {
    this.root = path.resolve(root);
    if (!fssync.existsSync(this.root) || !fssync.statSync(this.root).isDirectory()) {
      throw new Error(`Project root does not exist or is not a directory: ${this.root}`);
    }
    this.explicitGraph = explicitGraph;
    this.shell = new ShellService(this);
  }

  /** The graph the client should open on startup, or null when there is
   * nothing obvious to open. Order: the file named on the command line,
   * then `index.cascade` by convention, then the sole `.cascade` file if
   * there is exactly one. With several files and no `index.cascade` this
   * returns null rather than guessing — the app opens empty and File >
   * Open picks. */
  async resolveDefaultGraph(): Promise<string | null> {
    if (this.explicitGraph) return this.explicitGraph;
    const graphs = await this.listGraphFiles();
    if (graphs.includes('index.cascade')) return 'index.cascade';
    if (graphs.length === 1) return graphs[0];
    return null;
  }

  /** Split a `cascade <arg>` argument into a root directory and, when the
   * argument named a `.cascade` file, the graph inside it. */
  static fromArg(arg: string): ProjectRoot {
    const resolved = path.resolve(arg);
    const isFile = fssync.existsSync(resolved) && fssync.statSync(resolved).isFile();
    if (isFile || resolved.endsWith('.cascade')) {
      if (!resolved.endsWith('.cascade')) {
        throw new Error(`Not a .cascade file: ${resolved}`);
      }
      if (!isFile) {
        throw new Error(`Graph file does not exist: ${resolved}`);
      }
      return new ProjectRoot(path.dirname(resolved), path.basename(resolved));
    }
    return new ProjectRoot(resolved);
  }

  resolve(relativePath: string = ''): string {
    return resolveWithinRoot(this.root, relativePath);
  }

  get isGitRepo(): boolean {
    return fssync.existsSync(path.join(this.root, '.git'));
  }

  /** Every `*.cascade` file directly in the project root, relative names,
   * sorted — a project may have exactly one (the common case) or several
   * (test-quill's convo1/convo2/test-quill1 is real, not a bug to design
   * away). The caller decides what "the" graph means when there's more
   * than one; this just reports what's actually there. */
  async listGraphFiles(): Promise<string[]> {
    const entries = await fs.readdir(this.root, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith('.cascade'))
      .map((e) => e.name)
      .sort();
  }

  async readGraph(filename: string): Promise<string> {
    const full = this.resolve(filename);
    if (!filename.endsWith('.cascade')) {
      throw new PathSafetyError(`not a .cascade file: ${filename}`);
    }
    return fs.readFile(full, 'utf-8');
  }

  async writeGraph(filename: string, content: string): Promise<void> {
    const full = this.resolve(filename);
    if (!filename.endsWith('.cascade')) {
      throw new PathSafetyError(`not a .cascade file: ${filename}`);
    }
    await fs.writeFile(full, content, 'utf-8');
  }

  /** `nodes/<moduleName>/` folders — one per custom node type. */
  async listNodeModules(): Promise<string[]> {
    const nodesDir = this.resolve('nodes');
    if (!fssync.existsSync(nodesDir)) return [];
    const entries = await fs.readdir(nodesDir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort();
  }

  /** Project-owned browser panels. A project-local panel overrides a panel
   * with the same name provided by `shared/panels`. */
  async listPanels(): Promise<string[]> {
    const [local, shared] = await Promise.all([
      this.listPanelDirectory(this.resolve('panels')),
      this.listPanelDirectory(this.resolveShared('panels')),
    ]);
    return [...new Set([...local, ...shared])].sort();
  }

  /** Statically declared panel metadata. Reading this never imports or
   * executes project code. */
  async panelMeta(name: string): Promise<ProjectPanelMeta> {
    const source = await this.readPanelModuleFile(name);
    const rendererTypes = exportedStringArray(source, 'rendererTypes');
    return {
      name,
      title: exportedString(source, 'title') ?? name,
      icon: exportedString(source, 'icon'),
      ...(rendererTypes === null ? {} : { rendererTypes }),
    };
  }

  /** Resolve the selected panel entry, preferring the project-local version.
   * Kept public for the compiler; callers must not use it for arbitrary files. */
  async resolvePanelEntry(name: string): Promise<string> {
    this.assertExtensionName(name, 'panel');
    const entries = [
      this.resolve(path.join('panels', name, 'index.ts')),
      this.resolveShared('panels', name, 'index.ts'),
    ];
    for (const entry of entries) {
      try {
        const stat = await fs.stat(entry);
        if (stat.isFile()) return entry;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    }
    // Preserve normal filesystem ENOENT semantics for route error handling.
    await fs.access(entries[0]);
    return entries[0];
  }

  /**
   * Where a node module's work actually happens.
   *
   * A declaration normally wins. `cascade/shell` is the exception: it is a
   * server-only effect, so declaring that import as browser code is rejected
   * before compilation or loading. Otherwise the environment is inferred,
   * distinction is already legible in the code — a node whose work happens
   * server-side is exactly one that calls the exec bridge, since a module
   * compiled into the browser cannot spawn a subprocess itself. That fallback
   * is what makes every existing Python-backed node report correctly without
   * being edited.
   *
   * Both kinds are peers: they exchange images as project-relative paths, which
   * the browser reads back through /api/media.
   */
  async moduleRunsOn(moduleName: string): Promise<'server' | 'browser'> {
    let source: string;
    try {
      source = await this.readNodeModuleFile(moduleName);
    } catch {
      return 'browser';
    }
    const declared = source.match(/export\s+const\s+runsOn\s*[:=][^'"`]*['"`](server|browser)['"`]/);
    const importsShell = /(?:from\s+|import\s*(?:\(\s*)?|require\s*\(\s*)['"`]cascade\/shell['"`]/.test(source);
    if (importsShell && declared?.[1] === 'browser') {
      throw new Error(`Node module "${moduleName}" imports cascade/shell but declares runsOn = 'browser'; shell nodes must run on the server`);
    }
    if (declared) return declared[1] as 'server' | 'browser';
    return /\/api\/exec|runStage\s*\(/.test(source) || importsShell ? 'server' : 'browser';
  }

  /**
   * A node module's declared icon, if it names one: `export const icon = 'Cloud'`.
   *
   * A project's nodes all fell back to the same cog, because the icon table is a
   * hardcoded list of Cascade's own built-ins and knows nothing about a project.
   * Letting a module say what it is turns a wall of identical boxes into
   * something you can read at a glance.
   */
  async moduleIcon(moduleName: string): Promise<string | null> {
    try {
      const source = await this.readNodeModuleFile(moduleName);
      return source.match(/export\s+const\s+icon\s*[:=][^'"`]*['"`]([A-Za-z0-9]+)['"`]/)?.[1] ?? null;
    } catch {
      return null;
    }
  }

  private async readPanelModuleFile(name: string): Promise<string> {
    return fs.readFile(await this.resolvePanelEntry(name), 'utf-8');
  }

  private async listPanelDirectory(directory: string): Promise<string[]> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }

    const panels = await Promise.all(entries
      .filter((entry) => !entry.name.startsWith('.') && (entry.isDirectory() || entry.isSymbolicLink()))
      .map(async (entry) => {
        try {
          return (await fs.stat(path.join(directory, entry.name, 'index.ts'))).isFile() ? entry.name : null;
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
          throw err;
        }
      }));
    return panels.filter((name): name is string => name !== null);
  }

  /** `shared/` may intentionally link to a sibling library. Its canonical
   * target is a second confined root for shared project extensions only. */
  private resolveShared(...segments: string[]): string {
    const sharedLink = path.join(this.root, 'shared');
    let sharedRoot = sharedLink;
    try {
      sharedRoot = fssync.realpathSync(sharedLink);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return path.join(sharedLink, ...segments);
      throw error;
    }
    return resolveWithinRoot(sharedRoot, ...segments);
  }

  private assertExtensionName(name: string, kind: string): void {
    if (!name || name === '.' || name === '..' || name.startsWith('.') || name !== path.basename(name)) {
      throw new PathSafetyError(`invalid ${kind} name: ${name}`);
    }
  }

  async readNodeModuleFile(moduleName: string, relativeFile: string = 'index.ts'): Promise<string> {
    const full = this.resolve(path.join('nodes', moduleName, relativeFile));
    return fs.readFile(full, 'utf-8');
  }

  async writeNodeModuleFile(moduleName: string, relativeFile: string, content: string): Promise<void> {
    const full = this.resolve(path.join('nodes', moduleName, relativeFile));
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf-8');
  }

  async ensureNodeModuleScaffold(moduleName: string): Promise<void> {
    const dir = this.resolve(path.join('nodes', moduleName));
    await fs.mkdir(dir, { recursive: true });
    const indexPath = path.join(dir, 'index.ts');
    if (!fssync.existsSync(indexPath)) {
      await fs.writeFile(
        indexPath,
        `// ${moduleName} — scaffolded by Cascade. Replace with real node logic.\n` +
          `// Every node module exports execute(node, graph); real imports work here —\n` +
          `// relative files in this project, npm deps, whatever the code needs.\n\n` +
          `export function execute(node, graph) {\n  // node.in('name', defaultValue) / node.out('name').setValue(value)\n}\n`,
        'utf-8'
      );
    }
  }
}

/** Extract a literal `export const` string without evaluating the module. */
function exportedString(source: string, exportName: string): string | null {
  const match = source.match(new RegExp(
    `export\\s+const\\s+${exportName}\\s*(?::[^=]+)?=\\s*([\\'\"\x60])((?:\\\\.|(?!\\1)[^\\\\])*)\\1`
  ));
  if (!match || (match[1] === '`' && match[2].includes('${'))) return null;
  if (match[1] === '"') {
    try {
      return JSON.parse(`"${match[2]}"`) as string;
    } catch {
      return null;
    }
  }
  return match[2].replace(/\\([\\'"`])/g, '$1');
}

/** Extract a literal exported string array. Any non-literal member makes the
 * declaration undiscoverable rather than causing project code to execute. */
function exportedStringArray(source: string, exportName: string): string[] | null {
  const declaration = new RegExp(`export\\s+const\\s+${exportName}\\s*(?::[^=]+)?=\\s*\\[`).exec(source);
  if (!declaration) return null;

  const values: string[] = [];
  const start = declaration.index + declaration[0].length;
  const end = source.indexOf(']', start);
  if (end < 0) return null;
  const contents = source.slice(start, end);
  const literal = /(['"`])([^'"`]*)\1/g;
  let cursor = 0;
  for (const match of contents.matchAll(literal)) {
    if (!/^[\s,]*$/.test(contents.slice(cursor, match.index))) return null;
    if (match[1] === '`' && match[2].includes('${')) return null;
    const decoded = exportedString(`export const value = ${match[0]}`, 'value');
    if (decoded === null) return null;
    values.push(decoded);
    cursor = (match.index ?? 0) + match[0].length;
  }
  return /^[\s,]*$/.test(contents.slice(cursor)) ? values : null;
}
