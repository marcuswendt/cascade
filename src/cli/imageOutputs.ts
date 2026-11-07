/**
 * Which image outputs a run saves, and what the saved files are called.
 *
 * Shared by `cascade run` (a still with `--out`) and `cascade run --frames`, so
 * one graph names its files the same way either way:
 *
 *     <out>/<node>.<ext>                 a still, a node with one image output
 *     <out>/<node>.<port>.<ext>          a still, a node with several
 *     <out>/<node>[.<port>].<frame>.<ext> a frame sequence
 *
 * The port only appears when the node has more than one image output, which
 * keeps the common case unchanged and stops a node with `image` and `mask`
 * from writing both to one file, the later overwriting the earlier.
 *
 * An output counts as an image when it is typed `image`, or when it is typed
 * `any` and carries one: `cascade.core.Null` passing an image is how a graph
 * names a final output, and a Null typed `any` used to be skipped.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { LoadedCascadeGraph } from '../../packages/runtime/src/types.js';
import { imagePath } from './sequence.js';
import { copyImageFile } from './headlessIo.js';

export interface ImageOutput {
  readonly nodeId: string;
  readonly port: string;
  readonly value: unknown;
  /** True when the node has more than one image output, so the port goes in the name. */
  readonly shared: boolean;
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ppm', '.pgm', '.tif', '.tiff', '.exr', '.bmp', '.avif', '.hdr']);

/** True when an `any`-typed value is an image: an asset with an image media type, or a path with an image extension. */
export function looksLikeImage(value: unknown): boolean {
  const file = imagePath(value);
  if (!file) return false;
  const mediaType = value && typeof value === 'object' ? (value as { mediaType?: unknown }).mediaType : undefined;
  if (typeof mediaType === 'string') return mediaType.startsWith('image/');
  return IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase());
}

/**
 * The image outputs to save:
 * - with `nodes` (`--node`), those nodes' image outputs, connected or not;
 * - otherwise every image output nothing downstream consumes;
 * - plus, either way, the image outputs of `extra` (`--out-node`), which are
 *   usually mid-graph and connected.
 */
export function collectImageOutputs(
  graph: LoadedCascadeGraph,
  options: { nodes?: readonly string[]; extra?: readonly string[] } = {},
): ImageOutput[] {
  return planImageOutputs(graph, options).collect();
}

/**
 * Which ports could carry a saved image, worked out once from the graph's
 * shape; `collect()` then reads only those nodes' outputs. A frame loop plans
 * once per run: `inspect()` per frame used to walk (and, before the runtime
 * stopped copying, deep-clone) every input, output and prop of every node.
 */
export function planImageOutputs(
  graph: LoadedCascadeGraph,
  options: { nodes?: readonly string[]; extra?: readonly string[] } = {},
): { collect(): ImageOutput[] } {
  const wanted = new Set(options.nodes ?? []);
  const extra = new Set(options.extra ?? []);
  const inspection = graph.inspect();
  // An assertion is a check, not an output, and not a consumer: an image
  // wired only into assertions is still the graph's final image, and the
  // assertion's pass-through of it is not saved a second time.
  const isAssertion = (moduleId: string) => moduleId.startsWith('cascade.assert.');
  const assertions = new Set(inspection.nodes.filter((node) => isAssertion(node.moduleId)).map((node) => node.id));
  const consumed = new Set(inspection.connections
    .filter((connection) => !assertions.has(connection.target.nodeId))
    .map((connection) => `${connection.source.nodeId}\u0000${connection.source.outputName}`));
  const candidates: { nodeId: string; ports: { name: string; type: string; skip: boolean }[] }[] = [];
  for (const node of inspection.nodes) {
    const named = wanted.has(node.id) || extra.has(node.id);
    if (wanted.size && !named) continue;
    if (!named && assertions.has(node.id)) continue;
    const ports = Object.entries(node.outputs)
      .filter(([, port]) => port.type === 'image' || port.type === 'any')
      .map(([name, port]) => ({
        name,
        type: port.type,
        // Consumed downstream: not a final image, though it still counts
        // towards `shared` when it carries one.
        skip: !named && port.connected && consumed.has(`${node.id}\u0000${name}`),
      }));
    if (ports.length) candidates.push({ nodeId: node.id, ports });
  }
  return {
    collect() {
      const found: ImageOutput[] = [];
      for (const candidate of candidates) {
        const values = graph.getOutputs(candidate.nodeId);
        const ports = candidate.ports
          .map((port) => ({ ...port, value: values.get(port.name) }))
          .filter((port) => port.value !== undefined
            && (port.type === 'image' || looksLikeImage(port.value)));
        for (const port of ports) {
          if (port.skip) continue;
          found.push({ nodeId: candidate.nodeId, port: port.name, value: port.value, shared: ports.length > 1 });
        }
      }
      return found;
    },
  };
}

