# Cascade architecture

Cascade has four layers with one-way dependencies:

```text
contracts <- runtime <- hosts/controllers <- applications
```

The graph engine is a reusable product surface. The neutral runtime is ready for headless hosts; Studio is still migrating from its compatibility `Graph`/`Node` implementation and must not be described as migrated yet.

## Contracts

`packages/contracts` is dependency-free and owns `.cascade` DTOs and schemas, core and namespaced types, deterministic node definitions, capability interfaces, diagnostics, events, presets, and run results.

Contracts contain no DOM, Svelte, Express, filesystem, process, or implementation imports. Public types belong here once; other layers import them rather than recreating variants.

## Runtime

`packages/runtime` depends only on contracts and owns definition extraction, module registration, graph validation, scheduling, triggers, cancellation, outputs, hierarchy, inspection, and serialization semantics.

The runtime is environment-neutral. It works in Node and browsers without importing either platform’s APIs, and it never imports Studio. Registration is sealed after the first graph load. Each graph permits one active run and has explicit lifecycle states.

Reserved built-ins are registered once in `packages/runtime/src/builtins`:
core hierarchy/routing/time/camera, geometry operations, particle simulation,
and scene assembly. They need no project module file. The generated
[node reference](doc/NODE_REFERENCE.md) owns the complete port/parameter list.
Named, typed root Input/Output nodes form the public graph interface; child
Input/Output nodes form a subnet interface. Randomness takes an authored seed.

## Hosts

Hosts adapt the neutral runtime to an environment:

- Node: files, assets, media, Python, shell, and optional Dawn WebGPU in the CLI.
- Browser: assets, media, and the `gpu` capability when WebGPU is available.
- Mixed application: an explicit bridge for serializable server stages.

Capabilities are injected. A node’s literal `runsOn` and `capabilities` fields are checked before its `execute` module is loaded.

`portable` describes one graph contract, not necessarily one implementation.
A registration may load an equivalent browser or server executor for that
contract. The host selects the executor; graphs and artist-facing parameters do
not contain backend switches. This is appropriate for operations such as crop,
resize, composite, and encode when both Canvas/WebGL and native implementations
exist. Both executors must obey the same definition and should share golden
parity tests for geometry, metadata, and edge cases.

`packages/runtime/src/gpu.ts` owns shared device/cache lifecycle with an injected
acquisition function. Studio acquires browser WebGPU; `src/cli/headlessGpu.ts`
loads optional Dawn lazily. The runtime awaits readiness and supplies a per-node
view; the application owns disposal. `cascade/gpu` supplies explicit RGBA8
readback without encoding or colour conversion. Graph ports still exchange
images; GPU-resident intermediate connections remain future work. See
[headless GPU rendering](doc/HEADLESS_GPU.md).

`server/` is the project-scoped Node application host. It owns project paths, compilation, HTTP transport, media serving, Python workers, shell policy, and credentials. It is separately manifested and is not a third contracts/runtime workspace.

## Applications and controllers

Studio’s Svelte components under `src/editor` own rendering, selection, panels, and interaction state. Its compatibility graph now has one graph-owned cook scheduler, while `StudioGraphController` centralizes an increasing set of structural mutations and publishes view snapshots. Compatibility adapters still present runtime-owned built-ins in Studio; collapse/extract and the remaining dynamic compatibility nodes must migrate before Studio can consume `packages/runtime` directly.

Studio uses Dockview through the public `dockview` API. Code panels lazy-load
Monaco and its native editor/TypeScript workers rather than adding Monaco to the
initial application path. Markdown rendering has one Marked/DOMPurify boundary;
components do not configure parsers or inject unsanitized Markdown themselves.

Custom server applications and browser frontends use `cascade/runtime` directly and load no Studio code.

## Distribution

The repository has exactly two internal npm workspaces: `@cascade/contracts` and `@cascade/runtime`. The root `@field/cascade` package, normally installed under the alias `cascade` in projects, is the only published package and executable owner.

Public subpaths include contracts/schema, runtime and its Node/browser,
expression, animation, camera, render, scene and definition-extraction entries,
plus `cascade/io`, `cascade/gpu`, `cascade/net`, `cascade/stage`,
`cascade/shell`, and `cascade/player`. `package.json` is the exact export map.

Studio-only project extensions use the type-only `cascade/studio/panel` contract. They are compiled and loaded only by Studio; the neutral runtime and headless hosts never discover or import them.

The packed root tarball contains compiled contracts, runtime, declarations, and a self-contained CLI. It must install and type-resolve from an empty project without workspace links or development dependencies. Additional packages require a concrete independent publication/versioning need.

The repository requires Node.js 22.13 or newer and builds with TypeScript 6,
Vite 8, and the Svelte Vite plugin 7. TypeScript 7 remains deferred while it is
a preview rather than a stable compiler target.

