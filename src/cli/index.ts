#!/usr/bin/env node

import { runGraph } from './runner.js';
import * as path from 'path';
import * as fs from 'fs/promises';
import { readFileSync } from 'node:fs';

const VERSION = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version as string;

async function main() {
  const args = process.argv.slice(2);

  // Project/Studio commands share the root executable. The server entry is
  // bundled into the published CLI, so installed projects never depend on the
  // private server package or workspace links.
  if (!['run', 'validate', 'check', 'inspect'].includes(args[0] ?? '') && !args.includes('--version') && !args.includes('--help') && !args.includes('-h')) {
    const { runStudioCli } = await import('../../server/src/cliCommands.js');
    await runStudioCli(args);
    return;
  }

  // Handle version flag
  if (args.includes('--version')) {
    console.log(`Cascade CLI v${VERSION}`);
    process.exit(0);
  }

  // Handle help flag
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Cascade Graph Execution CLI

Usage:
  cascade [project-directory | graph-file] [--no-open]
  cascade new <name>
  cascade node <Name> [project-directory]
  cascade projects [directory]
  cascade run <graph-file> [options]
  cascade validate <graph-file> [options]
  cascade check <graph-file> [options]
  cascade inspect <graph-file>

Commands:
  new       Create a Cascade project
  node      Create a deterministic custom node
  projects  Show or set the default projects directory
  run       Execute a graph file
  validate  Validate a graph file without executing
  check     Statically check node definitions, types, and graph structure
  inspect   Print a machine-readable graph and node-definition summary

Options:
  --entry-node <id>  Execute from a specific entry node
  --validate-only   Validate only (same as 'validate' command)
  --verbose, -v      Show verbose output
  --version          Show version
  --help, -h         Show this help message

Examples:
  cascade ./
  cascade new my-artwork
  cascade node Multiply ./my-artwork
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

  if (!command || !['run', 'validate', 'check', 'inspect'].includes(command)) {
    console.error('Error: Invalid command');
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
    checkOnly?: boolean;
    inspectOnly?: boolean;
    verbose?: boolean;
  } = {
    file: fileArg,
    validateOnly: command === 'validate',
    checkOnly: command === 'check',
    inspectOnly: command === 'inspect'
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