/** Node ids that `--node`/`--out-node` named and the graph does not have. */
export function unknownNodes(graph: LoadedCascadeGraph, ids: readonly string[]): string[] {
  const known = new Set(graph.inspect().nodes.map((node) => node.id));
  return ids.filter((id) => !known.has(id));
}

const safe = (text: string) => text.replace(/[^a-zA-Z0-9_-]/g, '_');

/** `<node>[.<port>]` for one output. */
export function outputStem(output: Pick<ImageOutput, 'nodeId' | 'port' | 'shared'>): string {
  return output.shared ? `${safe(output.nodeId)}.${safe(output.port)}` : safe(output.nodeId);
}

/** The still's file name: `<node>[.<port>].<ext>`. */
export function stillFileName(output: Pick<ImageOutput, 'nodeId' | 'port' | 'shared'>, source: string): string {
  return `${outputStem(output)}${path.extname(source) || '.png'}`;
}

export interface SavedImage {
  readonly node: string;
  readonly port: string;
  /** Where the node wrote it, absolute. */
  readonly source: string;
  /** The copy in `--out`, when one was asked for: project-relative or absolute, as `--out` was. */
  readonly file?: string;
}

/**
 * A still run's image outputs: listed always, so an agent can open what a run
 * made without searching `.cascade-cache/`, and copied into `out` under
 * readable names when `out` is given.
 */
export async function saveStillImages(
  graph: LoadedCascadeGraph,
  project: { root: string; resolve(relative: string): string; resolveMedia(relative: string): string },
  options: { out?: string; nodes?: readonly string[]; extra?: readonly string[] },
): Promise<SavedImage[]> {
  const missing = unknownNodes(graph, [...(options.nodes ?? []), ...(options.extra ?? [])]);
  if (missing.length) throw new Error(`No node ${missing.map((id) => `"${id}"`).join(', ')} in this graph (--node/--out-node take node ids; cascade graph read lists them).`);
  const outputs = collectImageOutputs(graph, options);
  const out = options.out ? outDirectory(options.out, (relative) => project.resolve(relative)) : undefined;
  if (out) await fs.mkdir(out.directory, { recursive: true });
  const saved: SavedImage[] = [];
  for (const output of outputs) {
    const relative = imagePath(output.value)?.replace(/^\.?\//, '');
    if (!relative) continue;
    const source = path.isAbsolute(relative) ? relative : project.resolveMedia(relative);
    if (!out) {
      saved.push({ node: output.nodeId, port: output.port, source });
      continue;
    }
    const name = stillFileName(output, relative);
    if (path.isAbsolute(relative)) await fs.copyFile(source, path.join(out.directory, name));
    else await copyImageFile(project, relative, path.join(out.directory, name));
    saved.push({ node: output.nodeId, port: output.port, source, file: out.spell(name) });
  }
  if (out && !saved.length) {
    throw new Error('--out: no image output to save. The graph has no unconsumed image port; name one with --node, or a mid-graph one with --out-node.');
  }
  return saved;
}

/**
 * Where `--out` points: an absolute path as given, a relative one inside the
 * project. Returns the directory and how to spell a file in it in the result
 * (project-relative for a relative `--out`, absolute for an absolute one).
 */
export function outDirectory(out: string, resolveInProject: (relative: string) => string): { directory: string; spell: (name: string) => string } {
  if (path.isAbsolute(out)) {
    const directory = path.resolve(out);
    return { directory, spell: (name) => path.join(directory, name) };
  }
  return { directory: resolveInProject(out), spell: (name) => path.posix.join(out.split(path.sep).join('/'), name) };
}
