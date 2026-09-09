# Authoring Cascade projects

Cascade projects are filesystem-native. The graph, custom nodes, assets, presets, and host policy live together in an ordinary repository, while Cascade supplies the stable runtime and optional Studio workspace.

## Create and open a project

`cascade new` scaffolds and starts Studio. Stop that initial server before
installing dependencies and reopening the project. This example assumes the
default projects directory; use `cascade projects` to check your configured path.

```bash
cascade new my-artwork
cd ~/Documents/Cascade/my-artwork
npm install
npx --no-install cascade .
```

For a workstation reached by name over a trusted VPN or LAN, bind deliberately
and allow the exact hostname used by the browser:

```bash
cascade . --host KURO --port 3030
```

Open `http://KURO:3030`. Loopback remains the default. Cascade trusts the
specific non-loopback bind hostname; `--trusted-host` is only needed when the
browser uses a different hostname. Wildcard remote binds are rejected.

For an HTTPS reverse proxy that terminates TLS and forwards to loopback, bind
loopback explicitly and allow the exact external hostname:

```bash
cascade . --host 127.0.0.1 --port 3030 --trusted-host cascade.example.internal
```

The proxy must preserve that `Host` value; include a non-default external port
in `--trusted-host` when applicable. Add `--no-open` and visit the HTTPS URL
yourself, since automatic opening still constructs an HTTP URL. Cascade does not configure the
proxy or certificate; the explicit trusted host only admits its browser
authority while the server remains unreachable directly from the network.

Cascade and generated projects require Node.js 22.13 or newer. Generated
projects use TypeScript 6 so their static node definitions match Cascade's
compiler and definition extractor.

`cascade new` writes a project-local dependency named `cascade` which aliases
the published `@field/cascade` package. Install it before using the project's
npm scripts:

```bash
npm install
npm run check
npm run validate
```

That dependency uses a caret range in the CLI's current minor line; the lockfile
records the resolved version. A local Cascade repository may contain newer
work even with the same version number. Record both the version and whether
the project resolves a checkout or a published package when diagnosing a
difference. Use a deliberate local package override
for framework development rather than committing a machine-specific
`file:../../Dev/cascade` dependency to a shared project.

`index.cascade` is the default graph name. A project may contain several `.cascade` files; pass one explicitly when there is no unambiguous default:

```bash
cascade print.cascade
```

The portable project shape is:

```text
my-artwork/
├── cascade.json
├── index.cascade
├── AGENTS.md            # written by `cascade new`, for agents working in the project
├── nodes/
├── panels/              # optional Studio-only extensions
├── assets/
├── package.json
└── tsconfig.json
```

Keep generated output in a project-specific directory such as `renders/`. Keep reusable algorithms in `nodes/` or a normal TypeScript package rather than in Studio components.

## Add a project panel

A project can provide an optional dockable Studio panel without adding UI code to Cascade. Create `panels/asset-browser/index.ts`:

```ts
import type { ProjectPanelApi } from 'cascade/studio/panel';

export const title = 'Assets';
export const icon = 'Images';

export function mount(element: HTMLElement, api: ProjectPanelApi) {
  const button = document.createElement('button');
  button.textContent = 'Use selected asset';
  button.onclick = () => {
    if (api.sourceNodeId) api.setParam(api.sourceNodeId, 'asset_id', 'asset-42');
    api.close();
  };
  element.append(button);
  return () => button.remove();
}
```

Panels are trusted browser code. Cascade discovers literal `title`, `icon`, and optional `rendererTypes` exports without executing the module, then compiles it only when Studio needs it. `mount` may be async and returns an instance disposer; `api.signal` aborts when its dock closes. Panels can call project stages, build media URLs, read/write node parameters, inspect selection, or close themselves.

Reusable panels may live under `shared/panels/`. `shared/` may be a directory or
a project-owned symlink to a sibling library; Cascade confines panel discovery
and compilation to that link's canonical target. A project-local panel with the
same name still wins.

The same module can provide project-owned value renderers without teaching Cascade about project data types:

```ts
export const rendererTypes = ['my-project.asset'];

export const renderers = {
  'my-project.asset': {
    mount(element, props) {
      const draw = ({ value }) => { element.textContent = String(value ?? ''); };
      draw(props);
      return { update: draw, dispose: () => element.replaceChildren() };
    }
  }
};
```

