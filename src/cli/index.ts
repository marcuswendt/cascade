#!/usr/bin/env node

import { runGraph } from './runner.js';
import * as path from 'path';
import * as fs from 'fs/promises';
import { readFileSync } from 'node:fs';
import { superviseProcess } from './supervise.js';
import { GRAPH_COMMANDS_HELP, isGraphCommand, runGraphCommand } from './graphCommands.js';
import { runWithJsonEnvelope } from './jsonEnvelope.js';

const VERSION = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version as string;

/** Commands that never start Studio. Anything else is a project or graph to open. */
const COMMANDS = ['run', 'validate', 'check', 'inspect', 'build', 'export', 'freeze', 'publish', 'scene', 'projects', 'node', 'mcp', 'serve', 'parity'];

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === 'mcp' && !args.includes('--help') && !args.includes('-h')) {
    const { runMcpServer } = await import('./mcp.js');
    await runMcpServer(args.slice(1), VERSION);
    return;
  }

  // `--json` on any command: one `{ ok, data, warnings }` envelope on stdout.
  // `run --json`, `serve --json` and `parity --json` keep the flag, because it
  // makes them print their own JSON (a manifest with the run trace and stage
  // cache states, a status, a parity report), which becomes the data.
  if (args.includes('--json')) {
    const keepFlag = args[0] === 'run' || args[0] === 'serve' || args[0] === 'parity';
    const commandArgs = keepFlag ? args : args.filter((arg) => arg !== '--json');
    const opensStudio = !COMMANDS.includes(commandArgs[0] ?? '') && !isGraphCommand(commandArgs) &&
      !commandArgs.some((arg) => arg === '--help' || arg === '-h' || arg === '--version');
    await runWithJsonEnvelope(async () => {
      if (opensStudio) throw new Error('This command opens Studio, which has no --json output');
      if (isGraphCommand(commandArgs)) return runGraphCommand(commandArgs, { json: true });
      await dispatch(commandArgs);
      return undefined;
    });
    return;
  }

  await dispatch(args);
}

async function dispatch(args: string[]) {
  if (isGraphCommand(args) && !args.includes('--help') && !args.includes('-h')) {
    try {
      await runGraphCommand(args, { json: false });
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
    return;
  }

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

  // Shareable editors: export, freeze, publish, scene, and `run --scene/--write`.
  const editorCommand = ['export', 'freeze', 'publish', 'scene'].includes(args[0] ?? '') ||
    (args[0] === 'run' && (args.includes('--scene') || args.includes('--write')));
  if (editorCommand && !args.includes('--help') && !args.includes('-h')) {
    const { runEditorCommand } = await import('./editorCommands.js');
    try {
      await runEditorCommand(args);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
    return;
  }

  // `cascade parity`: cook headless twice and through the Studio path, compare.
  if (args[0] === 'parity' && !args.includes('--help') && !args.includes('-h')) {
    const { runParityCommand } = await import('./parity.js');
    try {
      process.exitCode = await runParityCommand(args.slice(1));
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 2;
    }
    return;
  }

  // Project/Studio commands share the root executable. The server entry is
  // bundled into the published CLI, so installed projects never depend on the
  // private server package or workspace links.
  if (args[0] === 'serve' || (!['run', 'validate', 'check', 'inspect'].includes(args[0] ?? '') && !args.includes('--version') && !args.includes('--help') && !args.includes('-h'))) {
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
  cascade serve start|stop|restart|status|logs|install [project] [options]
  cascade run <graph-file> [options]
  cascade validate <graph-file> [options]
  cascade check <graph-file> [options]
  cascade inspect <graph-file>
  cascade build <graph-file> --out <new-directory> [--asset <file>]...
  cascade export <graph-file> (--plan | --out <dir>) [--deploy vercel]
  cascade publish <graph-file> <node>.<prop> [--label ...]
  cascade freeze <graph-file> <node> --fields <a,b>
  cascade scene <graph-file> <scene.json> --out <new-graph-file>
  cascade mcp [project-directory]
${GRAPH_COMMANDS_HELP}
  cascade parity <graph-file> [--node <id>] [--seed N] [--tolerance N] [--no-studio]
Commands:
  new       Create a Cascade project
  node      Create a deterministic custom node
  projects  Show or set the default projects directory
  serve     Run Studio as a managed background service (cascade serve help)
  run       Execute a graph file
  validate  Validate a graph file without executing
  check     Statically check node definitions, types, and graph structure
  inspect   Print a machine-readable graph and node-definition summary
  build     Export a standalone browser player for static hosting or embedding
  export    Export the graph's published editor as a static site (doc/EDITOR_EXPORT.md)
  publish   Publish a node prop as an editor parameter
  freeze    Snapshot chosen fields of a live data source for export
  scene     Apply a scene file to a copy of the graph
  mcp       Serve these commands as MCP tools over stdio (doc/MCP.md)
  parity    Cook headless twice and through Studio's path; report per-node differences

Options:
  --host <address>         Bind Studio to an address or hostname
  --port <number>          Bind Studio HTTP to an explicit port
  --trusted-host <name>    Allow an exact remote browser hostname (repeatable)
  --fallback-host <addr>   Bind this instead when --host does not resolve or is
                           not on this machine (repeatable; default 127.0.0.1).
                           The preferred host is retried and rebound when it returns
  --no-open                Do not open Studio in a browser
  --node <id>        Render only this node's output. Repeatable.
  --entry-node <id>  Older spelling of --node, single valued
  --frames <range>   Render a frame sequence: 1-100, 1-100x2 (step), or 42
  --fps <number>     Frame rate to evaluate the range at
  --out <dir>        Sequence directory, project-relative (default: renders)
  --json             Print one { ok, data, warnings } envelope (any command)
  --seed <n>         Cook with this graph seed instead of the document's
  --timeout <ms>     Bound a run in a supervised child process (exit 124 on timeout)
  --validate-only   Validate only (same as 'validate' command)
  --strict          Fail when a node names a module with no file (default: warn)
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

Every run writes a trace to .cascade/runs/: each node's time and every Python
stage call with its cache key and state (hit, miss, off). --verbose prints the
stage lines as they happen.
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
    nodes?: string[];
    validateOnly?: boolean;
    checkOnly?: boolean;
    inspectOnly?: boolean;
    /** Fail rather than warn when a node names a module with no file. */
    strict?: boolean;
    verbose?: boolean;
    frames?: string;
    fps?: number;
    out?: string;
    json?: boolean;
    seed?: number;
  } = {
    file: fileArg,
    validateOnly: command === 'validate',
    strict: args.includes('--strict'),
    checkOnly: command === 'check',
    inspectOnly: command === 'inspect'
  };

  // Parse flags
  const verboseIndex = args.indexOf('--verbose') !== -1 ? args.indexOf('--verbose') : args.indexOf('-v');
  if (verboseIndex !== -1) {
    options.verbose = true;
  }

  // `--node`, repeatable. Collected before `--entry-node` so the newer
  // spelling wins when both are present.
  const named: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--node' && args[index + 1]) named.push(args[index + 1]);
  }
  if (named.length) options.nodes = named;

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

  if (args.includes('--json') && command === 'run') options.json = true;
  const seed = valueOf('--seed');
  if (seed !== undefined) {
    const value = Number(seed);
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
      throw new Error(`--seed must be an integer from 0 to 4294967295 (got "${seed}")`);
    }
    options.seed = value;
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
