/**
 * Bundle field references in expressions.
 *
 * `ch("format.dpi")` reads field `dpi` of the bundle wired into this node's
 * `format` input. The path names an input, not another node's output, on
 * purpose: the wire is the dependency, so the scheduler orders the producer
 * first and an edit upstream reaches this parameter. Reading another node's
 * output by absolute path would be a dependency no wire records, cooked in
 * whatever order the graph happened to be in.
 *
 * Port and parameter names are identifiers, so a dot can only mean a field.
 */

const REFERENCE = /\b(?:ch|chs|chv)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

export interface BundleFieldReference {
  /** The input port, on the node whose parameter this is. */
  readonly port: string;
  readonly field: string;
  /** The path as written. */
  readonly path: string;
}

/** `format.dpi` or `./format.dpi` as port and field; null for anything else. */
export function parseBundleFieldPath(path: string): { port: string; field: string } | null {
  const local = path.startsWith("./") ? path.slice(2) : path;
  if (local.includes("/")) return null;
  const dot = local.indexOf(".");
  if (dot <= 0 || dot === local.length - 1) return null;
  return { port: local.slice(0, dot), field: local.slice(dot + 1) };
}

/** Every relative bundle field an expression reads, in source order. */
export function bundleFieldReferences(expression: string): BundleFieldReference[] {
  const references: BundleFieldReference[] = [];
  REFERENCE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = REFERENCE.exec(expression)) !== null) {
    const parsed = parseBundleFieldPath(match[1]);
    if (parsed) references.push({ ...parsed, path: match[1] });
  }
  return references;
}

/**
 * An absolute or parent path whose last segment looks like `port.field`:
 * an attempt to read another node's bundle without a wire. Returned so a
 * checker can say what to do instead.
 */
export function remoteBundlePath(path: string): { node: string; port: string; field: string } | null {
  const local = path.startsWith("./") ? path.slice(2) : path;
  const slash = local.lastIndexOf("/");
  if (slash === -1) return null;
  const last = local.slice(slash + 1);
  const dot = last.indexOf(".");
  if (dot <= 0 || dot === last.length - 1) return null;
  const node = local.slice(0, slash).split("/").filter((part) => part && part !== "." && part !== "..").pop();
  if (!node) return null;
  return { node, port: last.slice(0, dot), field: last.slice(dot + 1) };
}
