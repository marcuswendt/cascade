import fs from 'node:fs';
import path from 'node:path';

/**
 * The range a scaffolded project asks for, derived from the CLI's own version
 * rather than written down.
 *
 * It was hardcoded, and it went stale exactly the way the *name* half of this
 * dependency once did: the CLI moved to 0.3.0 while the template still said
 * `^0.2.0`, so every project the new CLI scaffolded would have installed the
 * previous release and then failed in ways nobody would trace back to here.
 * A caret range on the CLI's own minor cannot drift, because there is nothing
 * left to forget to update.
 *
 * The fallback exists because a `package.json` that cannot be read is not a
 * reason to scaffold nothing — but `*` is deliberately loud rather than a
 * plausible-looking pin that might be wrong.
 */
function cascadeVersionRange(): string {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
    ) as { version?: string };
    const match = /^(\d+)\.(\d+)\./.exec(pkg.version ?? '');
    return match ? `^${match[1]}.${match[2]}.0` : '*';
  } catch {
    return '*';
  }
}

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
    devDependencies: {
      cascade: `npm:@field/cascade@${cascadeVersionRange()}`,
      typescript: '^6.0.0',
    },
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

The maths library is exposed bare, so write \`sin(x)\` rather than \`Math.sin(x)\`. Angles are in **radians**, unlike Houdini; \`sind\`, \`cosd\`, \`tand\`, \`radians()\` and \`degrees()\` are there for a formula carried across, and \`PI\`, \`TAU\` and \`E\` are in scope.

## Writing a node

Project nodes live at \`nodes/<name>/index.ts\`, one folder per module, referenced as \`project.<name>\`. Write them in the **definition-v1** style, which is what \`cascade node <Name>\` scaffolds:

\`\`\`ts
import type { NodeDefinition, NodeExecutionContext } from 'cascade/contracts';

export const definition = {
  apiVersion: 1,
  label: 'Grain',
  icon: 'Circle',                    // a Lucide icon name
  runsOn: 'portable',                // 'portable' | 'browser' | 'server'
  inputs: {
    value: { kind: 'data', type: 'float', default: 0 },
  },
  outputs: {
    image: { kind: 'data', type: 'image' },
  },
  props: {
    size: { type: 'int', default: 1024, min: 16, max: 4096, step: 16 },
  },
} as const satisfies NodeDefinition;

export function execute(context: NodeExecutionContext<typeof definition>) {
  const { value } = context.inputs;
  const { size } = context.props;
  // ... work ...
  context.outputs.image.set({ path, size: [size, size], channels: 'rgb', depth: 'u8', space: 'srgb' });
}
\`\`\`

The declaration is the point: ports, types, props and the execution locus are read from the literal without running anything, which is what \`cascade check\` inspects and what the Definition panel shows. \`execute\` then does computation only — it never declares a port.

### Use the vector types

Anything with an x and a y is **one** \`vec2\`, not two floats. Same for \`vec3\` and \`vec4\`, with \`vec2i\`, \`vec3i\` and \`vec4i\` for integer counts and pixel sizes. A position, an offset, a size, a scale, a colour with alpha, a resolution — all single vector ports.

\`\`\`ts
// Wrong
props: { offset_x: { type: 'float', default: 0 }, offset_y: { type: 'float', default: 0 } }

// Right
props: { offset: { type: 'vec2', default: [0, 0] } }
\`\`\`

Not a style preference. Two floats that are really one vector cannot be connected to a \`vec2\` output, get two rows in the Inspector instead of one control, need two keyframes to animate one movement, and let a graph carry an x without its y. The type system knows what a \`vec2\` is; it cannot know that \`offset_x\` and \`offset_y\` belong together.

Split them only when the components genuinely differ in kind or in range — a \`width\` and a \`depth\` that are separately meaningful are two props, not a \`vec2\`.

Both hosts cook this style. **Studio** builds the node's ports from the literal and calls \`execute\` with a real \`NodeExecutionContext\`; **\`cascade run\`** runs it through the deterministic runtime. Studio reads the definition from the compiled module, so a definition edit shows up on the next save like any other change.

The older **dynamic** style — \`export async function execute(node, graph)\` declaring its ports imperatively inside itself with \`node.in\`, \`node.param\` and \`node.out\` — still cooks in Studio and under \`cascade run\`, so an existing node keeps working. It is not the style to write something new in: nothing can read what a dynamic node takes or returns until it has cooked, so \`cascade check\` cannot check it and the Definition panel has nothing to show. If you are editing one heavily, convert it.

Either way the module is a real ES module and the loader needs the \`execute\` export. Top-level side effects do not belong in it.

## Rendering

**Web technology first** — Canvas 2D, WebGL, WebGPU — per \`DESIGN.md\` in the Cascade repo. Reach for a Python stage only for work that genuinely cannot run in a browser, such as an exotic ML library. A Python stage costs a process spawn and a round trip per cook, which is invisible on one still frame and fatal to dragging a parameter.

An \`OffscreenCanvas\` plus \`saveImage(canvas, cachePath(node.id, '.png'))\` is the normal portable shape; the headless host supplies the Canvas APIs needed by \`cascade run\`.

Use \`browser\` only for code that genuinely needs the page, such as the DOM or WebGL. Prefer \`new OffscreenCanvas(width, height)\` to \`document.createElement('canvas')\` when both hosts can run the same node.

## Finding out what exists

- \`node_modules/cascade/doc/PROJECT_AUTHORING.md\` — project layout and the node contract.
- \`node_modules/cascade/ARCHITECTURE.md\` — what each package owns.
- \`GET /api/nodes\` on the running server — the project's own modules, with their \`runsOn\` and icons.
- \`node_modules/cascade/dist/runtime/builtins/\` — the built-in node definitions, as the shipped type declarations. (\`packages/\` is not in the published \`files\` list, so an installed copy has no source tree.)
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
