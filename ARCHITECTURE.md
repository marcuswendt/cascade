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

The reserved `cascade.core.*` registry is owned here. `Subnet`, `Input`,
`Output`, `Switch`, `Merge`, `Select`, seeded `Random`, and `Remap` resolve
without a project module loader. Named, typed root Input/Output nodes form an
explicit headless graph interface; typed child Input/Output nodes form a subnet interface.
Randomness is a pure function of an authored seed, never ambient process state.

## Hosts

Hosts adapt the neutral runtime to an environment:

- Node: files, assets, media, Python, and shell.
- Browser: assets, media, and WebGL.
- Mixed application: an explicit bridge for serializable server stages.

Capabilities are injected. A node’s literal `runsOn` and `capabilities` fields are checked before its `execute` module is loaded.

`portable` describes one graph contract, not necessarily one implementation.
A registration may load an equivalent browser or server executor for that
contract. The host selects the executor; graphs and artist-facing parameters do
not contain backend switches. This is appropriate for operations such as crop,
resize, composite, and encode when both Canvas/WebGL and native implementations
exist. Both executors must obey the same definition and should share golden
parity tests for geometry, metadata, and edge cases.

`server/` is the project-scoped Node application host. It owns project paths, compilation, HTTP transport, media serving, Python workers, shell policy, and credentials. It is separately manifested and is not a third contracts/runtime workspace.

## Applications and controllers

Studio’s Svelte components under `src/editor` own rendering, selection, panels, and interaction state. Its compatibility graph now has one graph-owned cook scheduler, while `StudioGraphController` centralizes an increasing set of structural mutations and publishes view snapshots. Compatibility adapters still present runtime-owned built-ins in Studio; collapse/extract and the remaining legacy nodes must migrate before Studio can consume `packages/runtime` directly.

Studio uses Dockview through the public `dockview` API. Code panels lazy-load
Monaco and its native editor/TypeScript workers rather than adding Monaco to the
initial application path. Markdown rendering has one Marked/DOMPurify boundary;
components do not configure parsers or inject unsanitized Markdown themselves.

Custom server applications and browser frontends use `cascade/runtime` directly and load no Studio code.

## Distribution

The repository has exactly two internal npm workspaces: `@cascade/contracts` and `@cascade/runtime`. The root `cascade` package is the only published package and the only owner of the executable.

Public subpaths are `cascade/contracts`, `cascade/contracts/schema`, `cascade/runtime`, `cascade/runtime/node`, `cascade/runtime/browser`, `cascade/runtime/expressions`, `cascade/runtime/animation`, `cascade/io`, `cascade/net`, `cascade/stage`, and the compatibility `cascade/shell`.

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

## Security

Project node modules are trusted code. Capabilities describe support and portability; they are not a sandbox.

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

## Compatibility and migration

`src/nodes` and `src/engine` remain the Studio compatibility surface while Studio migrates onto the neutral runtime. Runtime-owned algorithms stay in `packages/runtime`; compatibility nodes may adapt them but must not fork their semantics. New features belong at the owning contracts/runtime/host/controller layer.

Prefer deletion and direct imports over wrappers. Preserve behavior with focused tests before moving code, then remove the replaced path in the same change when safe.
