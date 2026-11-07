import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'node:fs';
import { checkProjectGraph, inspectProjectGraph, renderDeterministicProjectFrames, runDeterministicProjectGraph, validateProjectGraph } from './projectRuntime.js';
import { setEmbeddedCompiler, setProjectModuleCompiler } from '../engine/nodeModuleLoader.js';
import { compileEmbedded, compileProjectModule } from '../../server/src/compile.js';
import { ProjectRoot } from '../../server/src/project.js';
import { cascadeVersion, formatStageTrace } from '../../server/src/stageCache.js';
import { graphSeed } from '../../packages/runtime/src/seed.js';
import { installProjectStages } from './projectStages.js';
import { captureNodeConsole, RunTrace } from './runTrace.js';
import { applyEnv } from './runEnv.js';
import { installProjectIo } from './headlessIo.js';
import { installHeadlessCanvas, MISSING_CANVAS_MESSAGE, type CanvasHost } from './headlessCanvas.js';
import { parseFrameSpec } from './frames.js';
import { frameRange } from '../../packages/runtime/src/animation/index.js';
import type { RenderedFrame } from './projectRuntime.js';
import { encodeMp4, timelineFrameSpec } from './encode.js';
import { saveStillImages, type SavedImage } from './imageOutputs.js';
/**
 * The class-based standard library used to be registered here, because the
 * dynamic executor built a Studio `Graph` and needed the class registry to
 * resolve `cascade.image.*`. With that executor gone nothing in the CLI reads
 * the registry, and esbuild proved it: the bundled CLI no longer contains
 * `cascade.image.Color` at all.
 *
 * Removed rather than left as a harmless call. A registration nobody reads is
 * an invitation to assume the CLI has a class path when it does not.
 */

export interface RunOptions {
  file: string;
  entryNode?: string;
  /**
   * `--node <id>`, repeatable: which output nodes to render.
   *
   * Marcus asked for it on 2026-09-12 — *"a simple flag to cascade run batch
   * scripts to define the target node it wants to render; this will be a
   * common use-case"* — and he is right that it is common. It is what makes one
   * document with several layout variants affordable: without it `cascade run`
   * renders every unconsumed image output, so a four-wall document is four
   * full renders per invocation.
   *
   * `--entry-node` did most of this already and was unfindable, because "entry
   * node" reads as *start here* rather than *render this*. Same plumbing, a
   * name somebody would look for, and now repeatable.
   */
  nodes?: readonly string[];
  /** `--out-node <id>`, repeatable: also save these (usually mid-graph) nodes' image outputs. */
  outNodes?: readonly string[];
  /** `--env NAME=value`, repeatable: set for the run, so Python stages and workers see it. */
  env?: Readonly<Record<string, string>>;
  validateOnly?: boolean;
  checkOnly?: boolean;
  inspectOnly?: boolean;
  /**
   * Turn the missing-module warning into a failure.
   *
   * Off by default while the dynamic path exists, because an unconverted sketch
   * has to keep validating — working in mixed graphs all day is what converting
   * them means. On, a module with no file fails the command, which is what a CI
   * job or anyone who has finished converting wants. The default flips when the
   * dynamic path is deleted.
   */
  strict?: boolean;
  verbose?: boolean;
  /** `--frames 1-100`, `1-100x2`, or a single frame. Renders a sequence. */
  frames?: string;
  /** Frame rate to evaluate the range at. Leaves the graph's own rate alone when absent. */
  fps?: number;
  /**
   * Where to save image outputs: project-relative, or absolute. With
   * `--frames` the sequence directory (default `renders/`); without, the
   * still's outputs are copied here as `<node>[.<port>].<ext>`.
   */
  out?: string;
  json?: boolean;
  /** `--seed N`: cook with this graph seed instead of the document's. */
  seed?: number;
  /** `--fresh`: with `--frames`, cook every node on every frame. */
  fresh?: boolean;
  /** `--mp4 <file>`, project-relative: encode the sequence as H.264 after rendering it. */
  mp4?: string;
  /** `--crf <n>` for `--mp4`. */
  crf?: number;
  /**
   * Set when this process is one of `cascade render --workers`: frames come
   * from the coordinator rather than the range, each finished frame is
   * reported back, and the summary line, the run trace and any encode are the
   * coordinator's to do once, not every worker's.
   */
  worker?: {
    frameSource: AsyncIterable<number>;
    onFrame: (frame: RenderedFrame) => void | Promise<void>;
  };
}

