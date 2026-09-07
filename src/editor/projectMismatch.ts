/**
 * Detects a graph opened against the wrong server.
 *
 * A Cascade server is scoped to one project root: it compiles `project.*`
 * modules out of that root's `nodes/` directory and knows nothing about any
 * other project. Open one project's `.cascade` file in another project's Studio
 * and every project node fails to compile on its own, which surfaces as a
 * scatter of broken nodes rather than as the one sentence that explains it —
 * the graph is in the wrong server.
 *
 * The check cannot be "is this file under the server's root", tempting as that
 * is: File > Open goes through a browser file input, which hands over a name
 * and no path. What it can do is compare what the document asks for against
 * what the server has, which is the failure itself rather than a proxy for it.
 */

export interface ProjectMismatch {
  /** `project.*` module ids the document uses and this server cannot compile. */
  missing: string[];
  /** The project root this server does serve, for the message. */
  root: string;
}

/** Module ids a document asks for, in document order, deduplicated. */
export function projectModulesOf(document: unknown): string[] {
  const nodes = (document as { nodes?: unknown })?.nodes;
  if (!Array.isArray(nodes)) return [];
  const seen = new Set<string>();
  for (const node of nodes) {
    const id = (node as { module?: unknown; type?: unknown })?.module
      ?? (node as { type?: unknown })?.type;
    if (typeof id === 'string' && id.startsWith('project.')) seen.add(id);
  }
  return [...seen];
}

/**
 * What the document needs and the server does not have.
 *
 * `available` is the server's own module list — folder names, without the
 * `project.` prefix, exactly as `GET /api/nodes` returns them.
 */
export function missingProjectModules(document: unknown, available: readonly string[]): string[] {
  const have = new Set(available);
  return projectModulesOf(document).filter((id) => !have.has(id.slice('project.'.length)));
}

/**
 * The command that fixes it.
 *
 * Deliberately shows the port as a placeholder rather than guessing one: this
 * runs in the page, which cannot know what is free, and a command that names an
 * occupied port would fail in a way that looks like the same class of problem.
 */
export function launchHint(root: string): string {
  return `cascade ${root || '<project directory>'} --host ${location.hostname} --port <free port>`;
}
