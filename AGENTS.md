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

Use `cascade new <name>` to create a project. Run `cascade ./` from its root to open Studio, `cascade validate <graph.cascade>` for validation, `cascade check <graph.cascade>` for static definition/type checks, `cascade inspect <graph.cascade>` for a JSON summary, and `cascade run <graph.cascade>` for headless execution.

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
- Declare every capability used. File, Python, and shell access are server-only; WebGL is browser-only.
- Use exact Cascade core types or a namespaced project type such as `project.palette`.
- Never execute a module to discover its ports or metadata.

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

1. Add or update a focused regression test.
2. Make the smallest change at the owning layer.
3. Prefer deletion or an existing utility over another wrapper.
4. Run the focused test, then `npm run check`, `npm run test:run`, `npm run build:cli`, `npm --prefix server run build`, and `npm run build` when the affected surface warrants it.
5. For package/public API changes, also test the packed tarball from an empty temporary project.

Do not add dependencies without a concrete need. Do not create extra packages unless they need independent publication or versioning.

## Versioning

Cascade `0.2.0` is the 2026 architecture rework. The current release is
`0.2.1`. Increment the root package and CLI patch version for every committed
feature or release change (`0.2.2`, `0.2.3`, …), keeping `package.json`, the
lockfile, and CLI output aligned. Internal private workspaces do not receive
independent versions unless they become separately published packages.
