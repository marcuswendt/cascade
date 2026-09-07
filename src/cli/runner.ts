import { Graph } from '../nodes/Graph.js';
import { Node } from '../nodes/Node.js';
import { AssetManager } from '../engine/AssetManager.js';
import { NodeAssetLoader } from '../engine/NodeAssetLoader.js';
import { PackageManager } from '../engine/PackageManager.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { checkProjectGraph, inspectProjectGraph, runDeterministicProjectGraph, validateProjectGraph } from './projectRuntime.js';
import { setEmbeddedCompiler, setProjectModuleCompiler } from '../engine/nodeModuleLoader.js';
import { compileEmbedded, compileProjectModule } from '../../server/src/compile.js';
import { ProjectRoot } from '../../server/src/project.js';
import { runProjectStage } from '../../server/src/stageRunner.js';
import { installStageBridge } from '../../server/src/runtime/stage.js';
import { installProjectIo } from './headlessIo.js';
import { installHeadlessCanvas, MISSING_CANVAS_MESSAGE, type CanvasHost } from './headlessCanvas.js';
import { cookUntilSettled, parseFrameSpec, renderFrameRange } from './frames.js';

export interface RunOptions {
  file: string;
  entryNode?: string;
  validateOnly?: boolean;
  checkOnly?: boolean;
  inspectOnly?: boolean;
  verbose?: boolean;
  /** `--frames 1-100`, `1-100x2`, or a single frame. Renders a sequence. */
  frames?: string;
  /** Frame rate to evaluate the range at. Leaves the graph's own rate alone when absent. */
  fps?: number;
  /** Sequence directory, project-relative. Default `renders/`. */
  out?: string;
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
  const { file, entryNode, validateOnly, checkOnly, inspectOnly, verbose, frames, fps, out } = options;

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
  const assetLoader = new NodeAssetLoader(fs);
  const assetManager = new AssetManager(projectRoot, assetLoader);
  const packageManager = new PackageManager();

