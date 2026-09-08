# Cascade agent guide

Cascade is a reusable generative-design graph runtime with an optional Studio UI. Keep authored algorithms independent from the editor so the same graph can run in Studio, on a server, or in a UI-free browser host.

## Start here

- `DESIGN.md` — product and architecture source of truth.
- `ARCHITECTURE.md` — repository boundaries and dependency direction.
- `CHANGELOG.md` — what each release changed, newest first. Read it before assuming how a recent feature works.
- `doc/NODE_REFERENCE.md` — every built-in node with its declared ports, generated from the definitions. Read it instead of searching `src/nodes/` for what a node does; regenerate with `npm run build:node-reference` rather than editing it.
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
├── AGENTS.md             # written by `cascade new`; authoritative for that project
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

Use `cascade new <name>` to create a project and `cascade node <Name>` to scaffold a custom node in one. Run `cascade .` from a project root to open Studio, `cascade validate <graph.cascade>` for validation, `cascade check <graph.cascade>` for static definition/type checks, `cascade inspect <graph.cascade>` for a JSON summary, `cascade run <graph.cascade>` for headless execution, and `cascade run <graph.cascade> --frames 1-100` for an offline image sequence. `cascade projects` shows or sets the default projects directory.

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

Two node styles exist and both are supported. A **definition-v1** module exports a literal `definition` and a typed `execute(context)`; it is statically inspectable and is what `cascade check` requires. A **dynamic** module exports `execute(node, graph)` and declares its ports and parameters imperatively inside it. Studio cooks both through `src/nodes/definition/projectDefinition.ts`. The CLI supports stills and frame sequences for fully deterministic graphs and for supported dynamic graphs, but rejects graphs mixing the two execution styles. Prefer definition-v1 for new nodes; inspect a project's current modules before assuming its style. Do not call dynamic modules "legacy" in user-facing guidance.

A definition-v1 module looks like this:

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
- `context.nodeId` identifies the instance for namespaces such as `cachePath(context.nodeId, '.png')`; it does not grant access to siblings or hierarchy. A final output may instead have an artist-authored filename.
- Vector props support `min`, `max`, and `step`, shared across components. Props may declare a default `expression`; an explicitly saved value overrides that default, including when it equals the numeric default.
- WebGPU nodes declare the browser-only `gpu` capability and use its shared device and per-node `cache`. Import usage constants from `cascade/gpu`. GPU texture exchange and explicit readback through this capability remain future work; current GPU stages exchange images.
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
Time and randomness reach a parameter as an expression or a keyframe channel,
which is why a node reading the clock itself is still wrong.

Anything with an x and a y is **one** `vec2`, not two floats — likewise `vec3`
and `vec4`, and `vec2i`/`vec3i`/`vec4i` for integer counts and pixel sizes.
Positions, offsets, sizes, scales and resolutions are single ports. Two floats
that are really one vector cannot connect to a `vec2` output, cost two
Inspector rows and two keyframes, and let a graph carry an x without its y. The
type system knows what a `vec2` is; nothing tells it that `offset_x` and
`offset_y` are related. Split them only when the components differ in kind.

## Animation, expressions, and parameters