Model providers are deliberately outside Cascade. Projects own provider SDKs,
credentials, model selection, retries, and result normalization, using the same
project-node and host boundaries as any other external service. Cascade keeps
provider-neutral media and asset types, cancellation, progress, and diagnostics.

## Deterministic nodes

`nodes/<Name>/index.ts` maps to `project.<Name>`. New modules export one literal `definition` with `apiVersion: 1` and one typed `execute(context)` function.

The extractor reads TypeScript syntax and never evaluates the module. Literal primitives, arrays, objects, parentheses, `as const`, and `satisfies` are valid. Identifiers, calls, spreads, computed keys, and other evaluation-dependent syntax are diagnostics.

`execute` performs computation only. Ports, props, types, execution locus, and capabilities are fixed by `definition`. Existing dynamic modules stay in the Studio/CLI compatibility engine during migration; the headless runtime never interprets them, and a malformed deterministic definition never falls back to dynamic execution.

Deterministic node modules are also statically checked for hidden coupling. They cannot declare module-level runtime values, run top-level effects, access ambient process/browser storage, dynamically import code, or import another node implementation. Nodes exchange project data through typed graph wires; declared props and host capabilities are their only other inputs. This is an enforceable architecture contract for trusted code, not process isolation.

## Graph documents and hierarchy

Authored nodes and annotations remain in flat arrays. Optional `parent` IDs describe subnet membership; IDs are globally unique, and child positions are parent-relative. Connections retain their node/port endpoint format across subnet boundaries.

Neutral-runtime load order is:

1. Parse and validate authored DTOs.
2. Resolve hierarchy, falling back invalid links to root with diagnostics.
3. Materialize node definitions and ports.
4. Synchronize nested subnet interfaces deepest-first.
5. Resolve connections and topology.
6. Commit the complete candidate once.

The compatibility Studio loader also constructs and validates a complete
candidate before replacing the live graph. Unknown identifiers in Cascade's
reserved `cascade.*` namespace fail explicitly; they never become inert base
nodes or embedded/project modules. Subnet collapse/extract remain the main
structural transaction gap.

Callbacks and destruction hooks run after a valid structural commit. They are not rollback state.

## Execution

Data runs follow graph dependencies. Explicit triggers use a FIFO queue, authored fan-out order, monotonic per-run sequence IDs, and cycle rejection. A triggered node receives cooked data ancestors before delivery.

Execution failures resolve to a failed `RunResult`; API misuse and invalid preflight reject. Cancellation propagates through capability calls. Inspection and output values are immutable snapshots; browser-only live resources remain host-owned handles.

### Geometry, simulation and feedback

Geometry is a shared typed value with point/vertex/primitive attributes,
topology and groups, not an editor object. POP uses that same value for
particle state. Forces accumulate acceleration; the solver integrates once
per timestep. Trails are geometry and can feed the ordinary render/export nodes.

`cascade.core.Feedback` is an explicit stateful container within the data DAG.
Its children run per step; nested Feedback owns its own descendants. Previous
state and bounded history are wired values, not sibling lookups. Result and
history use normal output staging and cancellation, with transient loop state
released even when a child throws.

POP checkpoints accelerate deterministic re-simulation; clearing them must not
change particles **or trails**. The sparse derived cache is module-local, has a
64-checkpoint bound across keys, and copies snapshots at its boundary. It does
not define simulation state. CLI `--frames` already reuses a loaded runtime,
so it can benefit from checkpoints within the sequence. Separate CLI launches
do not share that cache.

A `scene` contains geometry, an optional camera and lights. A missing camera
means the viewer supplies its view; an explicit render requires an authored
camera. The current shared CPU renderer draws wireframes and points, not lit
surfaces. Camera derivations belong to `packages/runtime/src/camera`; Studio's
3D view and offline rendering use that convention rather than separate matrices.

### Browser player

The player is a browser application host under `src/player`, not another graph
engine or package. Static export compiles definition-v1 project modules into
browser ESM and supplies assets locally. Studio, Python, shell and project
server routes are not deployment dependencies. Unsupported server operations
fail explicitly during export. See [browser player](doc/WEB_PLAYER.md) for the
build/embed contract and current limitations.

Each embed has its own iframe realm, runtime, IO bridge, assets and GPU host.
This isolates existing ambient `cascade/io` imports without swapping global
transports between asynchronous runs. Shared browser GPU acquisition lives in
`src/browser/gpu.ts`, also used by Studio. A future migration to explicit
capability-only IO could permit direct DOM mounts; that is not implemented by
the iframe player.

## Animation

A parameter carries up to three bindings: a raw value, an expression, and a keyframe channel. `packages/runtime/src/params/resolve.ts` owns their shared resolution rule: channel, expression, value. A channel that samples takes precedence and leaves the expression stored but inert, so emptying the channel restores it. Studio invokes the resolver from `Node.evalParm`; the deterministic runtime invokes it through `PropAnimator`. Nothing else in Studio may read a prop's `value` directly to obtain an animated parameter; a second rule is how an expression badge and a viewer disagree about the same frame.