/** From this many frames `run --frames` names `cascade render`. */
export const RENDER_SUGGESTION_FRAMES = 30;

/**
 * `run --frames` cooks one frame at a time in one process; `cascade render`
 * spreads the range over worker processes (2.3 against 0.8 fps on the morph,
 * round 2). A long range gets one line saying so, before it starts.
 */
export function renderSuggestion(file: string, frames: string, count: number): string | null {
  if (count < RENDER_SUGGESTION_FRAMES) return null;
  return `${count} frames in one process. cascade render ${file} --frames ${frames} renders them across worker processes `
    + '(and encodes a preview mp4; --no-video for frames only).';
}

/**
 * A drawing failure in a Node process that has no canvas reads as
 * `OffscreenCanvas is not defined` — which sounds like a broken node and is
 * really a missing renderer. When the optional renderer failed to load, say so
 * instead.
 */
function looksLikeCanvasFailure(message: string): boolean {
  return /OffscreenCanvas|createImageBitmap|ImageData|Path2D|DOMMatrix|getContext|createRadialGradient/.test(message);
}

/** Print the install sentence once, under everything else — never once per
 *  failed node, which is how a four-node graph produced it four times. */
function reportMissingCanvas(messages: string[], canvasError: Error | null): void {
  if (canvasError && messages.some(looksLikeCanvasFailure)) console.error(`\n${MISSING_CANVAS_MESSAGE}`);
}

