import * as fs from 'fs/promises';
import * as path from 'path';
import { checkProjectGraph, inspectProjectGraph, renderDeterministicProjectFrames, runDeterministicProjectGraph, validateProjectGraph } from './projectRuntime.js';
import { setEmbeddedCompiler, setProjectModuleCompiler } from '../engine/nodeModuleLoader.js';
import { compileEmbedded, compileProjectModule } from '../../server/src/compile.js';
import { ProjectRoot } from '../../server/src/project.js';
import { runProjectStage } from '../../server/src/stageRunner.js';
import { installStageBridge } from '../../server/src/runtime/stage.js';
import { installProjectIo } from './headlessIo.js';
import { installHeadlessCanvas, MISSING_CANVAS_MESSAGE, type CanvasHost } from './headlessCanvas.js';
import { parseFrameSpec } from './frames.js';
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
  /** Sequence directory, project-relative. Default `renders/`. */
  out?: string;
  json?: boolean;
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
  try {
    project = new ProjectRoot(path.dirname(path.resolve(file)));
    setProjectModuleCompiler(async (folderName) => (await compileProjectModule(project!, folderName)).code);
    setEmbeddedCompiler(async (code) => (await compileEmbedded(project!, code)).code);
    // A node importing `cascade/stage` posts to the server in the page and
    // calls this in a headless run, so one Python-backed node renders either way.
    disposeStageBridge = installStageBridge((stage, args) => runProjectStage(project!, stage, args, {
      /**
       * A stage can log, and until now nobody could read it.
       *
       * `stderr` was consulted only when a stage failed and `stdout` only for
       * its last line, so anything a stage printed on a successful run was
       * dropped — while `runProjectStage`'s own comment says logging on the way
       * through is supported. The case that exposed it: a diagnostic added to
       * explain an invisible cache hit, which was itself invisible.
       *
       * Behind `--verbose` rather than on by default, because a stage that
       * prints per mark would bury the render it is part of. Prefixed with the
       * stage name, because a graph runs several and an unattributed line is
       * only slightly better than no line.
       */
      onOutput: verbose
        ? (stream, text) => {
            const write = stream === 'stderr' ? console.warn : console.log;
            for (const line of text.split('\n')) write(`[${stage}] ${line}`);
          }
        : undefined,
    }));
    // And the same for files: `cascade/io` reads and writes over `/api/media`
    // in the page and against the directory here, so a node that saves an image
    // works under both hosts without knowing which it has.
    disposeIoBridge = installProjectIo(project);
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

  const frameSpec = frames ? parseFrameSpec(frames) : null;

  let hostReleased = false;
  const releaseHost = () => {
    if (hostReleased) return;
    hostReleased = true;
    const errors: unknown[] = [];
    for (const dispose of [
      disposeStageBridge,
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
      ...(verbose ? { verbose } : {}),
    });
    if (rendered) {
      releaseHost();
      if (options.json) process.stdout.write(JSON.stringify({ status: 'completed', graph: path.resolve(file), ...rendered }) + '\n');
      else console.log(`Rendered ${rendered.frames.length} frames, ${rendered.files.length} files -> ${out ?? 'renders'}/`);
      return;
    }
    if (options.json) throw new Error('--json rendering requires a fully definition-v1 graph');
  } else if (await runDeterministicProjectGraph(file, graphData, nodes?.[0] ?? entryNode)) {
    if (verbose) console.log('Graph execution completed');
    releaseHost();
    return;
  }
  } catch (error) {
    releaseHost();
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
