/**
 * Cook one node of a graph headlessly and return its outputs.
 *
 * The same host `cascade run` installs (project module compiler, the Python
 * stage bridge with its cache keys, project file io, the headless canvas), set
 * up around one cook and taken down after it, so a lock and a replay render the
 * way a headless run does. The graph is passed as a document rather than read
 * from its file, because a replay cooks the graph the lock stored, not whatever
 * the file says today.
 *
 * Every cook leaves a normal run trace (`.cascade/runs/`) in the project named
 * by `traceRoot`: a replay cooks in a throwaway copy, and its trace has to
 * outlive the copy to be opened afterwards.
 */
import path from 'node:path';
import { setEmbeddedCompiler, setProjectModuleCompiler } from '../../engine/nodeModuleLoader.js';
import { compileEmbedded, compileProjectModule } from '../../../server/src/compile.js';
import { ProjectRoot } from '../../../server/src/project.js';
import { cascadeVersion } from '../../../server/src/stageCache.js';
import { graphSeed } from '../../../packages/runtime/src/seed.js';
import { installProjectIo } from '../headlessIo.js';
import { installHeadlessCanvas } from '../headlessCanvas.js';
import { installProjectStages } from '../projectStages.js';
import { cookProjectGraph } from '../projectRuntime.js';
import { RunTrace } from '../runTrace.js';

export interface CookResult {
  readonly outputs: ReadonlyMap<string, unknown>;
  readonly durationMs: number;
  /** The run trace, relative to `traceRoot`, when it could be written. */
  readonly trace?: string;
}

export async function cookNode(
  graphFile: string,
  document: any,
  nodeId: string,
  options: { verbose?: boolean; traceRoot?: string; traceGraph?: string } = {},
): Promise<CookResult> {
  const project = new ProjectRoot(path.dirname(path.resolve(graphFile)));
  const trace = new RunTrace(options.traceGraph ?? path.resolve(graphFile), cascadeVersion(), graphSeed(document));
  setProjectModuleCompiler(async (folder) => (await compileProjectModule(project, folder)).code);
  setEmbeddedCompiler(async (code) => (await compileEmbedded(project, code)).code);
  const removeStages = installProjectStages(project, { verbose: options.verbose, onTrace: (stage) => trace.recordStage(stage) });
  const removeIo = installProjectIo(project);
  // Optional, like in `cascade run`: a graph with no canvas node still cooks
  // on a machine without the renderer.
  const canvas = await installHeadlessCanvas().catch(() => undefined);
  const started = performance.now();
  try {
    const { outputs } = await cookProjectGraph(graphFile, document, nodeId, (graph) => trace.attach(graph));
    const node = outputs.get(nodeId);
    if (!node) throw new Error(`No node "${nodeId}" in the graph`);
    let written: string | undefined;
    try { written = trace.write(options.traceRoot ?? project.root); }
    catch (error) { console.warn(`Could not write the run trace: ${error instanceof Error ? error.message : error}`); }
    return { outputs: node, durationMs: Math.round(performance.now() - started), ...(written ? { trace: written } : {}) };
  } finally {
    removeStages();
    removeIo();
    canvas?.dispose();
    setProjectModuleCompiler(null);
    setEmbeddedCompiler(null);
  }
}
