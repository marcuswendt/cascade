# Cascade

Cascade is a TypeScript node-graph runtime and optional visual workspace for generative design. It is built for projects that move between interactive web work, WebGL, print, motion, sound, Python, and external services without rebuilding the surrounding application infrastructure each time.

Created by Marcus Wendt at [FIELD.IO](https://www.field.io).

## What Cascade provides

- A typed, inspectable graph model with lazy execution and explicit triggers.
- Deterministic custom-node definitions that tools can inspect without running user code.
- The same runtime in Studio, a Node service, or a UI-free browser application.
- Project-native `.cascade` files, assets, presets, and Git-backed version history.
- Nested subnets with persistent hierarchy.
- Explicit browser and server capabilities for WebGL, files, media, Python, and allowlisted shell commands.
- A Svelte Studio with an infinite canvas, Inspector, Viewer, and project workbench.

Cascade separates the generative algorithm from the platform. Custom nodes describe stages of a pipeline; the runtime schedules and validates them; hosts supply environment-specific capabilities; Studio is only one possible frontend.

## Develop Cascade

Cascade development requires Node.js 22.13 or newer. The repository uses
TypeScript 6 and intentionally does not target the TypeScript 7 preview.

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

Useful checks:

```bash
npm run check
npm run test:run
npm --prefix server run build
npm run build
npm run build:cli
```

## Create a project

```bash
cascade new my-artwork
cd ~/Documents/Cascade/my-artwork
cascade .
```

Studio binds to loopback by default. To use a Cascade workstation over a
trusted VPN or LAN, opt into the bind address and exact browser hostname:

```bash
cascade . --host KURO --port 3030
```

Then open `http://KURO:3030`. Cascade uses a specific non-loopback `--host` as
both the bind target and allowed browser hostname. Use repeatable
`--trusted-host` only when the bind address and browser hostname differ.
Wildcard remote binds, unknown options, and invalid ports fail immediately.

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

`cascade check` also enforces the deterministic node boundary: no module-level runtime state, ambient globals or storage, top-level effects, dynamic imports, or imports from sibling node implementations. Project data belongs on typed wires. Props configure behavior, and declared capabilities provide the small set of host services a node is allowed to use. Caches may accelerate a wired computation, but cannot act as an unwired input.

Every node declares where it runs:

- `portable` — usable by Node and browser hosts.
- `browser` — browser-only values or WebGL.
- `server` — filesystem, Python, shell, or other backend work.

Capabilities are declared in the definition and injected by the host. User node modules are trusted project code, not a security sandbox.

A portable node may have equivalent browser and server executors behind the
same static definition. The runtime asks the registration for the concrete
host's executor, so the graph stays portable and contains no backend selector.
This is the intended pattern for media transforms such as crop or resize; use
shared parity tests to keep their outputs and metadata aligned.

Existing dynamic nodes continue through Cascade's current Studio/CLI compatibility engine while projects migrate. The headless runtime accepts deterministic definitions only; malformed definitions never fall back to dynamic execution.

Provider integrations are project code, not Cascade infrastructure. A project
can call a remote service from a Studio/browser node, invoke Python or an
allowlisted executable on the server, or provide a capability from an embedding
host. Results cross the graph as ordinary typed values such as `ImageRef` and
`AssetRef`. See [Project authoring](doc/PROJECT_AUTHORING.md#integrate-external-services-and-ai).

## Headless runtime

Applications can use the graph engine without loading Svelte or Studio:

```ts
import { createRuntime } from 'cascade/runtime';
import { createNodeRuntimeHost } from 'cascade/runtime/node';

const host = createNodeRuntimeHost({ modules, assets });
const runtime = createRuntime({ host });
const graph = await runtime.load(document);

await graph.setGraphInput('value', 21);
await graph.run({
  target: { kind: 'output', nodeId: 'graph-output', outputName: 'output' }
});

console.log(graph.getGraphOutput('result')); // 42
await graph.dispose();
await runtime.dispose();
```

Here `graph-input` and `graph-output` are typed `cascade.core.Input` and
`cascade.core.Output` nodes named `value` and `result`. They give an
embedded application a stable public boundary instead of requiring it to know
internal node IDs.

The runtime natively provides `Subnet`, `Input`, `Output`, `Switch`, `Merge`,
`Select`, seeded `Random`, and scalar `Remap`. These reserved core modules need
no project registration and run identically in Node and browser hosts. The
runtime also supports inspection, presets, triggers, targeted or full runs,
cancellation, event subscriptions, output retrieval, and disposal. Hosts
decide which capabilities exist; Cascade never silently moves a stage between
browser and server.

## Repository map

```text
packages/contracts/  dependency-free public types and schemas
packages/runtime/    environment-neutral graph runtime and adapters
src/editor/          optional Svelte Studio
src/nodes/           current built-in and legacy node implementation
src/engine/          current compatibility services
server/              project-scoped Node host and transports
scripts/             package build and release verification tooling
tests/               behavior, workflow, security, and performance tests
spec/                accepted feature specifications
doc/                 authoring guides and implementation plans
```

The root `cascade` package is the distribution and CLI owner. The two internal workspaces define architectural boundaries; they are not independently published until independent versioning or external consumption requires it.

Studio builds with Vite 8 and the Svelte plugin 7. It uses Dockview 8 through
the public `dockview` package. Monaco and its native editor/TypeScript workers
load only when a code panel opens. All rendered Markdown passes through one
Marked and DOMPurify boundary before entering the DOM.

## Subnets and `.cascade` files

Graph documents keep a flat list of nodes and annotations. Nested elements carry a `parent` ID, and their positions are relative to that subnet. IDs remain globally unique, so connections keep the same endpoint format across hierarchy levels.

Existing files without `parent` fields remain root-level graphs. Invalid parent references warn and fall back to the root rather than dropping authored elements.

## Security

Shell execution is server-only and allowlisted in the project’s `cascade.json`. Cascade passes a fixed executable and argument array to `spawn(..., { shell: false })`; it does not accept shell command strings or interpolation. Working directories are project-confined, input/output is bounded, dangerous request-time environment overrides are rejected, and cancellation terminates the process tree. Commands inherit the server environment, then apply project-configured and explicitly allowed request overrides.

Every project API requires an exact allowed Host. Present, hostile or null
Origins are rejected; same-origin requests may omit `Origin`, as browsers do
for ordinary GETs. Cascade never enables wildcard CORS for project data.
Filesystem paths are checked lexically and through real paths. The one explicit
secondary root is a project-owned `shared/` link used to discover reusable
panels.

Browser shell and process routes additionally require process-lifetime
capability tokens. They are available on loopback, or in an explicitly enabled
trusted-host session; an untrusted remote bind does not expose them.

## More documentation

- [Agent guide](AGENTS.md)
- [Project authoring](doc/PROJECT_AUTHORING.md)
- [Design source of truth](DESIGN.md)
- [Architecture](ARCHITECTURE.md)
- [Subnet and shell specification](spec/CASCADE_SUBNET_AND_SHELL_SPEC.md)

Inspired by Nodes.io, SideFX Houdini, TouchDesigner, Maya, Cinder, openFrameworks, and Processing.
