#!/usr/bin/env node

import { runGraph } from './runner.js';
import * as path from 'path';
import * as fs from 'fs/promises';

const VERSION = '0.1.0';

async function main() {
  const args = process.argv.slice(2);

  // Handle version flag
  if (args.includes('--version') || args.includes('-v')) {
    console.log(`Cascade CLI v${VERSION}`);
    process.exit(0);
  }

  // Handle help flag
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Cascade Graph Execution CLI

Usage:
  cascade run <graph-file> [options]
  cascade validate <graph-file> [options]

Commands:
  run       Execute a graph file
  validate  Validate a graph file without executing

Options:
  --entry-node <id>  Execute from a specific entry node
  --validate-only   Validate only (same as 'validate' command)
  --verbose, -v      Show verbose output
  --version          Show version
  --help, -h         Show this help message

Examples:
  cascade run graph.cascade
  cascade run graph.cascade --entry-node node_123
  cascade validate graph.cascade
  cascade run graph.cascade --verbose
`);
    process.exit(0);
  }

  // Parse command
  const command = args[0];
  const fileArg = args[1];

  if (!command || (command !== 'run' && command !== 'validate')) {
    console.error('Error: Invalid command. Use "run" or "validate"');
    console.error('Run "cascade --help" for usage information');
    process.exit(1);
  }

  if (!fileArg) {
    console.error('Error: Graph file path required');
    console.error('Run "cascade --help" for usage information');
    process.exit(1);
  }

  // Check if file exists
  try {
    await fs.access(fileArg);
  } catch {
    console.error(`Error: File not found: ${fileArg}`);
    process.exit(1);
  }

  // Parse options
  const options: {
    file: string;
    entryNode?: string;
    validateOnly?: boolean;
    verbose?: boolean;
  } = {
    file: fileArg,
    validateOnly: command === 'validate'
  };

  // Parse flags
  const verboseIndex = args.indexOf('--verbose') !== -1 ? args.indexOf('--verbose') : args.indexOf('-v');
  if (verboseIndex !== -1) {
    options.verbose = true;
  }

  const entryNodeIndex = args.indexOf('--entry-node');
  if (entryNodeIndex !== -1 && args[entryNodeIndex + 1]) {
    options.entryNode = args[entryNodeIndex + 1];
  }

  // Run graph
  try {
    await runGraph(options);
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    if (options.verbose && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});

