# Cascade

Cascade is a TypeScript node-graph runtime and optional visual workspace for generative design. It is built for projects that move between interactive web work, WebGL, print, motion, sound, and Python or AI stages without rebuilding the surrounding application infrastructure each time.

Created by Marcus Wendt at [FIELD.IO](https://www.field.io).

## What Cascade provides

- A typed, inspectable graph model with lazy execution and explicit triggers.
- Deterministic custom-node definitions that tools can inspect without running user code.
- The same runtime in Studio, a Node service, or a UI-free browser application.
- Project-native `.cascade` files, assets, presets, and Git-backed version history.
- Nested subnets with persistent hierarchy.
- Explicit browser and server capabilities for WebGL, files, media, Python, AI, and allowlisted shell commands.
- A Svelte Studio with an infinite canvas, Inspector, Viewer, and project workbench.

Cascade separates the generative algorithm from the platform. Custom nodes describe stages of a pipeline; the runtime schedules and validates them; hosts supply environment-specific capabilities; Studio is only one possible frontend.

## Develop Cascade

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

Useful checks:

```bash
npm run check
npm run test:run
npm run build:cli
npm --prefix server run build
npm run build
```

## Create a project

```bash
cascade new my-artwork
cd ~/Documents/Cascade/my-artwork
cascade ./
```

A project is an ordinary directory or Git repository:

```text
my-artwork/
├── cascade.json          # optional host policy and settings
├── index.cascade         # default graph
├── nodes/
│   └── Multiply/
│       └── index.ts      # project.Multiply
├── assets/
├── package.json
└── tsconfig.json
```

Run or validate a graph without Studio:

```bash
cascade validate index.cascade
cascade run index.cascade
```

See [Project authoring](doc/PROJECT_AUTHORING.md) for project layout, nodes, `.cascade` files, capabilities, and headless embedding.

Projects may also provide trusted, dockable Studio panels as plain TypeScript modules under `panels/`. These extensions remain outside graph documents and are never loaded by headless execution.

## Deterministic custom nodes

A node exports a literal interface and a typed computation:

```ts
import type { NodeDefinition, NodeExecutionContext } from 'cascade/contracts';

export const definition = {
  apiVersion: 1,
  label: 'Multiply',
  runsOn: 'portable',
  inputs: {
    value: { kind: 'data', type: 'float', default: 0 },
    factor: { kind: 'data', type: 'float', default: 2 }
  },
  outputs: {
    result: { kind: 'data', type: 'float' }
  }
} as const satisfies NodeDefinition;

export function execute(context: NodeExecutionContext<typeof definition>) {
  context.outputs.result.set(context.inputs.value * context.inputs.factor);
}
```

Cascade extracts `definition` from the TypeScript syntax tree. It does not import the module or run setup code to discover ports. This makes node interfaces deterministic for the compiler, Studio, CI, and code agents.

Every node declares where it runs:

- `portable` — usable by Node and browser hosts.
- `browser` — browser-only values or WebGL.
- `server` — filesystem, Python, shell, or other backend work.

Capabilities are declared in the definition and injected by the host. User node modules are trusted project code, not a security sandbox.

Existing dynamic nodes continue through Cascade's current Studio/CLI compatibility engine while projects migrate. The headless runtime accepts deterministic definitions only; malformed definitions never fall back to dynamic execution.

## Headless runtime

Applications can use the graph engine without loading Svelte or Studio:

```ts
import { createRuntime } from 'cascade/runtime';
import { createNodeRuntimeHost } from 'cascade/runtime/node';

const host = createNodeRuntimeHost({ modules, assets });
const runtime = createRuntime({ host });
const graph = await runtime.load(document);

await graph.setInput('multiply1', 'value', 21);
await graph.run({
  target: { kind: 'output', nodeId: 'multiply1', outputName: 'result' }
});

console.log(graph.getOutput('multiply1', 'result')); // 42
await graph.dispose();
await runtime.dispose();
```

The runtime supports inspection, inputs and props, presets, triggers, targeted or full runs, cancellation, event subscriptions, output retrieval, and disposal. Hosts decide which capabilities exist; Cascade never silently moves a stage between browser and server.

## Repository map

```text
packages/contracts/  dependency-free public types and schemas
packages/runtime/    environment-neutral graph runtime and adapters
src/editor/          optional Svelte Studio
src/nodes/           current built-in and legacy node implementation
src/engine/          current compatibility services
server/              project-scoped Node host and transports
tests/               behavior, workflow, security, and performance tests
spec/                accepted feature specifications
```

The root `cascade` package is the distribution and CLI owner. The two internal workspaces define architectural boundaries; they are not independently published until independent versioning or external consumption requires it.

## Subnets and `.cascade` files

Graph documents keep a flat list of nodes and annotations. Nested elements carry a `parent` ID, and their positions are relative to that subnet. IDs remain globally unique, so connections keep the same endpoint format across hierarchy levels.

Existing files without `parent` fields remain root-level graphs. Invalid parent references warn and fall back to the root rather than dropping authored elements.

## Security

Shell execution is server-only and allowlisted in the project’s `cascade.json`. Cascade passes a fixed executable and argument array to `spawn(..., { shell: false })`; it does not accept shell command strings or interpolation. Working directories are project-confined, input/output is bounded, dangerous request-time environment overrides are rejected, and cancellation terminates the process tree. Commands inherit the server environment, then apply project-configured and explicitly allowed request overrides.

The browser shell compatibility route exists only on loopback and requires exact Host/Origin checks plus a process-lifetime capability token. Remote-bound servers do not expose it.

## More documentation

- [Agent guide](AGENTS.md)
- [Project authoring](doc/PROJECT_AUTHORING.md)
- [Design source of truth](DESIGN.md)
- [Architecture](ARCHITECTURE.md)
- [Subnet and shell specification](spec/CASCADE_SUBNET_AND_SHELL_SPEC.md)

Inspired by Nodes.io, SideFX Houdini, TouchDesigner, Maya, Cinder, openFrameworks, and Processing.
