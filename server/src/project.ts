/**
 * Single-project model — round 32 re-scope, per Marcus's own architecture:
 * Cascade is a generic framework/CLI, not a multi-project manager. A
 * "project" is just any existing git repo with a `.cascade` graph file at
 * its root and a `nodes/<module-name>/index.ts` folder for custom nodes
 * (observatory-cloud-plots becomes a project exactly as it already sits —
 * no migration, no separate projects database). `cascade ./` starts a
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

export { PathSafetyError };

export class ProjectRoot {
  readonly root: string;
  /** Graph named explicitly on the command line (`cascade cloud-plots.cascade`),
   * relative to the root. Null when `cascade` was pointed at a directory —
   * resolveDefaultGraph() then picks one by convention. */
  readonly explicitGraph: string | null;

  constructor(root: string, explicitGraph: string | null = null) {
    this.root = path.resolve(root);
    if (!fssync.existsSync(this.root) || !fssync.statSync(this.root).isDirectory()) {
      throw new Error(`Project root does not exist or is not a directory: ${this.root}`);
    }
    this.explicitGraph = explicitGraph;
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

  /**
   * Where a node module's work actually happens.
   *
   * Declared wins: a module can export `runsOn = 'server'` (or 'browser') and
   * that is taken at face value. Otherwise it is inferred, because the
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
    if (declared) return declared[1] as 'server' | 'browser';
    return /\/api\/exec|runStage\s*\(/.test(source) ? 'server' : 'browser';
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
