# Cascade agent guide

Cascade is a reusable generative-design graph runtime with an optional Studio UI. Keep authored algorithms independent from the editor so the same graph can run in Studio, on a server, or in a UI-free browser host.

## Start here

- `DESIGN.md` — product and architecture source of truth.
- `ARCHITECTURE.md` — repository boundaries and dependency direction.
- `packages/contracts/` — public types, deterministic node definitions, capabilities, and schemas.
- `packages/runtime/` — environment-neutral loading, validation, scheduling, and headless APIs.
- `src/editor/` — Svelte Studio only; never put runtime behavior here.
- `server/` — project-scoped Node host, compilation, assets, Python, and shell transport.
- `spec/` — accepted behavior specifications. Read the relevant spec before changing a file format or public API.
- `tests/` — executable behavior contracts, including performance and end-to-end authoring workflows.

## Project convention

A Cascade project is an ordinary directory or Git repository:

```text
my-project/
├── cascade.json          # optional host policy and project settings
├── index.cascade         # default graph; more .cascade files are allowed
├── nodes/
│   └── Multiply/
│       └── index.ts      # project.Multiply
├── assets/
├── panels/
│   └── AssetBrowser/
│       └── index.ts      # optional Studio-only project panel
├── package.json
└── tsconfig.json
```

Use `cascade new <name>` to create a project. Run `cascade .` from its root to open Studio, `cascade validate <graph.cascade>` for validation, `cascade check <graph.cascade>` for static definition/type checks, `cascade inspect <graph.cascade>` for a JSON summary, and `cascade run <graph.cascade>` for headless execution.

## Launch Studio

For a browser on the same machine, use the secure loopback default:

```bash
cascade . --port 3030
```

For a workstation reached by hostname over a trusted VPN or LAN, bind the
network interfaces and allow the exact hostname in the browser URL:

```bash
cascade . --host KURO --port 3030
```

Open `http://KURO:3030`. Before launching,
check that the intended port is free or belongs to the expected Cascade process;
never start a second instance on an occupied/default port or kill an unknown
process. Verify the named route after startup:

```bash
curl -fsS http://KURO:3030/health
curl -fsS http://KURO:3030/api/graph
```

Remote access is explicit: a specific non-loopback `--host` is also the default
trusted browser hostname. Use `--trusted-host` only when the bind address and
browser hostname differ. Hostnames are exact and case-insensitive; wildcard
binds are rejected. Unknown flags and invalid ports are fatal. Every peer that
can reach this interface can access trusted project APIs, so use an authenticated
private VPN/interface and never expose Studio directly to the public internet.

Project panels are trusted Studio extensions, not graph/runtime modules. Put them in `panels/<name>/index.ts`, type them from `cascade/studio/panel`, and return an instance disposer from `mount`. A parameter action such as `panel:asset-browser` opens one. Never import a project panel from a node, runtime host, or headless application.

## Create a deterministic node

Prefer a statically inspectable definition over legacy setup-time calls:

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

Definition rules:

- Export `definition` as a literal and `execute` as computation only.
- Keep the definition JSON-like. Parentheses, arrays, `as const`, and `satisfies` are valid; calls, spreads, computed properties, and imported constants are not.
- Declare `runsOn`: `portable`, `browser`, or `server`.
- For equivalent browser/server implementations, keep one portable definition
  and have the host registration select the executor. Never expose execution
  location as an artist parameter; parity-test the shared contract.
- Declare every capability used. File, Python, and shell access are server-only; WebGL is browser-only.
- Treat graph wires as the primary data boundary. A node may observe only its connected inputs, its props, and declared host capabilities; it must not inspect sibling nodes or the graph to discover data.
- Deterministic node modules may not retain module-level mutable values, access ambient state such as `globalThis`, browser storage, or `process`, run top-level effects, or import sibling node implementations. `cascade check` reports these as `architecture/*` diagnostics.
- A cache may memoize computation from wired inputs, but it must never supply unwired data. Make cache use an explicitly labelled prop and keep cache keys derived from the complete wired input and relevant props.
- Keep model/provider integrations in the project. Cascade core has no Google,
  Anthropic, OpenAI, or generic `ai` capability. Use normal typed outputs such
  as `image` or `asset`, and choose the actual execution path explicitly.
- Use exact Cascade core types or a namespaced project type such as `project.palette`.
- Never execute a module to discover its ports or metadata.

Use the runtime-native core vocabulary before creating a project wrapper:

- `cascade.core.Input` / `cascade.core.Output` define the public graph or subnet boundary.
- `cascade.core.Subnet` contains nested nodes.
- `cascade.core.Switch`, `Merge`, and `Select` provide deterministic routing.
- `cascade.core.Null` passes any value through unchanged so downstream wiring can remain stable while upstream branches are reorganized.
- `cascade.core.Random` maps explicit integer `seed` and `sample` inputs to a stable float in `[0, 1)`.
- `cascade.core.Remap` maps scalar ranges and optionally clamps via its `clamp` prop.

The geometry set is reserved the same way, under `cascade.geo.*`:
`Rectangle`, `Circle`, `Transform`, `Merge`, `CopyToPoints`, and `SvgExport`.
They all speak the one `geometry` type, so any output fits any input, and they
follow Houdini's parameter names where Houdini has an equivalent node. Geometry
is +Y up; the flip into SVG's frame lives in `SvgExport` alone.

These modules are reserved and need no file under `nodes/`. Do not override a
`cascade.core.*` module or use ambient random/time state in a portable node.

## Navigate and edit graphs

- `.cascade` documents keep nodes and annotations in flat arrays. Nested elements carry `parent: '<subnet-id>'`; their positions are relative to that subnet.
- Element IDs are globally unique. Connections address node and port IDs, not array positions.
- Preserve unknown metadata and existing source fields when editing a graph.
- Validate hierarchy, ports, and connections together. Do not partially mutate a live graph and then repair it.
- Use the runtime/controller APIs for structural edits when available; do not reach into `_elements`, `_children`, connection arrays, or editor stores.

## Boundaries

- Contracts have no runtime dependencies.
- Runtime depends only on contracts and contains no DOM, Svelte, Express, Node filesystem, or child-process imports.
- Hosts inject capabilities explicitly.
- Studio consumes runtime through its controller; custom frontends consume runtime directly.
- User modules are trusted project code, not a sandbox. Static definitions improve tooling and portability, not isolation.
- Keep legacy support inside the existing Studio/CLI compatibility engine; do not spread compatibility branches into the deterministic runtime.

## Change workflow

Use Node.js 22.13 or newer. Cascade compiles with TypeScript 6; do not move to
the TypeScript 7 preview until it is stable and the repository gates pass.

1. Add or update a focused regression test.
2. Make the smallest change at the owning layer.
3. Prefer deletion or an existing utility over another wrapper.
4. Run the focused test, then `npm run check`, `npm run test:run`, `npm --prefix server run build`, `npm run build`, and `npm run build:cli` when the affected surface warrants it. Keep the CLI build last because Vite refreshes `dist/`.
5. For package/public API changes, also test the packed tarball from an empty temporary project.

Do not add dependencies without a concrete need. Do not create extra packages unless they need independent publication or versioning.

## Versioning

Cascade `0.2.0` is the 2026 architecture rework. The current release is
`0.2.22`. Increment the root package and CLI patch version for every committed
feature or release change (`0.2.22`, `0.2.22`, …), keeping `package.json`, the
lockfile, and CLI output aligned. Internal private workspaces do not receive
independent versions unless they become separately published packages.
