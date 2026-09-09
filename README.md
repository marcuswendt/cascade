# Cascade

Cascade is a TypeScript node-graph runtime and optional visual workspace for generative design. It is built for projects that move between interactive web work, WebGL, print, motion, sound, Python, and external services without rebuilding the surrounding application infrastructure each time.

Created by Marcus Wendt at [FIELD.IO](https://www.field.io).

## What Cascade provides

- A typed, inspectable graph model with lazy execution and explicit triggers.
- Deterministic custom-node definitions that tools can inspect without running user code.
- An environment-neutral runtime for Node services and UI-free browser applications.
- A Studio compatibility controller that already presents deterministic definitions alongside dynamic project nodes while its graph engine migrates to the neutral runtime.
- Project-native `.cascade` files, assets, presets, and Git-backed version history.
- Nested subnets with persistent hierarchy.
- Geometry-native particles, explicit Feedback loops, bounded simulation checkpoints, and printable trail geometry.
- Scenes with cameras and lights, a 3D Viewer, and shared CPU wireframe/point rendering.
- Expressions on parameters, with Houdini's variables and functions: `$F`, `$FF`, `$T`, `$FPS`, and `ch()` to read another parameter.
- Keyframe channels on parameters, edited through a timeline panel with transport, playhead, scrubbing, and a dope sheet.
- Offline rendering with `cascade run`, including `--frames 1-100` for a numbered image sequence, rasterised through Skia rather than a browser.
- A coding-agent console per project, running in the project directory, with a watcher that picks up the files it rewrites without a reload.
- Explicit browser and server capabilities for WebGPU, files, media, Python, and allowlisted shell commands.
- A Svelte Studio with an infinite canvas, Inspector, Viewer, timeline, and project workbench.

Cascade separates the generative algorithm from the platform. Custom nodes describe stages of a pipeline; the runtime schedules and validates them; hosts supply environment-specific capabilities; Studio is only one possible frontend.

## Install

Cascade needs Node.js 22.13 or newer.

```bash
npm install -g @field/cascade
cascade --version
```

That installs the latest published release and the `cascade` command: `cascade new` scaffolds a project, `cascade <directory>` opens it in Studio, and `cascade run` executes a graph headlessly. A generated project records the published package under the local alias `cascade`, so imports such as `cascade/contracts` resolve to `@field/cascade`.

The repository checkout can be ahead of the published release, even with the same version number. Use the global install to scaffold projects, then use their npm scripts or `npx --no-install cascade` to select the project-local version. For checkout development, see [Contributing](CONTRIBUTING.md). When diagnosing a difference, record the installed version and whether it resolves to a local checkout; a version match alone does not prove the same code is installed.

Offline image rendering uses Skia through `@napi-rs/canvas`, an optional dependency of about 26 MB. It installs by default; if you skipped optional dependencies, add it yourself:

```bash
npm install -g @napi-rs/canvas
```

Inside a project, `cascade` is aliased to this package, so a node importing `cascade/contracts` or `cascade/runtime` resolves here rather than to the unrelated `cascade` package on npm.

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

`cascade new` scaffolds a project and starts Studio. After stopping that first
server, install the project's dependencies before reopening it. The example
below assumes the default projects directory; `cascade projects` reports yours.

```bash
cascade new my-artwork
cd ~/Documents/Cascade/my-artwork
npm install
npx --no-install cascade .
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

An HTTPS reverse proxy may terminate TLS and forward to a loopback Studio. In
that case, name both sides explicitly:

```bash
cascade . --host 127.0.0.1 --port 3030 --trusted-host cascade.example.internal
```

The proxy must preserve the browser's exact `Host`. If the external URL uses a
non-default port, include it in `--trusted-host`. Use `--no-open` and open the
HTTPS URL yourself: automatic opening still uses an HTTP URL. This flag admits
the authority; it does not configure TLS or the proxy itself.

A project is an ordinary directory or Git repository:

```text
my-artwork/
├── cascade.json          # optional host policy and settings
├── index.cascade         # default graph
├── AGENTS.md             # written by `cascade new`: what an agent working here needs
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

## Publish a browser sketch

The checkout's standalone player exports compatible definition-v1 graphs to
static files, without Studio or a Cascade server:

```bash
cascade build index.cascade --out web-player
```

Serve the generated directory through a static HTTP server or hosting service.
Open `index.html`, embed `player.html` in an iframe, or import `embed.js` for
same-origin controls. Server/Python/shell-dependent graphs must first separate
or replace those stages; export does not move them into the browser silently.
See [Browser player](doc/WEB_PLAYER.md) for assets, inputs, animation and limits.
This workflow is unreleased; use the built checkout rather than assuming the
published package contains it.

Projects may also provide trusted, dockable Studio panels as plain TypeScript modules under `panels/`. These extensions remain outside graph documents and are never loaded by headless execution.

## Animation

A parameter can hold three things, and they resolve in one place in this order: a **keyframe channel** first, then an **expression**, then the raw **value**. A channel therefore takes over from an expression without erasing it: the expression stays on the parameter, inert, and comes back when the channel is emptied.

Expressions use Houdini's vocabulary, because that is the vocabulary the people using this already have:

| | |
| --- | --- |
| `$F` | frame, integer |
| `$FF` | frame, fractional |
| `$T` | seconds, zero on frame 1, as `($FF - 1) / $FPS` |
| `$FPS` | frame rate |
| `ch("NODE/parm")`, `ch("./parm")` | read another parameter; `chs()` for a string, `chv()` for a vector |

The maths library is in scope bare, so it is `sin(x)` rather than `Math.sin(x)`: `sin cos tan asin acos atan atan2 sinh cosh tanh sqrt cbrt pow exp log log2 log10 hypot abs sign floor ceil round trunc min max` and the constants `PI`, `TAU`, `E`. **Angles are radians**, unlike Houdini, and `sind`, `cosd`, `tand`, `radians()` and `degrees()` are there for formulae carried over from it. Also available: `fit`, `fit01`, `clamp`, `lerp`, `smooth`, `noise`, `random`, `padzero`, `opexist` and `opinput`.

So the answer to anything time-based is usually an expression rather than a node. `sin($T) * 40` in a rotation parameter is the whole of an oscillator, and there is no oscillator node.

Keyframes are edited with Houdini's gestures on a parameter in the Inspector: **alt-click** sets a key at the playhead, **ctrl-click** deletes the key on the current frame, and **right-click** opens the Timeline focused on that channel. The diamond beside the parameter is the same thing for anyone not using a modifier, and it toggles. Interpolation is per key, applying to the segment to its right: `constant`, `linear`, or `smooth` (the default, a Hermite curve with automatic tangents, flat at the first and last key). Outside the keyed range a channel holds its end values rather than extrapolating.

Channels serialize into the node's `props`, beside the value and the expression:

```json
"props": {
  "angle": {
    "value": 12,
    "channel": { "keys": [{ "frame": 1, "value": 0, "interpolation": "linear" }, { "frame": 48, "value": 360 }] }
  }
}
```

The Timeline panel supplies transport, a playhead, scrubbing, and a dope sheet. Playback is wall-clock driven and drops frames rather than falling behind. The frame range and loop setting are panel state and are not saved with the document.

Rendering a sequence offline needs no browser:

```bash
cascade run index.cascade --frames 1-100
cascade run index.cascade --frames 1-100x2 --fps 25 --out frames
cascade run index.cascade --frames 42 --entry-node logo-1024
```

Frames are written as `<out>/<node id>.<frame>.<ext>`, zero-padded to at least four digits, into `renders/` unless `--out` says otherwise. One rule regardless of how many outputs the graph has, because a graph writing the same mark at three sizes from one cook is the normal case. Every image output with nothing downstream of it is saved, or the outputs of `--entry-node` when one is named. Cascade stops at the sequence; a directory of numbered frames is what every encoder already takes.

Drawing offline goes through Skia rather than a browser. The optional `@napi-rs/canvas` supplies `OffscreenCanvas`, `Image`, `Path2D` and the rest as globals in the Node process, deliberately not `document`, since that is how a node detects its host. So a node that draws on an `OffscreenCanvas` needs no separate headless implementation, and the built-in `cascade.image.*` library rasterises through Skia in Node too, so a graph built from it renders headlessly with no browser involved. A run without the renderer installed still works for graphs that draw nothing, and says what is missing if a cook fails in a canvas-shaped way.

`--frames` works for an all-dynamic graph and for an all-definition-v1 graph. Definition-v1 runs resolve stored expressions and keyframe channels from the explicit `frame` and `fps` supplied to each deterministic run. A CLI graph that mixes the two node styles is rejected explicitly because there is not yet a bounded adapter between the execution engines.

## The agent console

Studio has a panel that runs a coding agent inside the project directory, so the agent edits the same `nodes/` and `.cascade` files the graph is loaded from. The document is saved before the prompt is sent, and a watcher on the project's `.cascade` files reloads the graph in place when the agent rewrites it — no page reload, and Studio declines the reload rather than discarding unsaved edits.

Nothing is launchable until the project says what may be launched. The agent command comes from the same `commands` allowlist `cascade/shell` uses, in the project's `cascade.json`, and a scaffolded project ships without one:

```json
{
  "name": "My Artwork",
  "commands": { "claude": "claude" },
  "agent": { "claude": { "args": ["--permission-mode", "acceptEdits"] } }
}
```

`commands` maps an alias to an executable: an absolute path, a `~`-relative path, or a bare name found on `PATH`. Paths supplied by the browser are never accepted. `agent.<alias>.args` adds fixed flags for that agent; `claude` defaults to `--permission-mode acceptEdits`, and an explicit empty array launches it bare.

A run belongs to the server rather than to the HTTP request that started it. Closing the browser detaches a reader and leaves the agent working; reopening the panel replays the buffered transcript and rejoins the live stream. The buffer is bounded (2,000 events or 4 MB, oldest evicted), a run has a fifteen-minute timeout, and cancelling terminates the agent's whole process group because agents spawn children. One run at a time per document; a second prompt is refused rather than queued.

The console is a sensitive route. It is available on loopback or in an explicitly enabled trusted-host session, requires a process-lifetime capability token, and the agent process is started with `shell: false` and without the environment variables that would let it reach a chat channel.

Node and parameter names in the graph and Inspector are drag sources carrying the expression address that names them, `TRANSFORM` for a node and `TRANSFORM/tx` for one of its parameters, so a path can be dragged into the console instead of retyped.

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

There is a second node style, and it is not deprecated. A **dynamic** module exports `execute(node, graph)` and declares its ports and parameters imperatively inside it, as `node.param('size', 1024, { min: 16, max: 4096 })`, running once for discovery and again on every cook. Studio cooks both styles and a Studio graph may mix them through its compatibility controller. The CLI uses the deterministic runtime for an all-definition-v1 document and the compatibility engine for an all-dynamic document; it rejects a mixed document. `cascade check` requires definition-v1 modules because it inspects them statically. A malformed definition never falls back to dynamic execution — it is reported. A project's own `AGENTS.md`, written by `cascade new`, states which style that project expects.

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
`Select`, `Null`, seeded `Random`, and scalar `Remap`. These reserved core modules need
no project registration and run identically in Node and browser hosts. The
runtime also supports inspection, presets, triggers, targeted or full runs,
cancellation, event subscriptions, output retrieval, and disposal. Hosts
decide which capabilities exist; Cascade never silently moves a stage between
browser and server.

The same definitions expose the initial `cascade.geo.*` library in Studio and
headless hosts: `Rectangle`, `Circle`, `Transform`, `Merge`, `CopyToPoints`,
and `SvgExport`. Their definitions, ports, and executors are runtime-owned;
Studio adapts them through its compatibility controller instead of maintaining
a second set of node algorithms.

## Current capability boundaries

| Surface | Current status |
| --- | --- |
| Studio authoring | Supports dynamic and definition-v1 nodes in one document through the compatibility controller. |
| Headless CLI | Executes all-definition-v1 or all-dynamic documents; mixed documents are rejected. Both styles can render frame sequences. |
| Embedded runtime | `cascade/runtime` is the neutral definition-v1 API for Node and browser hosts. It does not load Studio or interpret dynamic nodes. |
| GPU | Studio and the optional Dawn CLI host provide a shared device, adapter metadata, limits, and per-node caches. Portable GPU nodes render offscreen and explicitly read RGBA8 pixels through `cascade/gpu`; graph ports still carry images. See [headless GPU rendering](doc/HEADLESS_GPU.md). |
| Standalone HTML export | The existing Studio exporter uses a separate minimal runtime and supports only a subset of graph behavior. Treat it as an experimental convenience, not as a universal deployment artifact. |
| External services | Project-owned and optional. Cascade itself requires no paid provider or model subscription. |

## Repository map

```text
packages/contracts/  dependency-free public types and schemas
packages/runtime/    environment-neutral graph runtime and adapters
src/editor/          optional Svelte Studio, including the timeline and agent panels
src/nodes/           current class-based built-in node libraries (core, geo, image)
src/engine/          current compatibility services
src/cli/             the `cascade` command: new, validate, check, inspect, run, Studio
server/              project-scoped Node host and transports, including the agent session host
scripts/             package build, node-reference generation, and release verification tooling
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

- [Changelog](CHANGELOG.md)
- [Agent guide](AGENTS.md)
- [Project authoring](doc/PROJECT_AUTHORING.md)
- [Node reference](doc/NODE_REFERENCE.md) — every built-in node and its declared ports, generated from the definitions
- [Design source of truth](DESIGN.md)
- [Architecture](ARCHITECTURE.md)
- [Browser player](doc/WEB_PLAYER.md)
- [September quality review and sketch verification](doc/QUALITY_REVIEW_2026-09.md)
- [Subnet and shell specification](spec/CASCADE_SUBNET_AND_SHELL_SPEC.md)

Inspired by Nodes.io, SideFX Houdini, TouchDesigner, Maya, Cinder, openFrameworks, and Processing.