- **`resolvePropBinding` in `packages/runtime/src/params/resolve.ts` owns binding precedence:** channel, expression, value. Studio's `Node.evalParm` and the neutral runtime both call it with their own expression scope and frame. Never read `prop.value` to obtain an animated parameter or implement a second precedence rule.
- **A parameter is one store.** `param()` declares the parameter; the value, the expression and the channel live in the prop of the same name. `NodeParameter.value` reads *resolved*; `rawParameterValue()` reads what the author typed, and is what serialization and cache keys must use. `param()` is re-declared on every cook of a dynamic node, so it must stay idempotent — it may never reset a value, an expression, or a channel.
- **Mechanisms belong to the runtime, composition to the host.** `packages/runtime/src/expressions` owns preprocessing, scope and the maths library; `packages/runtime/src/animation` owns the channel model, sampling, interpolation, serialization and frame-range walking. Both depend only on contracts. Do not implement interpolation, a frame clock, or a second `$T` anywhere else.
- **The serialized shape is owned by contracts** (`packages/contracts/src/animation.ts`): a channel is `{ keys: [{ frame, value, interpolation? }] }` inside the node's `props`, with `interpolation` omitted when it is the `smooth` default. There is no timeline section in the document, and adding one would need reconciling on every rename, delete and embed.
- Bare trigonometry is **radians**, deliberately unlike Houdini; `sind`/`cosd`/`tand`/`radians()`/`degrees()` exist for formulae carried over. Only `ch()`, `chs()` and `chv()` are scanned for dependencies, so a new way to reach another parameter also needs a dependency pattern or it will not recook.
- The deterministic runtime resolves parameter animation through `setFrame`, `setFps`, and `run({ frame, fps })`. `cascade run --frames` supports fully definition-v1 graphs when the Node host can supply their capabilities. A browser-only node still cannot run in that host.
- Studio's timeline supplies the playhead and fps to the engine; its range and loop setting are panel state. Parameter channels are saved in the document, but playback settings are not.

## Agent sessions

`server/src/agent` is a project host service at the same layer as shell and Python, under the same policy. Read the file headers there before changing it; they carry the reasoning.

- A run is keyed by agent alias and document, and **owned by the server**. The request that starts it is only the first reader, and a closed socket detaches a reader. Never tie a run's lifetime to a request: a browser reload sending SIGTERM to an agent mid-edit is the fault this design exists to prevent.
- The server drains the child's stdout whether or not anyone is attached. An unread pipe strands the agent.
- The transcript is a bounded ring with absolute sequence numbers. A reader attaches with `since`, gets one `attached` event carrying `running`, `replayed` and `dropped`, then the replay and the live stream with nothing awaited in between. Report `dropped` rather than hiding it; a transcript that silently loses its middle reads as an agent that did something inexplicable.
- Executables resolve server-side from the `commands` allowlist in `cascade.json` — the shell service's allowlist, deliberately the same one. A path from the browser is never accepted, and `agent.<alias>.args` supplies fixed flags. The routes need the capability token and are absent when sensitive capabilities are not allowed, so transport is NDJSON over POST rather than SSE.
- Cancellation signals the process group, because agents spawn children.
- Freshness is a watcher, not a poll: `server/src/graphWatch.ts` publishes `.cascade` changes over SSE and `src/editor/graphDocumentWatch.ts` fingerprints the document with volatile metadata stripped, so Studio's own save does not return as an external change. A reload is declined while there are unsaved edits rather than picking a winner.

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
- Studio uses `StudioGraphController` over its compatibility `Graph`/`Node` engine and reuses runtime mechanisms. Custom frontends consume the neutral runtime directly; full Studio migration remains incomplete.
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
6. When a built-in definition or a node library registry changes, regenerate the node reference with `npm run build:node-reference` and commit the result. `build:cli` runs it too, so a full build will produce the diff whether or not you meant to. Nothing tests that the committed file is current, so a stale one ships silently — and it is the first thing a project's agent reads.

Do not add dependencies without a concrete need. Do not create extra packages unless they need independent publication or versioning.

## Versioning

Cascade `0.2.0` is the 2026 architecture rework; `0.3.0` added animation and the
agent console. Read `package.json` for the checkout version and `CHANGELOG.md`
for release history and unreleased changes; a local build can contain changes
not yet in the published package. Update the changelog before a release commit. Increment the
root package and CLI patch version for every committed feature or release
change, keeping `package.json`, the lockfile, and CLI output aligned. A minor
bump is for a feature large enough to need its own `CHANGELOG.md` section.
Internal private workspaces do not receive independent versions unless they
become separately published packages.
