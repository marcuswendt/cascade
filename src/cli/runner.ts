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

export interface RunOptions {
  file: string;
  entryNode?: string;
  validateOnly?: boolean;
  checkOnly?: boolean;
  inspectOnly?: boolean;
  verbose?: boolean;
}

export async function runGraph(options: RunOptions): Promise<void> {
  const { file, entryNode, validateOnly, checkOnly, inspectOnly, verbose } = options;

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

  if (await runDeterministicProjectGraph(file, graphData, entryNode)) {
    if (verbose) console.log('Graph execution completed');
    return;
  }

  // A dynamic graph reaches here, and until now it died trying to fetch its
  // modules from `/api/nodes/...` — a relative URL, with no server behind it and
  // no origin to resolve it against. Compiling them in-process with the same
  // esbuild pass the server uses is what makes `cascade run` work on the graphs
  // people actually have, rather than only on fully migrated ones.
  // Best effort: a .cascade file can sit outside a project directory, and such
  // a graph should still run whatever it carries inline rather than failing on
  // a project that is not there.
  let disposeStageBridge: (() => void) | undefined;
  try {
    const project = new ProjectRoot(path.dirname(path.resolve(file)));
    setProjectModuleCompiler(async (folderName) => (await compileProjectModule(project, folderName)).code);
    setEmbeddedCompiler(async (code) => (await compileEmbedded(project, code)).code);
    // A node importing `cascade/stage` posts to the server in the page and
    // calls this in a headless run, so one Python-backed node renders either way.
    disposeStageBridge = installStageBridge((stage, args) => runProjectStage(project, stage, args));
  } catch (error) {
    if (verbose) console.warn(`No project context for ${file}: ${error instanceof Error ? error.message : error}`);
  }

  try {
    // Create graph from JSON
    let graph: Graph;
    try {
      graph = Graph.fromJSON(graphData, assetManager, packageManager);
    } catch (error: any) {
      console.error(`Failed to create graph: ${error.message}`);
      process.exit(1);
    }

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
      if (entryNode) {
        const node = graph.getNode(entryNode);
        if (!node) {
          console.error(`Entry node not found: ${entryNode}`);
          process.exit(1);
        }
        if (verbose) {
          console.log(`Executing from entry node: ${entryNode}`);
        }
        await graph.execute(node);
      } else {
        if (verbose) {
          console.log('Executing all entry points...');
        }
        await graph.execute();
      }

      const failedNodes = graph.nodes.filter(node => node.error !== null);
      if (failedNodes.length > 0) {
        console.error('Graph execution failed:');
        for (const node of failedNodes) {
          console.error(`  - node/cook-failed [${node.id}]: ${node.error?.message ?? 'Unknown cook error'}`);
        }
        process.exit(1);
      }

      if (verbose) {
        console.log('Graph execution completed');
      }
    } catch (error: any) {
      console.error(`Graph execution failed: ${error.message}`);
      if (verbose && error.stack) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  } finally {
    disposeStageBridge?.();
    setProjectModuleCompiler(null);
    setEmbeddedCompiler(null);
  }
}
