/**
 * `cascade run|validate|check|inspect` and `cascade build`: the command lines
 * of the verbs that cook. Loaded only when one of them runs, so the rest of
 * the CLI and the MCP server's children start without the engine.
 */

import * as fs from 'fs/promises';
import { superviseProcess } from './supervise.js';

export async function runCommand(args: string[]): Promise<void> {
  const command = args[0];
  const fileArg = args[1];

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
    fresh?: boolean;
    mp4?: string;
    crf?: number;
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

  const mp4 = valueOf('--mp4');
  if (mp4) {
    if (command !== 'run' || !options.frames) throw new Error('--mp4 requires run --frames (try --frames timeline)');
    options.mp4 = mp4;
  }
  const crf = valueOf('--crf');
  if (crf !== undefined) {
    const value = Number(crf);
    if (!options.mp4 || !Number.isInteger(value) || value < 0 || value > 51) throw new Error('--crf needs --mp4 and an integer from 0 to 51');
    options.crf = value;
  }

  if (args.includes('--json') && command === 'run') options.json = true;
  if (args.includes('--fresh')) options.fresh = true;
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
    process.exitCode = await superviseProcess(process.execPath, [...process.execArgv, process.argv[1]!, ...childArgs], ms);
    return;
  }

  // Run graph. The engine loads here, after the arguments are known good.
  const { runGraph } = await import('./runner.js');
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

/** `cascade build <graph-file> --out <new-directory> [--asset <file>]...` */
export async function buildCommand(args: string[]): Promise<void> {
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
}