Each renderer instance owns its cleanup. An optional `update` method receives later values without remounting.

To open a panel from the Inspector, add an action prop to a definition-v1 node:

```ts
props: {
  asset_id: {
    type: 'string', default: '', label: 'Choose asset',
    action: 'panel:asset-browser'
  }
}
```

The initiating node ID is captured as `api.sourceNodeId`; `setParam` uses the same history/dirty/cook path as the Inspector, so undo and save continue to work. Panels and project value renderers are Studio-only and are never imported during `cascade run` or by `cascade/runtime`.

## Project settings and credentials

`cascade.json` describes the whole folder, so every `.cascade` graph in the repository sees the same non-secret settings:

```json
{
  "name": "My Artwork",
  "credentials": ["image-api"],
  "settings": { "workingWidth": 1400, "outputUnits": "mm" }
}
```

Read settings without giving nodes write access:

```ts
import { config } from 'cascade/config';
const width = config.number('workingWidth', 1400);
```

Credential values never belong in the project. Cascade reads them from `~/.cascade/credentials.yaml` (or `CASCADE_CREDENTIALS`) and reports only whether each declared name is set. Server stages receive declared values through environment variables. A Studio/browser project node can use Cascade's compiler-injected authorized proxy:

```ts
import { authorizedFetch } from 'cascade/net';
const response = await authorizedFetch('image-api', 'https://api.example.com/v1/render', {
  method: 'POST', body: JSON.stringify(payload)
});
```

`cascade/net` is a published host bridge backed by the Studio server's
`/api/net` route when project code is compiled by Cascade. It is not a neutral
runtime capability and has no useful authority without that installed bridge.
A standalone headless host must provide its own remote-I/O adapter or run the
integration through an injected shell, Python, or application-specific server
bridge.

Browser proxy credentials must declare the exact allowed hosts and header metadata alongside the secret:

```yaml
image-api:
  api_key: "..."
  env: IMAGE_API_KEY
  hosts: [api.example.com]
  header: Authorization
  scheme: Bearer
```

The proxy accepts HTTPS only, refuses undeclared hosts, strips caller-supplied authorization headers, and never returns the credential value to the page. Studio defers its initial cook when a required credential is missing and links to File → Project Settings.

## Add a custom node

