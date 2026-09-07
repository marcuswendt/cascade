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
    // Aliased, not renamed: the package publishes as `@field/cascade` because
    // the bare name belongs to somebody else on npm — and a scaffolded project
    // asking for `cascade` would silently install that stranger's package.
    // The alias keeps every `cascade/contracts` import in a project working.
    devDependencies: { cascade: 'npm:@field/cascade@^0.2.0', typescript: '^6.0.0' },
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
  // Everything an agent needed to discover the hard way. Marcus watched a
  // console-launched Claude spend twenty tool calls working out the document
  // format, the connection shape, and whether an oscillator node existed —
  // then asked for better instructions. This is them. The costly facts are the
  // silent ones: a document with `type` instead of `module`, or missing
  // `source`, loads and executes and does nothing.
  fs.writeFileSync(path.join(directory, 'AGENTS.md'), `# Cascade project

Read \`node_modules/cascade/AGENTS.md\` for the framework itself. What follows is what an agent working in *this* project needs.

## Read this first

\`node_modules/cascade/doc/NODE_REFERENCE.md\` — every built-in node with its inputs, props and outputs, generated from the definitions themselves. Under 2,500 tokens for the whole catalogue. **Read it instead of searching the codebase for what a node does**, and note before you start that anything time-based is an expression rather than a node.

## Common commands

- \`npm run check\` — type-check custom nodes.
- \`npm run check:graph\` — statically check the graph and node definitions.
- \`npm run validate\` — validate \`index.cascade\`.
- \`npm run run\` — execute headlessly without Studio.
- \`cascade .\` — launch local Studio on loopback.
- \`cascade . --host KURO --port 3030\` — launch for \`http://KURO:3030\` on a trusted VPN/LAN.

Do not start another Cascade process on an occupied port. Remote access requires
both the explicit bind address and the exact trusted browser hostname.

## The \`.cascade\` document format

Hand-editing this file is normal and expected. The shape is not what you would guess, and getting it wrong fails **silently** — the graph loads, reports its nodes, says it executed, and does nothing.

\`\`\`json
{
  "version": "0.2",
  "metadata": { "name": "My Sketch" },
  "nodes": [
    {
      "id": "logo-1024",
      "module": "project.field-io-gradient-logo",
      "position": [240, 200],
      "source": "project",
      "params": [{ "name": "size", "value": 1024 }],
      "props": { "angle": { "value": 0, "expression": "$T * 40" } }
    }
  ],
  "connections": [
    [["oscillator", 0, "value"], ["logo-1024", 0, "angle"]]
  ],
  "annotations": []
}
\`\`\`

Five things that are easy to get wrong:

- **\`module\`, not \`type\`.** And \`"source": "project"\` is required for a project module — without it the engine never loads the module at all, and nothing complains.
- **\`position\` is \`[x, y]\`**, an array, not \`{x, y}\`.
- **\`params\` is an array** of \`{name, value}\`, not an object.
- **A connection is a pair of triples**: \`[[fromNode, portIndex, portName], [toNode, portIndex, portName]]\`. Direction comes from *position in the pair* — first is the source. The middle number is the **port index**, not a direction.
- **An expression lives under \`props\`** as \`{ value, expression }\`. \`params\` holds plain values.

## Before writing a node, check whether you need one

**Parameters can hold expressions**, and this is usually the answer to anything time-based. The variables are Houdini's:

| | |
|---|---|
| \`$F\` | frame, integer |
| \`$FF\` | frame, fractional |
| \`$T\` | seconds — **zero on the first frame** |
| \`$FPS\` | rate |
| \`ch("node/param")\`, \`ch("./param")\` | read another parameter |

So "oscillate the angle" is \`sin($T) * 40\` in the \`angle\` prop. **There is no built-in oscillator node and you do not need one.** A node earns its place when it produces geometry or pixels, or when several parameters share a computation.

\`fit\`, \`fit01\`, \`clamp\`, \`lerp\`, \`smooth\`, \`noise\` and \`random\` are all available inside an expression.

## Writing a node

Project nodes live at \`nodes/<name>/index.ts\`, one folder per module, referenced as \`project.<name>\`. Write them in the **dynamic** style:

\`\`\`ts
import { saveImage, cachePath } from 'cascade/io';

export const icon = 'Circle';        // a Lucide icon name
export const runsOn = 'browser';     // 'browser' | 'server' | 'portable'

export async function execute(node: any) {
  const size = node.param('size', 1024, { min: 16, max: 4096, step: 16, type: 'int' }).value;
  const input = node.in('value', 0, { type: 'float' }).value;
  const out = node.out('image', 'param', { type: 'image' });
  // ... work ...
  out.setValue({ path, size: [size, size], channels: 'rgb', depth: 'u8', space: 'srgb' });
}
\`\`\`

**Do not write a definition-v1 node** (\`export const definition = {...}\` with \`apiVersion: 1\`). It is the direction Cascade is heading and Studio cannot cook one yet: the compatibility engine calls \`execute(node, graph)\`, so \`context.props\` arrives undefined and the cook throws with an empty log. \`cascade run\` handles them; Studio does not.

Ports and parameters are declared *inside* \`execute\` — it runs once to discover them and again on every cook. Top-level statements do not work: the loader imports a real ES module and needs the \`execute\` export.

## Rendering

**Web technology first** — Canvas 2D, WebGL, WebGPU — per \`DESIGN.md\` in the Cascade repo. Reach for a Python stage only for work that genuinely cannot run in a browser, such as an exotic ML library. A Python stage costs a process spawn and a round trip per cook, which is invisible on one still frame and fatal to dragging a parameter.

An \`OffscreenCanvas\` plus \`saveImage(canvas, cachePath(node.id, '.png'))\` is the normal shape.

## Finding out what exists

- \`node_modules/cascade/doc/PROJECT_AUTHORING.md\` — project layout and the node contract.
- \`node_modules/cascade/ARCHITECTURE.md\` — what each package owns.
- \`GET /api/nodes\` on the running server — the project's own modules, with their \`runsOn\` and icons.
- \`node_modules/cascade/packages/runtime/src/builtins/\` — the built-in node definitions.
- The **Definition panel** in Studio shows, for any selected node, where it is defined and what it declares.

## Two things that will waste your time

**Never run \`npm run build\` in the Cascade repo.** It empties \`dist/\`, and the Studio servers serve from there.

**Check your work by running the graph**, not by reading it: \`npm run check:graph\` for a static check, \`npm run run\` for a headless cook. A silently-wrong document is the failure mode here, so a green read proves nothing.
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
