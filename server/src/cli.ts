#!/usr/bin/env node
import { runStudioCli } from './cliCommands.js';

runStudioCli(process.argv.slice(2)).catch((error) => {
  console.error(`[cascade] ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
