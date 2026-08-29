#!/usr/bin/env node
/**
 * `cascade` CLI — "cd <project> && cascade ./" starts a server scoped to
 * that directory and opens a browser on localhost:<port>. The binary is
 * symlinked onto PATH (see server/scripts/link-cli.sh) so it's runnable
 * from anywhere, per Marcus's own spec.
 */
import fs from 'fs';
import path from 'path';
import { ProjectRoot } from './project.js';
import { startServer } from './index.js';
import { loadConfig, saveConfig, configPath } from './config.js';
import { execFile } from 'child_process';

const args = process.argv.slice(2);
const noOpen = args.includes('--no-open');
const positional = args.filter((a) => !a.startsWith('--'));
const config = loadConfig();

// `cascade projects` / `cascade projects <dir>` — read or move the default home.
if (positional[0] === 'projects') {
  if (positional[1]) {
    saveConfig({ projectsRoot: path.resolve(positional[1].replace(/^~(?=\/|$)/, process.env.HOME ?? '~')) });
    console.log(`[cascade] projects root set to ${loadConfig().projectsRoot} (${configPath()})`);
  } else {
    console.log(loadConfig().projectsRoot);
  }
  process.exit(0);
}

// `cascade new <name>` — scaffold a project in the projects root and open it.
if (positional[0] === 'new') {
  const name = positional[1];
  if (!name) {
    console.error('[cascade] usage: cascade new <name>');
    process.exit(1);
  }
  const dir = path.resolve(config.projectsRoot, name);
  if (fs.existsSync(dir)) {
    console.error(`[cascade] already exists: ${dir}`);
    process.exit(1);
  }
  fs.mkdirSync(path.join(dir, 'nodes'), { recursive: true });
  // index.cascade by convention, so `cascade <name>` opens it without argument.
  fs.writeFileSync(
    path.join(dir, 'index.cascade'),
    JSON.stringify({ name, version: '0.2', viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], connections: [], annotations: [] }, null, 1) + '\n'
  );
  fs.writeFileSync(path.join(dir, '.gitignore'), '.cascade-cache/\n');
  console.log(`[cascade] created ${dir}`);
  positional[0] = dir;
}

// The positional argument is a directory (`cascade ./`), a graph file
// (`cascade cloud-plots.cascade`), or a bare project name resolved against the
// projects root. A file argument scopes the server to its containing directory
// AND makes it the graph the client opens.
let targetArg = positional[0] ?? '.';
if (!fs.existsSync(path.resolve(targetArg))) {
  const inProjectsRoot = path.resolve(config.projectsRoot, targetArg);
  if (fs.existsSync(inProjectsRoot)) targetArg = inProjectsRoot;
}

let project: ProjectRoot;
try {
  project = ProjectRoot.fromArg(targetArg);
} catch (err) {
  console.error(`[cascade] ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

const server = startServer(project);

server.on('listening', async () => {
  const defaultGraph = await project.resolveDefaultGraph();
  console.log(
    defaultGraph
      ? `📄 Opening ${defaultGraph}`
      : `📄 No default graph (name one explicitly, or add index.cascade) — starting empty`
  );
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 3030;
  const url = `http://localhost:${port}`;
  if (!noOpen) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    execFile(opener, [url], (err) => {
      if (err) console.warn(`[cascade] couldn't auto-open a browser (${err.message}) — open ${url} yourself.`);
    });
  }
});
