/**
 * Rendering a frame range offline.
 *
 * `runFrameRange` has always been able to walk a range — set the frame, dirty
 * the time-dependent nodes, hand the frame back — and deliberately writes no
 * files: frames are produced where the canvas is. Offline the canvas is now
 * here, so this is the part that was missing: cook each frame and put the
 * result on disk as a numbered sequence.
 *
 * It stops at the sequence. Handing the frames to ffmpeg is a separate decision
 * with its own dependency, and a directory of numbered PNGs is the input every
 * encoder already takes.
 *
 * The naming contract is one rule rather than two, because a graph with three
 * outputs is the normal case here — the FIELD.IO mark renders at 1024, 128 and
 * 32 from one cook — and a rule that changes shape when there is exactly one
 * output is a rule nobody can script against:
 *
 *     <out>/<node id>.<frame, 4 digits>.<ext>
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Graph } from '../nodes/Graph.js';
import type { Node } from '../nodes/Node.js';
import type { ProjectRoot } from '../../server/src/project.js';
import { cascade } from '../engine/cascade.js';
import { evaluateFrameRange } from '../engine/animation/frameRange.js';
import { imagePath, sequenceFileName, sequenceWidth } from './sequence.js';

export interface FrameSpec {
  start: number;
  end: number;
  step?: number;
}

/**
 * `--frames 1-100`, `--frames 1-100x2` (step), or `--frames 42` for one frame.
 *
 * Rejects rather than repairs: a range typed wrongly should say so before a
 * hundred cooks, not after.
 */
export function parseFrameSpec(spec: string): FrameSpec {
  const text = String(spec ?? '').trim();
  const match = /^(-?\d+(?:\.\d+)?)(?:\s*[-:]\s*(-?\d+(?:\.\d+)?))?(?:\s*x\s*(\d+(?:\.\d+)?))?$/i.exec(text);
  if (!match) {
    throw new Error(`--frames expects a range like 1-100, 1-100x2, or a single frame like 42 (got "${spec}")`);
  }
  const start = Number(match[1]);
  const end = match[2] === undefined ? start : Number(match[2]);
  const step = match[3] === undefined ? undefined : Number(match[3]);
  if (end < start) throw new Error(`--frames: end (${end}) must not be before start (${start})`);
  if (step !== undefined && !(step > 0)) throw new Error(`--frames: step must be greater than 0 (got ${step})`);
  return step === undefined ? { start, end } : { start, end, step };
}

/** The image outputs a frame should be saved from: an explicit entry node's,
 *  or every image output nothing downstream consumes. */
export function outputPorts(graph: Graph, entryNode?: Node): { node: Node; port: { name: string; value: unknown } }[] {
  const nodes = entryNode ? [entryNode] : graph.nodes;
  const found: { node: Node; port: { name: string; value: unknown } }[] = [];
  for (const node of nodes) {
    for (const port of node.outputs) {
      if (port.dataType !== 'image') continue;
      if (!entryNode && port.connections.length > 0) continue;   // consumed downstream
      found.push({ node, port });
    }
  }
  return found;
}

/** Every output value in the graph, as a comparable string. */
function outputSnapshot(graph: Graph): string {
  return JSON.stringify(graph.nodes.map((node) => [node.id, node.outputs.map((port) => port.value ?? null)]));
}

/**
 * Cook the graph until it stops changing.
 *
 * `graph.execute()` returns when the flush it started finishes, and one flush
 * is not always one full render. A node that has never cooked is nonetheless
 * 'clean' — it "ran" during port discovery with nothing on its inputs and
 * returned early — so the first real cook of a chain can read an upstream value
 * that arrived in the same pass, and produce nothing. The FIELD.IO graph showed
 * it exactly: frame 1 came out with no distort file at all while every later
 * frame was right, because by then the chain had cooked once.
 *
 * So the first frame runs to a fixpoint — cook until the outputs stop moving —
 * and every frame after it takes the cheap path, since an incremental cook of
 * an already-warm graph is what the scheduler is good at. A render that is
 * silently one frame behind is the worst outcome available here, and it is not
 * visible in any output; the extra pass on frame 1 is the price of not risking
 * it.
 */
