#!/usr/bin/env node

/**
 * The `cascade` executable. Which verb runs, and how it treats `--json`,
 * `--help` and `--version`, comes from the verb table in verbs.ts; each
 * handler is imported only when its verb runs, so `--version`, the graph
 * commands and the MCP server's children never load the engine they do not
 * use (tests/cli-cold-start.test.ts holds that line).
 */

import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { runWithJsonEnvelope } from './jsonEnvelope.js';
import { mainHelp, verbFor, type Handler } from './verbs.js';

const VERSION = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version as string;

const isHelp = (args: readonly string[]) => args.includes('--help') || args.includes('-h');

/** Print `Error: <message>` and set the exit code, for handlers that report rather than throw. */
const reported = (exitCode: number, run: () => Promise<void>) => async () => {
  try {
    await run();
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = exitCode;
  }
};

/** Each handler, loaded on use. `help` is true when the verb's own help was asked for. */
const HANDLERS: Record<Handler, (args: string[], help: boolean) => Promise<void>> = {
  async studio(args) {
    // Project/Studio commands share the root executable. The server entry is
    // bundled into the published CLI, so installed projects never depend on
    // the private server package or workspace links.
    const { runStudioCli } = await import('../../server/src/cliCommands.js');
    await runStudioCli(args);
  },
  async run(args) {
    // Shareable editors: `run --scene/--write` is an editor command.
    if (args.includes('--scene') || args.includes('--write')) return HANDLERS.editor(args, false);
    const { runCommand } = await import('./runCommand.js');
    await runCommand(args);
  },
  async render(args, help) {
    const { RENDER_HELP, parseRenderArgs, renderGraph } = await import('./render.js');
    if (help) {
      console.log(RENDER_HELP);
      return;
    }
    await reported(1, async () => {
      const options = parseRenderArgs(args.slice(1));
      const result = await renderGraph(options);
      if (options.json) process.stdout.write(JSON.stringify({ status: 'completed', graph: path.resolve(options.file), ...result }) + '\n');
    })();
  },
  async renderWorker(args) {
    const { runRenderWorker } = await import('./render.js');
    await runRenderWorker(args[1]);
  },
  async build(args) {
    const { buildCommand } = await import('./runCommand.js');
    await buildCommand(args);
  },
  async editor(args) {
    const { runEditorCommand } = await import('./editorCommands.js');
    await reported(1, () => runEditorCommand(args))();
  },
  async parity(args) {
    await reported(2, async () => {
      const { runParityCommand } = await import('./parity.js');
      process.exitCode = await runParityCommand(args.slice(1));
    })();
  },
  async graph(args) {
    const { runGraphCommand } = await import('./graphCommands.js');
    await reported(1, async () => { await runGraphCommand(args, { json: false }); })();
  },
  async lock(args, help) {
    const { runLockCommand, LOCK_HELP } = await import('./locks/commands.js');
    if (help) console.log(LOCK_HELP);
    else await runLockCommand(args);
  },
  async mcp(args) {
    const { runMcpServer } = await import('./mcp.js');
    await runMcpServer(args.slice(1), VERSION);
  },
};

async function main() {
  const args = process.argv.slice(2);

  if (verbFor(args)?.handler === 'mcp' && !isHelp(args)) {
    await HANDLERS.mcp(args, false);
    return;
  }

  // `--json` on any command: one `{ ok, data, warnings }` envelope on stdout.
  // A verb whose table row says `keep` (run, render, serve, parity, the lock
  // commands) keeps the flag, because it makes them print their own JSON (a
  // manifest with the run trace and stage cache states, a status, a parity
  // report), which becomes the data.
  if (args.includes('--json')) {
    const keepFlag = verbFor(args)?.json === 'keep';
    const commandArgs = keepFlag ? args : args.filter((arg) => arg !== '--json');
    const verb = verbFor(commandArgs);
    const opensStudio = (!verb || verb.json === 'studio') &&
      !commandArgs.some((arg) => arg === '--help' || arg === '-h' || arg === '--version');
    await runWithJsonEnvelope(async () => {
      if (opensStudio) throw new Error('This command opens Studio, which has no --json output');
      if (verb?.handler === 'graph') {
        const { runGraphCommand } = await import('./graphCommands.js');
        return runGraphCommand(commandArgs, { json: true });
      }
      await dispatch(commandArgs);
      return undefined;
    });
    return;
  }

  await dispatch(args);
}

async function dispatch(args: string[]) {
  const verb = verbFor(args);
  const help = isHelp(args);
  const version = args.includes('--version');

  if (verb && (help ? verb.help === 'own' : !(version && verb.version === 'main'))) {
    await HANDLERS[verb.handler](args, help);
    return;
  }

  // Anything that is not a verb is a project or graph to open in Studio.
  if (!verb && !help && !version) {
    await HANDLERS.studio(args, false);
    return;
  }

  if (version) {
    console.log(`Cascade CLI v${VERSION}`);
    process.exit(0);
  }

  console.log(mainHelp());
  process.exit(0);
}

main().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