The mechanisms are runtime-owned and the composition is host-specific. `packages/runtime/src/expressions` owns preprocessing (`$F`, `$FF`, `$T`, `$FPS` rewritten to plain identifiers), the evaluation scope, and the maths library; `packages/runtime/src/animation` owns the channel model, sampling, interpolation, serialization, and frame-range walking; `packages/runtime/src/params` owns binding resolution and deterministic graph-wide animation. These modules depend only on contracts or other runtime modules. Studio supplies its compatibility graph scope, while `PropAnimator` supplies the neutral runtime scope, including lazy `ch()` dependency resolution.

`packages/contracts/src/animation.ts` owns the serialized shape. A channel lives inside the node's `props`, not in a separate timeline object, because a parameter's animation belongs to the parameter; a document with a timeline section would need reconciling every time a node was renamed, deleted, or embedded.

The deterministic runtime has parameter animation and an explicit graph clock. `setFrame(frame)` and `setFps(fps)` re-resolve bound props without cooking, so inspection can scrub deterministically. `run({ frame, fps })` resolves every bound prop before node execution; the same graph at the same authored state, frame, and fps receives the same parameter values. `cascade run --frames` uses this path for definition-v1 graphs and passes each requested frame and fps into the run. The runtime never reads wall-clock time.

## Agent sessions

`server/src/agent` is a project-scoped host service, at the same layer as the shell and Python services and under the same policy. `session.ts` owns run lifecycle, `eventBuffer.ts` the bounded transcript, `allowlist.ts` the executable resolution.

A run is keyed by agent alias and document, and it is owned by the server rather than by the HTTP request that started it. The request that sends a prompt is registered as the first *reader*; a closed socket detaches that reader and nothing else, and the server keeps draining the child's stdout whether anyone is listening or not, because an unread pipe is what strands an agent. Terminating a run is only ever explicit, and it signals the process group rather than the process, because agents spawn children.

The transcript is a ring buffer with absolute monotonic sequence numbers, bounded by both event count and bytes. A reader attaches with a `since` sequence and receives one `attached` event carrying `running`, `replayed`, and `dropped`, then the replay, then the live stream, with nothing awaited in between so a concurrent event cannot land in the gap. Reporting `dropped` matters more than the buffer size: a transcript that silently loses its middle reads as an agent that did something inexplicable.

Executables come from the same `commands` allowlist in `cascade.json` that the shell service uses, resolved server-side; a path from the browser is never accepted. Transport is NDJSON over POST rather than SSE, because `EventSource` cannot carry the capability-token header these routes require, and the whole router is absent unless the session allows sensitive capabilities.

Document freshness is a watcher, not a poll of the agent. `server/src/graphWatch.ts` watches the project root non-recursively for `.cascade` files and publishes over SSE; `src/editor/graphDocumentWatch.ts` fingerprints the document with volatile metadata stripped so Studio's own save does not return as an external change. Studio reloads the graph in place through the normal candidate/commit path, and declines while there are unsaved edits rather than choosing which side wins.

## Security

Project node modules are trusted code. Capabilities describe support and portability; they are not a sandbox.

Studio binds to loopback by default. Remote access requires a specific
hostname or private interface address via `--host`; wildcard remote binds are
rejected. That non-loopback host becomes the default trusted browser hostname,
and repeatable `--trusted-host` values add exact browser authorities when the
bind address and public hostname differ, including a reverse proxy to a
loopback bind. Every reachable peer on that trusted interface can access the
project APIs, so this mode is intended for an authenticated VPN or trusted LAN.

All project HTTP APIs require an exact allowed Host. Origin is validated when
present and hostile or null Origins are rejected; same-origin GETs may omit it.
Filesystem resolution checks lexical paths and canonical existing targets or
parents. Project panels may additionally resolve beneath the canonical target
of the project-owned `shared/` link; other project paths remain root-confined.

Shell execution uses configured aliases and `spawn(executable, args, { shell:
false })`, bounded input/output/time, dangerous request-environment-key
rejection, process-tree cancellation, redacted audits, and capability-token
routes. Sensitive routes are enabled on loopback or through explicit exact
trusted-host configuration; an untrusted remote bind exposes no capability
bootstrap.

Agent runs are launched under the same policy: the same `commands` allowlist,
`shell: false`, a project-confined working directory, and its own capability
token. The child environment additionally drops the variables that would let a
launched agent reach a chat channel, so an agent started from Studio cannot
inherit another agent's transport.

## Compatibility and migration

`src/nodes` and `src/engine` remain the Studio compatibility surface while Studio migrates onto the neutral runtime. Runtime-owned algorithms stay in `packages/runtime`; compatibility nodes may adapt them but must not fork their semantics. New features belong at the owning contracts/runtime/host/controller layer.

Prefer deletion and direct imports over wrappers. Preserve behavior with focused tests before moving code, then remove the replaced path in the same change when safe.