export async function cookUntilSettled(
  graph: Graph,
  entryNode: Node | undefined,
  options: { fixpoint?: boolean; passes?: number } = {},
): Promise<void> {
  const { fixpoint = false, passes = 8 } = options;
  const dirtyAll = () => { for (const node of graph.nodes) node.markDirty?.(); };
  let previous = fixpoint ? outputSnapshot(graph) : null;

  for (let pass = 0; pass < passes; pass++) {
    await graph.execute(entryNode);
    await graph.scheduler?.whenIdle?.();

    // A failed cook is not something more passes will fix, and re-cooking a
    // graph whose nodes all need a canvas this host does not have prints the
    // same error eight times over the one line that says what to install.
    if (graph.nodes.some((node) => node.error !== null)) return;

    const stale = graph.nodes.some((node) => node.cookState === 'stale' || node.cookState === 'queued');
    if (!fixpoint) {
      if (!stale) return;
      continue;
    }

    const snapshot = outputSnapshot(graph);
    const settled = !stale && snapshot === previous;
    previous = snapshot;
    if (settled) return;
    dirtyAll();
  }

  throw new Error(`graph did not settle after ${passes} cook passes`);
}

export interface RenderFrameRangeOptions extends FrameSpec {
  graph: Graph;
  project: ProjectRoot;
  /** Directory for the sequence, resolved against the project root. */
  out: string;
  fps?: number;
  entryNode?: Node;
  verbose?: boolean;
  signal?: { readonly aborted: boolean };
}

export interface RenderFrameRangeResult {
  frames: number[];
  /** Written files, project-relative, in the order they were written. */
  files: string[];
  aborted: boolean;
}

/**
 * Cook the graph once per frame and copy each image output into the sequence
 * directory.
 *
 * A copy rather than a re-encode on purpose: the node already wrote exactly the
 * pixels it meant to, and the cache path it wrote them to is content-addressed,
 * so a frame that did not change costs a copy and never a second render.
 */
export async function renderFrameRange(options: RenderFrameRangeOptions): Promise<RenderFrameRangeResult> {
  const { graph, project, out, start, end, step, fps, entryNode, verbose, signal } = options;

  cascade.setGraph(graph);
  const outDirectory = project.resolve(out);
  await fs.mkdir(outDirectory, { recursive: true });

  const files: string[] = [];
  const width = sequenceWidth(end);

  const result = await evaluateFrameRange({
    start,
    end,
    step,
    fps,
    signal,
    onFrame: async ({ frame, index, total }) => {
      if (index === 0) for (const node of graph.nodes) node.markDirty();
      await cookUntilSettled(graph, entryNode, { fixpoint: index === 0 });

      const failed = graph.nodes.filter((node) => node.error !== null);
      if (failed.length) {
        const detail = failed.map((node) => `${node.id}: ${node.error?.message ?? 'unknown cook error'}`).join('; ');
        throw new Error(`frame ${frame} failed — ${detail}`);
      }

      const ports = outputPorts(graph, entryNode);
      if (!ports.length) {
        throw new Error(
          'No image output to save: the graph has no unconsumed image port. ' +
          'Name the node to render with --entry-node.',
        );
      }

      for (const { node, port } of ports) {
        const source = imagePath(port.value);
        if (!source) continue;
        const name = sequenceFileName(node.id, frame, source, width);
        await fs.copyFile(project.resolveMedia(source), path.join(outDirectory, name));
        files.push(path.posix.join(out, name));
      }

      if (verbose) console.log(`  frame ${frame} (${index + 1}/${total})`);
    },
  });

  return { frames: result.frames, files, aborted: result.aborted };
}
