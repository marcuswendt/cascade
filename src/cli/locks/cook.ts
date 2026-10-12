/**
 * Cook one node of a graph headlessly and return its outputs.
 *
 * The same host `cascade run` installs (project module compiler, the Python
 * stage bridge, project file io, the headless canvas), set up around one cook
 * and taken down after it, so a lock and a replay render the way a headless
 * run does. The graph is passed as a document rather than read from its file,
 * because a replay cooks the graph the lock stored, not whatever the file says
 * today.
 */
import path from 'node:path';
import { setEmbeddedCompiler, setProjectModuleCompiler } from '../../engine/nodeModuleLoader.js';
import { compileEmbedded, compileProjectModule } from '../../../server/src/compile.js';
import { ProjectRoot } from '../../../server/src/project.js';
import { runProjectStage } from '../../../server/src/stageRunner.js';
import { installStageBridge } from '../../../server/src/runtime/stage.js';
import { installProjectIo } from '../headlessIo.js';
import { installHeadlessCanvas } from '../headlessCanvas.js';
import { cookProjectGraph } from '../projectRuntime.js';

export interface CookResult {
  readonly outputs: ReadonlyMap<string, unknown>;
  readonly durationMs: number;
}

export async function cookNode(
  graphFile: string,
  document: unknown,
  nodeId: string,
  options: { verbose?: boolean } = {},
): Promise<CookResult> {
  const project = new ProjectRoot(path.dirname(path.resolve(graphFile)));
  setProjectModuleCompiler(async (folder) => (await compileProjectModule(project, folder)).code);
  setEmbeddedCompiler(async (code) => (await compileEmbedded(project, code)).code);
  const removeStage = installStageBridge((stage, args, stageOptions) => runProjectStage(project, stage, args, {
    signal: stageOptions?.signal,
    onOutput: options.verbose
      ? (stream, text) => { for (const line of text.split('\n')) console.error(`[${stage}] ${line}`); }
      : undefined,
  }));
  const removeIo = installProjectIo(project);
  // Optional, like in `cascade run`: a graph with no canvas node still cooks
  // on a machine without the renderer.
  const canvas = await installHeadlessCanvas().catch(() => undefined);
  const started = performance.now();
  try {
    const { outputs } = await cookProjectGraph(graphFile, document, nodeId);
    const node = outputs.get(nodeId);
    if (!node) throw new Error(`No node "${nodeId}" in the graph`);
    return { outputs: node, durationMs: Math.round(performance.now() - started) };
  } finally {
    removeStage();
    removeIo();
    canvas?.dispose();
    setProjectModuleCompiler(null);
    setEmbeddedCompiler(null);
  }
}
