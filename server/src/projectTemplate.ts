import fs from 'node:fs';
import path from 'node:path';

const PROJECT_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const NODE_NAME = /^[A-Z][A-Za-z0-9]{0,63}$/;

export function createProject(projectsRoot: string, name: string): string {
  if (!PROJECT_NAME.test(name)) {
    throw new Error('Project names use lowercase letters, numbers, and hyphens (maximum 64 characters).');
  }

  const root = path.resolve(projectsRoot);
  const directory = path.resolve(root, name);
  if (path.dirname(directory) !== root) throw new Error('Project path escapes the configured projects directory.');
  if (fs.existsSync(directory)) throw new Error(`Already exists: ${directory}`);

  fs.mkdirSync(path.join(directory, 'nodes'), { recursive: true });
  fs.mkdirSync(path.join(directory, 'assets'));
  writeJson(path.join(directory, 'cascade.json'), { name });
  writeJson(path.join(directory, 'index.cascade'), {
    name,
    version: '0.2',
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [],
    connections: [],
    annotations: [],
  });
  writeJson(path.join(directory, 'package.json'), {
    name,
    private: true,
    type: 'module',
    scripts: {
      check: 'tsc --noEmit',
      validate: 'cascade validate index.cascade',
      'check:graph': 'cascade check index.cascade',
      inspect: 'cascade inspect index.cascade',
      run: 'cascade run index.cascade',
    },
    devDependencies: { cascade: '^0.2.0', typescript: '^5.0.0' },
  });
  writeJson(path.join(directory, 'tsconfig.json'), {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      strict: true,
      noEmit: true,
    },
    include: ['nodes/**/*.ts'],
  });
  fs.writeFileSync(path.join(directory, '.gitignore'), '.cascade-cache/\nrenders/\nnode_modules/\n');
  fs.writeFileSync(path.join(directory, 'AGENTS.md'), `# Cascade project

Read \`node_modules/cascade/AGENTS.md\` before editing graphs or nodes. Prefer deterministic node definitions.

## Common commands

- \`npm run check\` — type-check custom nodes.
- \`npm run check:graph\` — statically check the graph and node definitions.
- \`npm run validate\` — validate \`index.cascade\`.
- \`npm run run\` — execute headlessly without Studio.
- \`cascade ./\` — launch local Studio on loopback.
- \`cascade ./ --host KURO --port 3030\` — launch for \`http://KURO:3030\` on a trusted VPN/LAN.

Do not start another Cascade process on an occupied port. Remote access requires
both the explicit bind address and the exact trusted browser hostname.
`);
  return directory;
}

export function createNode(projectRoot: string, name: string): string {
  if (!NODE_NAME.test(name)) {
    throw new Error('Node names start with an uppercase letter and contain only letters or numbers.');
  }
  const directory = path.resolve(projectRoot, 'nodes', name);
  if (fs.existsSync(directory)) throw new Error(`Already exists: ${directory}`);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'index.ts'), nodeSource(name));
  return directory;
}

function writeJson(file: string, value: unknown): void {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function nodeSource(name: string): string {
  return `import type { NodeDefinition, NodeExecutionContext } from 'cascade/contracts';

export const definition = {
  apiVersion: 1,
  label: '${name}',
  runsOn: 'portable',
  inputs: {
    value: { kind: 'data', type: 'float', default: 0 }
  },
  outputs: {
    result: { kind: 'data', type: 'float' }
  }
} as const satisfies NodeDefinition;

export function execute(context: NodeExecutionContext<typeof definition>) {
  context.outputs.result.set(context.inputs.value);
}
`;
}