export async function runGraph(options: RunOptions): Promise<void> {
  const { file, entryNode, nodes, validateOnly, checkOnly, inspectOnly, strict, verbose, frames, fps, out } = options;

  if (verbose) {
    console.log(`Loading graph from: ${file}`);
  }

  // Read and parse graph file
  let graphData: any;
  try {
    const filePath = path.resolve(file);
    const content = await fs.readFile(filePath, 'utf-8');
    graphData = JSON.parse(content);
    if (options.seed !== undefined) graphData.seed = options.seed;
  } catch (error: any) {
    console.error(`Failed to load graph file: ${error.message}`);
    process.exit(1);
  }

  // Create environment-specific managers
  const projectRoot = path.dirname(path.resolve(file));

  if (validateOnly || checkOnly) {
    const unresolved = checkOnly
      ? await checkProjectGraph(file, graphData, strict)
      : await validateProjectGraph(file, graphData, strict);
    /**
     * Say what passed, not just that something did.
     *
     * An unqualified "passed" printed directly under a list of modules with no
     * file is the thing that made a typo and a legacy node indistinguishable —
     * the warning was there and the conclusion contradicted it.
     */
    const headline = checkOnly ? 'Static check passed' : 'Graph validation passed';
    console.log(
      unresolved > 0
        ? `${headline} with ${unresolved} unresolved ${unresolved === 1 ? 'module' : 'modules'} — run with --strict to fail on these`
        : `${headline}!`,
    );
    return;
  }

  if (inspectOnly) {
    console.log(JSON.stringify(await inspectProjectGraph(file, graphData), null, 2));
    return;
  }

  // Project context first, and before either execution path. This used to sit
  // below the deterministic branch, which meant a definition-v1 node importing
  // `cascade/stage` failed headlessly with "no host bridge is installed" while
  // the legacy dynamic path — reached twenty lines further down, after the
  // install — rendered fine. The preferred node style was the one that could
  // not render offline.
  //
  // Best effort: a .cascade file can sit outside a project directory, and such
  // a graph should still run whatever it carries inline rather than failing on
  // a project that is not there.
  let disposeStageBridge: (() => void) | undefined;
  let disposeIoBridge: (() => void) | undefined;
  let canvasHost: CanvasHost | undefined;
  let canvasError: Error | null = null;
  let project: ProjectRoot | undefined;
  /**
   * The run trace: each node's timing and every stage call's cache key and
   * state, written to `.cascade/runs/` so a headless run can be read after
   * the fact. `--verbose` prints each stage call as it happens.
   */
  const trace = new RunTrace(path.resolve(file), cascadeVersion(), graphSeed(graphData));
  const observe = (graph: Parameters<RunTrace['attach']>[0]) => trace.attach(graph);
  const writeTrace = (): string | undefined => {
    // Beside a graph that is really on disk, never into a directory that
    // merely contains the path somebody named.
    if (!project || !existsSync(path.resolve(file))) return undefined;
    try { return trace.write(project.root); }
    catch (error) {
      console.warn(`Could not write the run trace: ${error instanceof Error ? error.message : error}`);
      return undefined;
    }
  };
  try {
    project = new ProjectRoot(path.dirname(path.resolve(file)));
    setProjectModuleCompiler(async (folderName) => (await compileProjectModule(project!, folderName)).code);
    setEmbeddedCompiler(async (code) => (await compileEmbedded(project!, code)).code);
    // A node importing `cascade/stage` posts to the server in the page and
    // calls this in a headless run, so one Python-backed node renders either way.
    disposeStageBridge = installProjectStages(project, {
      verbose,
      // A render worker starts Python while the probe frames run.
      prewarm: Boolean(options.worker),
      onTrace: (stage) => {
        trace.recordStage(stage);
        if (verbose) console.log(`[stage] ${formatStageTrace(stage)}`);
      },
      // What a stage prints goes into the trace against the node that called
      // it, always; on the terminal too with --verbose (the console capture
      // below records that copy, so it is not recorded twice).
      onOutput: (stage, stream, line) => {
        const text = `[${stage ?? 'stage-worker'}] ${line}`;
        if (verbose) (stream === 'stderr' ? console.warn : console.log)(text);
        else trace.recordLog(stream, text);
      },
    });
    // And the same for files: `cascade/io` reads and writes over `/api/media`
    // in the page and against the directory here, so a node that saves an image
    // works under both hosts without knowing which it has. Resident: an image
    // passed between nodes stays in memory and its file is written behind,
    // so the next node skips the encode, the write, the read and the decode.
    disposeIoBridge = installProjectIo(project, { resident: true });
  } catch (error) {
    if (verbose) console.warn(`No project context for ${file}: ${error instanceof Error ? error.message : error}`);
  }

  // Web technology is the default renderer, so the headless host needs a canvas
  // before anything cooks. Optional dependency, deliberately: a graph with no
  // canvas node in it still runs on a machine that never installed it, and one
  // that needs pixels gets a sentence naming what to install.
  try {
    canvasHost = await installHeadlessCanvas();
    if (verbose) console.log(`Canvas: ${canvasHost.renderer}`);
  } catch (error) {
    canvasError = error instanceof Error ? error : new Error(String(error));
    if (verbose) console.warn(canvasError.message);
  }

  // `--frames timeline` is the range saved with the graph.
  const frameSpec = frames ? (frames === 'timeline' ? timelineFrameSpec(graphData) : parseFrameSpec(frames)) : null;
  if (frameSpec && frames && !options.worker) {
    const hint = renderSuggestion(file, frames, frameRange(frameSpec.start, frameSpec.end, frameSpec.step ?? 1).length);
    // Under --json stdout is the result; the hint goes with the warnings.
    if (hint) (options.json ? console.error : console.log)(hint);
  }

  // What nodes print while they cook goes into the trace as well.
  const restoreConsole = captureNodeConsole(trace);
  // `--env KEY=VALUE`: for this run's stages and workers, without a shell
  // prefix (which agent shells often refuse). Names go in the trace, values never.
  const restoreEnv = applyEnv(options.env);
  if (options.env) trace.setEnvNames(Object.keys(options.env));

  let hostReleased = false;
  const releaseHost = () => {
    if (hostReleased) return;
    hostReleased = true;
    const errors: unknown[] = [];
    for (const dispose of [
      restoreConsole,
      disposeStageBridge,
      restoreEnv,
      disposeIoBridge,
      canvasHost ? () => canvasHost.dispose() : undefined,
      () => setProjectModuleCompiler(null),
      () => setEmbeddedCompiler(null),
    ]) {
      try { dispose?.(); }
      catch (error) { errors.push(error); }
    }
    if (errors.length) throw errors[0];
  };

  try {
  if (frameSpec) {
    // A definition-v1 graph renders its sequence through the deterministic
    // runtime, which resolves each bound parameter at the frame the run states.
    // This used to refuse outright — "--frames renders dynamic graphs" — which
    // left the preferred node style as the one that could not be animated
    // offline. Returns null for a dynamic graph, which falls through below.
    const rendered = await renderDeterministicProjectFrames(file, graphData, {
      ...frameSpec,
      ...(fps === undefined ? {} : { fps }),
      out: out ?? 'renders',
      ...(entryNode ? { entryNode } : {}),
      ...(nodes?.length ? { nodes } : {}),
      ...(options.outNodes?.length ? { outNodes: options.outNodes } : {}),
      ...(verbose ? { verbose } : {}),
      ...(options.fresh ? { fresh: true } : {}),
      ...(options.worker ? { frameSource: options.worker.frameSource, onFrame: options.worker.onFrame } : {}),
      observe,
    });
    if (rendered && options.worker) {
      releaseHost();
      return;
    }
    if (rendered) {
      releaseHost();
      const tracePath = writeTrace();
      const video = options.mp4 && !rendered.aborted
        ? await encodeMp4({ root: projectRoot, files: rendered.files, frames: rendered.frames, fps: rendered.fps, file: options.mp4, ...(options.crf === undefined ? {} : { crf: options.crf }) })
        : undefined;
      if (options.json) {
        process.stdout.write(JSON.stringify({
          status: 'completed',
          graph: path.resolve(file),
          ...rendered,
          ...(video ? { video } : {}),
          seed: graphSeed(graphData),
          ...(tracePath ? { trace: tracePath } : {}),
          stages: trace.stages(),
          logs: trace.logs(),
        }) + '\n');
      }
      else {
        console.log(`Rendered ${rendered.frames.length} frames, ${rendered.files.length} files -> ${out ?? 'renders'}/`);
        if (video) console.log(`Encoded ${video.file} (H.264 yuv420p, crf ${video.crf}, ${video.fps} fps)`);
      }
      return;
    }
    if (options.json) throw new Error('--json rendering requires a fully definition-v1 graph');
  } else {
    const started = performance.now();
    let images: SavedImage[] = [];
    // One named node narrows the cook to it; a mid-graph `--out-node` beside
    // it may not be upstream, so then the whole graph cooks.
    const target = options.outNodes?.length || (nodes?.length ?? 0) > 1 ? undefined : nodes?.[0] ?? entryNode;
    const saveImages = async (graph: Parameters<typeof saveStillImages>[0]) => {
      if (!project) return;
      images = await saveStillImages(graph, project, {
        ...(out ? { out } : {}),
        ...(nodes?.length ? { nodes } : entryNode ? { nodes: [entryNode] } : {}),
        ...(options.outNodes?.length ? { extra: options.outNodes } : {}),
      });
    };
    if (await runDeterministicProjectGraph(file, graphData, target, observe, saveImages)) {
      if (verbose) console.log('Graph execution completed');
      releaseHost();
      const tracePath = writeTrace();
      if (options.json) {
        process.stdout.write(JSON.stringify({
          status: 'completed',
          graph: path.resolve(file),
          durationMs: performance.now() - started,
          seed: graphSeed(graphData),
          images,
          ...(out ? { files: images.map((image) => image.file) } : {}),
          ...(tracePath ? { trace: tracePath } : {}),
          stages: trace.stages(),
          logs: trace.logs(),
        }) + '\n');
      } else if (out) {
        console.log(`Saved ${images.length} ${images.length === 1 ? 'image' : 'images'} -> ${out}/`);
      }
      return;
    }
  }
  } catch (error) {
    releaseHost();
    // A failed run is the one whose trace is most wanted: what each node
    // printed before it failed. Its path goes on the error.
    const tracePath = options.worker ? undefined : writeTrace();
    if (tracePath && error instanceof Error) error.message += `\nRun trace: ${tracePath}`;
    throw error;
  }

  /**
   * Nothing reaches here any more, and that is the point.
   *
   * This was the dynamic path: a second executor that built a Studio `Graph`
   * in the CLI, compiled each node's TypeScript with esbuild and cooked it
   * through the class-based scheduler — about a hundred and sixty lines of
   * second implementation, reached whenever the deterministic runtime declined
   * a graph.
   *
   * Deleted 2026-09-12 on Marcus's confirmation, and on a measurement rather
   * than on a grep. MW-OBSERVATORY-ART ran `check` and a headless
   * `run --frames 1` over all nine graphs in six sketches: every one of them
   * either renders through the deterministic runtime or is refused by the
   * runtime's own `runtime/preflight-environment` for declaring
   * `runsOn: 'browser'`. Seventy-two nodes, none dynamic. The one risk worth
   * checking was whether the preflight refusal lived in this branch — it does
   * not; it is raised in `packages/runtime/src/runtime.ts`, so the two sketches
   * that cannot render headlessly keep exactly the message they had.
   *
   * What replaces it is a sentence. A graph the deterministic runtime declines
   * is one with no definition-v1 nodes in it, and saying so is more useful than
   * running it through an executor whose behaviour differed from the one every
   * other surface uses.
   */
  releaseHost();
  throw new Error(
    `${path.resolve(file)} has no definition-v1 nodes, and the dynamic executor was removed in 0.7. `
    + 'Every node needs a static `export const definition` — see doc/NODE_AUTHORING.md.',
  );
}