Before writing one, check whether you need one. A parameter can hold an expression, so anything time-based is usually a parameter rather than a node. See [Animate a parameter](#animate-a-parameter). A node earns its place when it produces geometry or pixels, or when several parameters share a computation. The built-in library is listed in `NODE_REFERENCE.md`, generated from the definitions themselves; read that before searching for what a node does.

There are two styles. Write **definition-v1** for anything new; the dynamic style is what existing project nodes use and it still cooks everywhere.

| | Cooked by | Checked by |
| --- | --- | --- |
| **definition-v1**: a literal `definition` plus `execute(context)` | the deterministic runtime through `cascade run`, including `--frames`; Studio adapts it into its compatibility controller | `cascade check`, which requires this style |
| **dynamic**: `execute(node, graph)` declaring its own ports and parameters | Studio and the CLI compatibility engine, including `--frames` | `cascade validate` and a cook |

Studio cooks both, and a Studio graph may mix them. `cascade run` picks one host
per document: an all-definition-v1 graph runs through the deterministic
runtime and an all-dynamic graph runs through the compatibility engine. A
mixed CLI document is rejected until the bounded adapter between those engines
exists. Both homogeneous forms support `--frames`; deterministic runs receive
an explicit frame and fps so expressions and keyframe channels resolve
reproducibly. The `AGENTS.md` that `cascade new` writes into a project states
which style that project expects, and it is the file to believe over this one
for a specific project.

### definition-v1

Create `nodes/Multiply/index.ts`. The directory name defines the module ID `project.Multiply`.

```ts
import type { NodeDefinition, NodeExecutionContext } from 'cascade/contracts';

export const definition = {
  apiVersion: 1,
  label: 'Multiply',
  description: 'Scales a numeric value.',
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

The definition is the complete static interface. Cascade and code agents can inspect it without importing the module, build the node UI, validate graph connections, and type-check `execute`. In this style `execute` computes and nothing else: it does not create ports, props, or types.

Parameters are declared as `props`, beside `inputs` and `outputs`, and each takes a `type` and a `default` plus optional `label`, `description`, `min`, `max`, `step`, `control`, `options`, and `accept`:

```ts
export const definition = {
  apiVersion: 1,
  label: 'Blend',
  runsOn: 'portable',
  inputs: { value: { kind: 'data', type: 'float', default: 0 } },
  props: { blend: { type: 'float', default: 0.5, min: 0, max: 1, label: 'Blend' } },
  outputs: { result: { kind: 'data', type: 'float' } }
} as const satisfies NodeDefinition;
```

#### Prefer the vector types

Anything with an x and a y is **one** `vec2`, not two floats. `vec3` and `vec4` likewise, with `vec2i`, `vec3i` and `vec4i` for integer counts and pixel sizes. Positions, offsets, sizes, scales, resolutions and colours with alpha are single ports.

```ts
// Two props that are really one value
props: { offset_x: { type: 'float', default: 0 }, offset_y: { type: 'float', default: 0 } }

// One prop the type system understands
props: { offset: { type: 'vec2', default: [0, 0] } }
```

The reason is not tidiness. Two floats cannot connect to a `vec2` output, take two Inspector rows instead of one control, need two keyframes to animate one movement, and allow a graph to carry an x without its y. The type system knows what a `vec2` is; nothing tells it that `offset_x` and `offset_y` belong together.

Keep them separate only when the components differ in kind or in range — a `width` and a `depth` that mean different things are two props, not a `vec2`.

### dynamic

A dynamic module declares its interface imperatively, inside `execute`, which runs once to discover the interface and again on every cook. There is no `definition` export; `runsOn` and `icon` are plain exports.

```ts
import { saveImage, cachePath } from 'cascade/io';

export const icon = 'Circle';        // a Lucide icon name
export const runsOn = 'portable';    // 'portable' | 'browser' | 'server'

export async function execute(node: any) {
  const size = node.param('size', 1024, { min: 16, max: 4096, step: 16, type: 'int' }).value;
  const input = node.in('value', 0, { type: 'float' }).value;
  const out = node.out('image', 'param', { type: 'image' });

  const canvas = new OffscreenCanvas(size, size);
  // ... draw ...
  const path = await saveImage(canvas, cachePath(node.id, '.png'));
  out.setValue({ path, size: [size, size], channels: 'rgb', depth: 'u8', space: 'srgb' });
}
```

`param()` is a method on the node the engine hands to `execute`, not an import. It is re-declared on every cook, so it never resets a value, an expression, or a keyframe someone set: reading `.value` gives the *resolved* value for the current frame, whichever of the three bindings is in force. The loader imports the module as real JavaScript, so top-level code does run at import time. Keep dynamic modules free of top-level effects and put interface declaration and cooking inside `execute`.

Prefer `new OffscreenCanvas(width, height)` to `document.createElement('canvas')` when both hosts can run the node. A portable declaration still requires output parity checks; installing Skia does not override a browser-only declaration. Use Python for libraries or tools that require a server. Measure transport, serialization, and cold-start costs; persistent workers can avoid repeated process/model startup.

Choose the narrowest execution locus:

- `portable` — deterministic TypeScript with host-neutral capabilities; usable in Node and browsers.
- `browser` — browser-only values or WebGL.
- `server` — filesystem, Python, shell, or other server-only work.

Capabilities are explicit:

```ts
export const definition = {
  apiVersion: 1,
  runsOn: 'server',
  capabilities: ['python'],
  inputs: { prompt: { kind: 'data', type: 'string', default: '' } },
  outputs: { result: { kind: 'data', type: 'object' } }
} as const satisfies NodeDefinition;
```

The runtime refuses unsupported host/capability combinations before executing the graph.

### GPU nodes today

A definition-v1 node may declare `capabilities: ['gpu']`. Studio and the optional
Dawn CLI host provide one shared `GPUDevice`, adapter identity and limits, plus
a cache scoped to each node instance for pipelines, samplers, and other
resources that outlive one cook. The host clears cached resources on host
disposal or device loss and requests a fresh device on a later cook.

Use `runsOn: 'portable'` for shared WebGPU code without browser APIs. Render into
a texture and use `readTexture` from `cascade/gpu` for explicit RGBA8 pixels,
then encode through the image/IO host. See [headless GPU rendering](HEADLESS_GPU.md)
for CLI/agent commands, restrictions and tests.

This is the first GPU capability stage. Texture connections are not available:
GPU nodes still publish images, so an image must be encoded or read back before
another node receives it. Do not model a current graph as a chain of portable
texture handles, and do not keep a device or pipeline in module-level mutable
state.

Some portable operations have genuinely useful browser and server
implementations. Keep one literal definition and one module ID; let the host's
registration load the implementation for its environment. Do not add an
`engine: browser | server` graph parameter or duplicate the node type. The two
executors are an implementation detail and must produce the same declared
types, coordinate conventions, metadata, and edge-case behavior. Lock that
contract with shared golden tests. Use a graph parameter only when the choice
changes the artistic result, cost, or model—not merely where equivalent work
runs.

## Use runtime-native core nodes

Core modules are reserved runtime registrations; do not create files for them
under `nodes/`:

| Module | Purpose |
| --- | --- |
| `cascade.core.Input` | Public root or subnet input |
| `cascade.core.Output` | Public root or subnet output |
| `cascade.core.Subnet` | Nested graph container |
| `cascade.core.Switch` | Select one variadic input by index |
| `cascade.core.Null` | Pass any value through unchanged while retaining downstream wiring |
| `cascade.core.Merge` | Collect variadic inputs into an array |
| `cascade.core.Select` | Select an array item, with optional wrapping |
| `cascade.core.Random` | Stable float in `[0, 1)` from explicit `seed` and `sample` integers |
| `cascade.core.Remap` | Scalar range mapping with optional `clamp` prop |

Use root Input and Output nodes as the graph's named, typed public API for headless hosts.
Keep implementation nodes behind that boundary so a server or custom frontend
does not depend on internal IDs. A child Input/Output node's index defines the
matching `input_N`/`output_N` port on its parent Subnet.

Portable nodes must not read ambient time or randomness. Time reaches a node as
an expression or a keyframe on a parameter, or through a root input; variation
comes from seeded `Random`.

`NODE_REFERENCE.md` carries the full declarations for these and for the
`cascade.geo.*` set, generated from the definitions, so the table above is a
summary rather than the source.

## Animate a parameter

A parameter holds up to three things, and they resolve in one order: a **keyframe channel** first, then an **expression**, then the stored **value**. A channel therefore overrides an expression without erasing it: empty the channel and the expression comes back.

Expressions use Houdini's variables:

| | |
| --- | --- |
| `$F` | frame, integer |
| `$FF` | frame, fractional |
| `$T` | seconds, zero on the first frame — `($FF - 1) / $FPS` |
| `$FPS` | rate |
| `ch("NODE/parm")`, `ch("./parm")` | read another parameter; `chs()` for a string, `chv()` for a vector |

The maths library is in scope bare, so `sin(x)` rather than `Math.sin(x)`, with `PI`, `TAU` and `E`. Note that **angles are radians**; `sind`, `cosd`, `tand`, `radians()` and `degrees()` are there for formulae carried over from Houdini. `fit`, `fit01`, `clamp`, `lerp`, `smooth`, `noise`, `random`, `padzero`, `opexist` and `opinput` are available too.

So "oscillate the angle" is `sin($T) * 40` in the `angle` parameter. There is no oscillator node and none is needed. Only `ch()`, `chs()` and `chv()` create a dependency, so a parameter that reads another one recooks when it changes.

Keyframes are set on a parameter in the Inspector: **alt-click** sets a key at the playhead, **ctrl-click** deletes the key on the current frame, **right-click** opens the Timeline focused on that channel, and the diamond beside the parameter toggles a key for anyone not using a modifier. Interpolation belongs to the key on the left of a segment and is `constant`, `linear`, or `smooth`. Smooth is the default: a Hermite curve with automatic tangents, flat at the first and last key. Outside the keyed range the channel holds its end values.

In the document, a channel sits in the node's `props` next to the value and the expression, and `interpolation` is omitted where it is the `smooth` default:

```json
"props": {
  "angle": {
    "value": 12,
    "expression": "sin($T) * 40",
    "channel": { "keys": [{ "frame": 1, "value": 0, "interpolation": "linear" }, { "frame": 48, "value": 360 }] }
  }
}
```

Definition-v1 parameter values belong under `props`: use a bare value for an
unbound parameter or the object form for an expression/channel. A leftover
`params` array is not read by the deterministic runtime and produces a
`runtime/stray-params` warning. Playback settings, frame range, and loop belong
to the Timeline panel and are not saved with the document.

## Run a coding agent in the project

Studio can run a coding agent in the project directory, editing the same `nodes/` and `.cascade` files the open graph came from. The document is saved before the prompt is sent, and a watcher reloads the graph in place when the agent rewrites it, so nothing needs a page reload. Studio declines that reload while there are unsaved edits rather than choosing a winner.

The project decides what may be launched, in `cascade.json`, using the same `commands` allowlist as shell aliases. A scaffolded project ships without one, so nothing is launchable until it is added:

```json
{
  "name": "My Artwork",
  "commands": { "claude": "claude" },
  "agent": { "claude": { "args": ["--permission-mode", "acceptEdits"] } }
}
```

An alias maps to an absolute path, a `~`-relative path, or a bare name on `PATH`; project-relative paths are refused. `agent.<alias>.args` adds fixed flags. `claude` defaults to `--permission-mode acceptEdits`, and an explicit empty array launches it bare. The routes are only available on loopback or in an explicitly enabled trusted-host session.

The run belongs to the server rather than the browser: closing the tab leaves the agent working, and reopening the panel replays the buffered transcript and rejoins the stream. Node and parameter names are drag sources carrying their expression address, `TRANSFORM` for a node and `TRANSFORM/tx` for its parameter, so a path can be dragged into the console instead of retyped.

## Integrate external services and AI

Cascade does not embed model providers or a generic `ai` capability. Provider
SDKs, credentials, model names, retries, and response normalization belong to
the project that uses them. This keeps graph/runtime contracts stable while
services evolve.

Keep the node definition provider-neutral and deterministic. For example, a
server node can invoke a project-owned Python operation and expose the result as
a normal image:

```ts
import type {
  ImageRef,
  NodeDefinition,
  NodeExecutionContext
} from 'cascade/contracts';

export const definition = {
  apiVersion: 1,
  label: 'Generate Image',
  runsOn: 'server',
  capabilities: ['python'],
  inputs: {
    prompt: { kind: 'data', type: 'string', default: '' }
  },
  outputs: {
    image: { kind: 'data', type: 'image' }
  }
} as const satisfies NodeDefinition;

export async function execute(
  context: NodeExecutionContext<typeof definition>
) {
  const image = await context.capabilities.python.invoke(
    { operation: 'generate_image', input: { prompt: context.inputs.prompt } },
    { signal: context.signal, progress: context.progress }
  );
  if (!image || typeof image !== 'object' || !('path' in image)) {
    throw new Error('generate_image did not return an ImageRef');
  }
  context.outputs.image.set(image as ImageRef);
}
```

Choose the path that matches the host:

- Studio/browser: use the compiler-injected `cascade/net` proxy with a declared
  project credential and exact remote-host allowlist.
- Cascade's server host: use configured Python operations or an allowlisted
  `cascade/shell` command.
- Standalone headless embedding: inject the declared capability from the host,
  or supply an application-owned server bridge that keeps credentials and
  remote I/O outside the neutral runtime.

Return `ImageRef`, `AssetRef`, or another ordinary Cascade type. Downstream
nodes should not need to know which service produced the value.

### Project Python stages

Dynamic compatibility nodes call project-owned Python through `cascade/stage`.
Declare the dispatcher once in `cascade.json`:

```json
{
  "exec": {
    "stages": {
      "entrypoint": "runtime/node_cli.py",
      "python": "python3"
    }
  }
}
```

Cascade starts the dispatcher as `node_cli.py --stage <name> --args -` and sends
the JSON argument object on stdin. Reading stdin avoids operating-system command
line limits for geometry and other large structured values. The dispatcher must
write its JSON result as its final stdout line; diagnostics belong on stderr.
It may also accept inline JSON after `--args` for manual compatibility. Projects
with expensive imports may additionally declare a newline-delimited JSON
`worker`; Cascade keeps that process warm and correlates requests by `id`.

## Work with `.cascade` files

A graph document stores authored elements separately from runtime state. Nodes and annotations remain flat even inside subnets:

```json
{
  "nodes": [
    { "id": "process", "module": "cascade.core.Subnet", "position": [400, 200] },
    { "id": "multiply", "module": "project.Multiply", "parent": "process", "position": [80, 60] }
  ],
  "annotations": [],
  "connections": []
}
```

`parent` is omitted at the root. Child positions are relative to their parent. IDs are globally unique, and connections refer to element/port identities. When changing structure, load and validate the whole candidate before replacing the live graph.

## Run without Studio

Use the CLI for automation and CI:

```bash
cascade validate index.cascade
cascade check index.cascade
cascade inspect index.cascade
cascade run index.cascade
```

`cascade check` reads definition-v1 modules statically; `cascade validate` checks the document, hierarchy and connections. Neither renders anything, so a green read proves the graph loads and not that it draws. Check a change by running it.

Render frames offline with the same command:

```bash
cascade run index.cascade --frames 1-100
cascade run index.cascade --frames 1-100x2 --fps 25 --out frames
cascade run index.cascade --frames 42 --entry-node logo-1024
```

`--frames` takes a range, a stepped range, or a single frame, and refuses a range it cannot parse rather than repairing it. Files are written as `<out>/<node id>.<frame>.<ext>`, zero-padded to at least four digits, into `renders/` unless `--out` says otherwise. One rule whether the graph has one output or three. Every image output with nothing connected downstream is saved, or the outputs of `--entry-node` when one is named. Cascade stops at the image sequence; a directory of numbered frames is what an encoder takes.

Offline, drawing goes through Skia: the optional `@napi-rs/canvas` supplies `OffscreenCanvas`, `Image`, `Path2D` and the rest as globals in the Node process, deliberately not `document`, because that is how a node tells which host it is in. This is why a node that draws on an `OffscreenCanvas` needs no second implementation for headless runs, and why the built-in `cascade.image.*` nodes render under `cascade run` as well as in Studio. A graph that draws nothing runs without the renderer installed.

`--frames` renders both homogeneous graph forms. An all-definition-v1 graph
runs once per requested frame through the deterministic runtime, which resolves
expressions and channels from the explicit frame and fps. An all-dynamic graph
uses the compatibility frame renderer. A mixed graph is rejected rather than
silently choosing one engine.

Applications can use `createRuntime()` from `cascade/runtime` directly. Register node modules and host capabilities, load the graph, mutate inputs or presets, run or trigger it, read outputs, then dispose it. This path loads no Svelte or Studio code and works in a backend service or a custom browser application.

Server and browser hosts are deliberately explicit. A graph that uses Python or shell stages belongs on the server or behind an application-defined bridge; the runtime does not silently move computation between environments.

The Studio single-HTML/folder exporter is not this embedding API. It currently
serializes a compatibility graph into its own small browser runtime, so it does
not preserve every node, capability, or runtime behavior. Use it only after
testing the exported artifact for the particular graph. For a dependable
custom experience today, embed `cascade/runtime` in an application and provide
the graph's declared modules and capabilities explicitly.

## Verify a project

Before committing a custom node or graph:

1. Type-check the project with its normal TypeScript command.
2. Run `cascade validate <graph>`, and `cascade check <graph>` for a definition-v1 project, to check the document plus static definitions, types, hierarchy, and connections without rendering.
3. Run the graph headlessly when its capabilities are available. This is the step that catches a document that loads, reports its nodes, and draws nothing. The characteristic failure here is silent, so a static pass alone proves little.
4. Open Studio only for visual inspection or authoring that benefits from the graph UI.

Dynamic modules are not deprecated and 0.3.0 stopped calling them legacy. The
two styles are cooked by different CLI engines, while Studio currently adapts
both through its compatibility controller. Prefer definition-v1 for new work
because it provides static inspection, `cascade check`, and the neutral runtime.
Keep an existing dynamic node when its current compatibility-only APIs are
still required, and keep CLI graphs homogeneous until mixed execution exists.
