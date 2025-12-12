import { Graph } from '../core/engine/Graph.js';
import { Node } from '../core/engine/Node.js';
import { AssetManager, NodeAssetLoader } from '../core/engine/AssetManager.js';
import { PackageManager } from '../core/engine/PackageManager.js';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface RunOptions {
  file: string;
  entryNode?: string;
  validateOnly?: boolean;
  verbose?: boolean;
}

export async function runGraph(options: RunOptions): Promise<void> {
  const { file, entryNode, validateOnly, verbose } = options;

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
  const assetLoader = new NodeAssetLoader(fs, path);
  const assetManager = new AssetManager(projectRoot, assetLoader);
  const packageManager = new PackageManager();

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
  for (const element of graph.elements.filter(e => e.kind === 'computation')) {
    const node = element as Node;
    // Check if computation has ports (restored from metadata)
    // If not, we may need to execute to create them
    const hasPorts = node.inputs.length > 0 || node.outputs.length > 0;
    if (!hasPorts && node.code) {
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
    const nodeCount = graph.elements.filter(e => e.kind === 'computation').length;
    console.log(`Graph loaded: ${nodeCount} nodes, ${graph.connections.length} connections`);
  }

  if (validateOnly) {
    console.log('Graph validation passed!');
    return;
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
}