  if (validateOnly || checkOnly) {
    if (checkOnly) await checkProjectGraph(file, graphData);
    else await validateProjectGraph(file, graphData);
    console.log(checkOnly ? 'Static check passed!' : 'Graph validation passed!');
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
    disposeStageBridge = installStageBridge((stage, args) => runProjectStage(project!, stage, args));
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

  const releaseHost = () => {
    disposeStageBridge?.();
    disposeIoBridge?.();
    canvasHost?.dispose();
  };

  if (frameSpec) {
    // A definition-v1 graph runs through the deterministic runtime, which owns
    // its own clock and is not reachable from here. Say that, rather than
    // silently rendering frame 1 a hundred times.
    const summary = await inspectProjectGraph(file, graphData);
    if (summary.deterministic) {
      releaseHost();
      console.error('--frames renders dynamic graphs; this graph is definition-v1 and runs through the deterministic runtime.');
      process.exit(1);
    }
  } else if (await runDeterministicProjectGraph(file, graphData, entryNode)) {
    if (verbose) console.log('Graph execution completed');
    releaseHost();
    return;
  }

  // A dynamic graph reaches here, and until now it died trying to fetch its
  // modules from `/api/nodes/...` — a relative URL, with no server behind it and
  // no origin to resolve it against. Compiling them in-process with the same
  // esbuild pass the server uses is what makes `cascade run` work on the graphs
  // people actually have, rather than only on fully migrated ones.

  // Held outside the try so the finally can stop the scheduler before the host
  // goes away. A debounced re-cook that fires after the canvas globals are
  // removed prints "OffscreenCanvas is not defined" underneath a run that
  // already succeeded, which reads like a failed render and is not one.
  let activeGraph: Graph | undefined;

  try {
    // Create graph from JSON
    let graph: Graph;
    try {
      graph = Graph.fromJSON(graphData, assetManager, packageManager);
    } catch (error: any) {
      console.error(`Failed to create graph: ${error.message}`);
      process.exit(1);
    }

    activeGraph = graph;

    // Ports should already be restored from JSON metadata (if available)
    // Only execute computations if ports weren't restored from metadata
    // This avoids unnecessary execution just for port discovery
    const nodesNeedingExecution: Node[] = [];
    for (const element of graph.elements.filter(e => !(e as any).isAnnotation)) {
      const node = element as Node;
      // Check if computation has ports (restored from metadata)
      // If not, we may need to execute to create them
      const hasPorts = node.inputs.length > 0 || node.outputs.length > 0;
      // Gate on the source as well as on node.code, for the same reason
      // Graph.fromJSON does: a project module's code lives on disk, so node.code
      // is empty for it. Checking only node.code meant no project node was ever
      // initialised headlessly, so no ports existed, so no connections could be
      // restored — and every graph "completed" while doing nothing at all.
      const isProject = (node as any).sourceType === 'project'
        || String((node as any).modulePath ?? '').startsWith('project.');
      if (!hasPorts && (node.code || isProject)) {
        nodesNeedingExecution.push(node);
      }
    }

    // Only execute nodes that don't have ports from metadata
    for (const node of nodesNeedingExecution) {
      try {
        // Execute to initialize ports and props
        // The node's execute() method handles initialization properly
        // Suppress browser API errors in Node.js environment
        await node.execute();
      } catch (err: any) {
        // Ignore execution errors during initialization - they'll be caught during actual execution
        // Browser API errors (like document is not defined) are expected in CLI for browser-only nodes
        const errMsg = err.message || String(err);
        const isBrowserAPIError =
          errMsg.includes('document is not defined') ||
          errMsg.includes('window is not defined') ||
          errMsg.includes('HTMLCanvasElement') ||
          errMsg.includes('HTMLImageElement');

        if (verbose && !isBrowserAPIError) {
          console.warn(`Warning: Node ${node.id} failed to initialize: ${errMsg}`);
        }
        // Browser API errors are expected and can be ignored - these nodes are designed for browser execution
      }
    }

    // Restore connections now that ports exist (either from metadata or execution)
    graph.restoreConnections();

    // Validate graph (now that ports and connections exist)
    const validation = graph.validate();

    if (validation.errors.length > 0) {
      console.error('Graph validation failed:');
      validation.errors.forEach(error => {
        console.error(`  - ${error.type}: ${error.message}`);
        if (error.nodeIds) {
          console.error(`    Nodes: ${error.nodeIds.join(', ')}`);
        }
      });
      process.exit(1);
    }

    if (validation.warnings.length > 0) {
      console.warn('Graph validation warnings:');
      validation.warnings.forEach(warning => {
        console.warn(`  - ${warning.type}: ${warning.message}`);
      });
    }

    if (verbose) {
      const nodeCount = graph.elements.filter(e => !(e as any).isAnnotation).length;
      console.log(`Graph loaded: ${nodeCount} nodes, ${graph.connections.length} connections`);
    }

    // Execute graph
    try {
      if (frameSpec) {
        if (!project) throw new Error('A frame range needs a project directory around the graph file');
        const entry = entryNode ? graph.getNode(entryNode) ?? undefined : undefined;
        if (entryNode && !entry) {
          console.error(`Entry node not found: ${entryNode}`);
          process.exit(1);
        }
        const rendered = await renderFrameRange({
          graph,
          project,
          entryNode: entry,
          out: out ?? 'renders',
          fps,
          ...frameSpec,
          verbose,
        });
        console.log(`Rendered ${rendered.frames.length} frames, ${rendered.files.length} files -> ${out ?? 'renders'}/`);
      } else if (entryNode) {
        const node = graph.getNode(entryNode);
        if (!node) {
          console.error(`Entry node not found: ${entryNode}`);
          process.exit(1);
        }
        if (verbose) {
          console.log(`Executing from entry node: ${entryNode}`);
        }
        await cookUntilSettled(graph, node, { fixpoint: true });
      } else {
        if (verbose) {
          console.log('Executing all entry points...');
        }
        await cookUntilSettled(graph, undefined, { fixpoint: true });
      }

      const failedNodes = graph.nodes.filter(node => node.error !== null);
      if (failedNodes.length > 0) {
        console.error('Graph execution failed:');
        const messages = failedNodes.map(node => node.error?.message ?? 'Unknown cook error');
        failedNodes.forEach((node, index) => console.error(`  - node/cook-failed [${node.id}]: ${messages[index]}`));
        reportMissingCanvas(messages, canvasError);
        process.exit(1);
      }

      if (verbose) {
        console.log('Graph execution completed');
      }
    } catch (error: any) {
      console.error(`Graph execution failed: ${error.message}`);
      reportMissingCanvas([String(error.message)], canvasError);
      if (verbose && error.stack) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  } finally {
    activeGraph?.scheduler?.dispose?.();
    releaseHost();
    setProjectModuleCompiler(null);
    setEmbeddedCompiler(null);
  }
}
