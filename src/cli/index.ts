#!/usr/bin/env node

import { runGraph } from './runner.js';
import * as path from 'path';
import * as fs from 'fs/promises';
import { readFileSync } from 'node:fs';
import { superviseProcess } from './supervise.js';

const VERSION = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version as string;

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === 'build' && !args.includes('--help') && !args.includes('-h')) {
    const { buildPlayer } = await import('./webBuild.js');
    if (!args[1] || args[1].startsWith('-')) throw new Error('cascade build requires a graph file');
    let out: string | undefined;
    const assets: string[] = [];
    for (let index = 2; index < args.length; index += 2) {
      const flag = args[index];
      if (flag !== '--out' && flag !== '--asset') throw new Error(`Unknown build option: ${flag}`);
      const value = args[index + 1];
      if (!value || value.startsWith('-')) throw new Error(`${flag} requires a value`);
      if (flag === '--out') {
        if (out !== undefined) throw new Error('--out may only be supplied once');
        out = value;
      } else assets.push(value);
    }
    if (!out) throw new Error('cascade build requires --out <new-directory>');
    try {
      const result = await buildPlayer(args[1], { out, assets });
      console.log(`Browser player built: ${result.directory}`);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
    return;
  }

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
  cascade [project-directory | graph-file] [Studio options]
  cascade new <name>
  cascade node <Name> [project-directory]
  cascade projects [directory]
  cascade run <graph-file> [options]
  cascade validate <graph-file> [options]
  cascade check <graph-file> [options]
  cascade inspect <graph-file>
  cascade build <graph-file> --out <new-directory> [--asset <file>]...

Commands:
  new       Create a Cascade project
  node      Create a deterministic custom node
  projects  Show or set the default projects directory
  run       Execute a graph file
  validate  Validate a graph file without executing
  check     Statically check node definitions, types, and graph structure
  inspect   Print a machine-readable graph and node-definition summary
  build     Export a standalone browser player for static hosting or embedding

Options:
  --host <address>         Bind Studio to an address or hostname
  --port <number>          Bind Studio HTTP to an explicit port
  --trusted-host <name>    Allow an exact remote browser hostname (repeatable)
  --no-open                Do not open Studio in a browser
  --entry-node <id>  Execute from a specific entry node
  --frames <range>   Render a frame sequence: 1-100, 1-100x2 (step), or 42
  --fps <number>     Frame rate to evaluate the range at
  --out <dir>        Sequence directory, project-relative (default: renders)
  --json             Return a JSON render manifest (requires run --frames)
  --timeout <ms>     Bound a run in a supervised child process (exit 124 on timeout)
  --validate-only   Validate only (same as 'validate' command)
  --verbose, -v      Show verbose output
  --version          Show version
  --help, -h         Show this help message

Examples:
  cascade .
  cascade . --host KURO --port 3030
  cascade new my-artwork
  cascade node Multiply ./my-artwork
  cascade run graph.cascade
  cascade run graph.cascade --entry-node node_123
  cascade validate graph.cascade
  cascade run graph.cascade --frames 1-100
  cascade run graph.cascade --frames 1-100x2 --fps 25 --out frames
  cascade run graph.cascade --verbose

A frame sequence is written as <out>/<node id>.<frame>.<ext> — one file per
image output nothing downstream consumes, or per output of --entry-node.
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
    frames?: string;
    fps?: number;
    out?: string;
    json?: boolean;
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

  // A flag whose value is missing is a typo, not a default: rendering frame 1
  // when somebody asked for a hundred frames is the worst of the options.
  const valueOf = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    if (index === -1) return undefined;
    const value = args[index + 1];
    if (!value || value.startsWith('-')) {
      console.error(`Error: ${flag} needs a value`);
      process.exit(1);
    }
    return value;
  };

  const frames = valueOf('--frames');
  if (frames) options.frames = frames;

  const fps = valueOf('--fps');
  if (fps !== undefined) {
    const rate = Number(fps);
    if (!Number.isFinite(rate) || rate <= 0) {
      console.error(`Error: --fps must be a positive number (got "${fps}")`);
      process.exit(1);
    }
    options.fps = rate;
  }

  const out = valueOf('--out');
  if (out) options.out = out;

  if (args.includes('--json')) {
    if (command !== 'run' || !options.frames) throw new Error('--json requires run --frames (use --frames 1 for a still)');
    options.json = true;
  }
  const timeout = valueOf('--timeout');
  if (timeout !== undefined) {
    const ms = Number(timeout);
    if (command !== 'run' || !Number.isSafeInteger(ms) || ms <= 0 || ms > 2_147_483_647) {
      throw new Error('--timeout requires run and a positive integer number of milliseconds up to 2147483647');
    }
    const index = args.indexOf('--timeout');
    const childArgs = [...args.slice(0, index), ...args.slice(index + 2)];
    if (childArgs.includes('--timeout')) throw new Error('--timeout may only be specified once');
    process.exitCode = await superviseProcess(process.execPath, [...process.execArgv, process.argv[1], ...childArgs], ms);
    return;
  }

  // Run graph
  try {
    // Preserve stdout as a machine-readable channel, even when trusted nodes
    // log during execution. The final manifest writes stdout directly.
    if (options.json) console.log = console.error;
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
