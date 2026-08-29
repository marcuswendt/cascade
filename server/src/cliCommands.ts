import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { loadConfig, saveConfig, configPath } from './config.js';
import { startServer } from './index.js';
import { ProjectRoot } from './project.js';
import { createNode, createProject } from './projectTemplate.js';

/** Run Studio/project commands without reading process.argv or exiting. */
export async function runStudioCli(args: readonly string[]): Promise<void> {
  const noOpen = args.includes('--no-open');
  const positional = args.filter((argument) => !argument.startsWith('--'));
  const config = loadConfig();

  if (positional[0] === 'projects') {
    if (positional[1]) {
      saveConfig({ projectsRoot: path.resolve(positional[1].replace(/^~(?=\/|$)/, process.env.HOME ?? '~')) });
      console.log(`[cascade] projects root set to ${loadConfig().projectsRoot} (${configPath()})`);
    } else console.log(loadConfig().projectsRoot);
    return;
  }

  if (positional[0] === 'new') {
    if (!positional[1]) throw new Error('usage: cascade new <name>');
    const directory = createProject(config.projectsRoot, positional[1]);
    console.log(`[cascade] created ${directory}`);
    positional[0] = directory;
  }

  if (positional[0] === 'node') {
    if (!positional[1]) throw new Error('usage: cascade node <Name> [project-directory]');
    const project = ProjectRoot.fromArg(positional[2] ?? '.');
    const directory = createNode(project.root, positional[1]);
    console.log(`[cascade] created project.${positional[1]} at ${directory}`);
    return;
  }

  let target = positional[0] ?? '.';
  if (!fs.existsSync(path.resolve(target))) {
    const projectTarget = path.resolve(config.projectsRoot, target);
    if (fs.existsSync(projectTarget)) target = projectTarget;
  }
  const project = ProjectRoot.fromArg(target);
  const server = startServer(project);

  server.on('listening', async () => {
    const defaultGraph = await project.resolveDefaultGraph();
    console.log(defaultGraph
      ? `📄 Opening ${defaultGraph}`
      : '📄 No default graph (name one explicitly, or add index.cascade) — starting empty');
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 3030;
    const url = `http://localhost:${port}`;
    if (!noOpen) {
      const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
      execFile(opener, [url], (error) => {
        if (error) console.warn(`[cascade] couldn't auto-open a browser (${error.message}) — open ${url} yourself.`);
      });
    }
  });
}
