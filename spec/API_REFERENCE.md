# Cascade public API quick reference

This page summarizes the published project-facing APIs. The authoritative TypeScript contracts live in `cascade/contracts` and `cascade/runtime`; built-in node ports are generated into [`doc/NODE_REFERENCE.md`](../doc/NODE_REFERENCE.md).

The class APIs under `src/nodes` are Studio compatibility internals. New project nodes should not extend them or inspect sibling nodes through a graph object.

## Package entry points

| Import | Purpose |
| --- | --- |
| `cascade/contracts` | Documents, values, definitions, capabilities, animation, and diagnostics |
| `cascade/contracts/schema` | Document schemas |
| `cascade/runtime` | Neutral graph runtime and its public types |
| `cascade/runtime/node` | Node host constructor |
| `cascade/runtime/browser` | Browser host constructor |
| `cascade/runtime/expressions` | Expression mechanisms |
| `cascade/runtime/animation` | Channels and frame ranges |
| `cascade/runtime/definition/extract` | Static definition extraction |
| `cascade/studio/panel` | Type-only contract for trusted project panels |

`cascade/io`, `cascade/net`, `cascade/stage`, and `cascade/shell` are host or compatibility bridges. Their availability depends on the host; importing one does not grant a capability. `cascade/gpu` exports WebGPU usage constants; access to a device comes from the declared `gpu` capability.

## Define a node

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
  outputs: { result: { kind: 'data', type: 'float' } }
} as const satisfies NodeDefinition;

export function execute(context: NodeExecutionContext<typeof definition>) {
  context.outputs.result.set(context.inputs.value * context.inputs.factor);
}
```

The definition must stay JSON-like: literals, arrays, objects, parentheses, `as const`, and `satisfies` are supported. Calls, spreads, computed properties, and imported constants cannot be extracted statically.

Definitions declare `runsOn` (`portable`, `browser`, or `server`), data or trigger `inputs` and `outputs`, stored `props`, and any required `capabilities`. A prop has a `type` and `default`, with type-appropriate UI metadata such as `label`, `min`, `max`, `step`, `control`, `options`, `accept`, or `action`.

Use one vector type for one vector value: `vec2`, `vec3`, `vec4`, or their integer forms. Namespaced project types use a name such as `project.palette`.

`execute(context)` receives resolved inputs and props, typed outputs, an abort signal, progress reporting, `nodeId` for instance namespaces, and only declared capabilities. Set data with `context.outputs.<name>.set(value)`. Deterministic checks reject module-level runtime state, ambient process/browser state, top-level effects, dynamic imports, and sibling node imports; project data crosses wires.

## Capabilities

| Capability | Environment | Purpose |
| --- | --- | --- |
| `assets` | portable | Read/write asset references and optionally resolve URLs |
| `media` | portable | Decode and encode media through the host |
| `gpu` | browser | Shared WebGPU device, adapter information, limits, and resource cache |
| `files` | server | Project-confined byte reads, writes, lists, and stats |
| `python` | server | Invoke a configured operation with JSON and assets |
| `shell` | server | Run an allowlisted executable without a shell command string |

The current GPU capability does not provide graph texture transport or readback. Ports still exchange images, and server definitions cannot declare browser-only texture values.

## Embed the runtime

In this integration outline, the application supplies `registrations`,
`assets`, `media`, and `document`. The document exposes root graph inputs and
outputs named `amount` and `image` through core boundary nodes.

```ts
import { createRuntime } from 'cascade/runtime';
import { createNodeRuntimeHost } from 'cascade/runtime/node';

const host = createNodeRuntimeHost({
  modules: {
    async resolve(moduleId) {
      return registrations.get(moduleId) ?? null;
    }
  },
  assets,
  media
});

const runtime = createRuntime({ host });
const graph = await runtime.load(document);
await graph.setGraphInput('amount', 0.75);

const result = await graph.run({ frame: 48, fps: 30 });
if (result.status !== 'completed') {
  throw new Error(result.diagnostics.map(item => item.message).join('\n'));
}

console.log(graph.getGraphOutput('image'));
await graph.dispose();
await runtime.dispose();
```

A definition-v1 registration contains `kind: 'definition-v1'`, `moduleId`, the literal `definition`, and `loadExecute(environment)`. Supply registrations through `createRuntime({ host, nodes })`, `runtime.registerNode()` before the first load, or `host.modules.resolve`. Registration is sealed after loading begins.

The loaded graph API provides:

- `preflight()` and `inspect()` for host diagnostics and immutable snapshots.
- `setInput()`, `setGraphInput()`, `setProp()`, and `applyPreset()` for explicit state.
- `setFrame()`, `setFps()`, and per-run `frame`/`fps` for deterministic animation.
- `run()` for all nodes, one node, or one output; `trigger()` for external triggers.
- `subscribe()` for run, node, trigger, progress, diagnostic, and output events.
- `getOutput()`, `getOutputs()`, and `getGraphOutput()` for values.
- `cancel()` and `dispose()` for lifecycle control.

Only one run may be active per loaded graph. Runs return `completed`, `cancelled`, or `failed`; preflight and API misuse reject instead.

## CLI contract

```bash
cascade validate index.cascade
cascade check index.cascade
cascade inspect index.cascade
cascade run index.cascade
cascade run index.cascade --frames 1-100 --fps 30 --out renders
```

`validate` checks document structure. `check` additionally requires and statically checks definition-v1 project modules. `inspect` emits a JSON classification summary. `run` uses the deterministic runtime for an all-definition-v1 document and the compatibility engine for an all-dynamic document. Mixed documents currently fail in the CLI, although Studio can cook them through its compatibility controller.

See [Project authoring](../doc/PROJECT_AUTHORING.md) for full examples, animation, project configuration, panels, external services, and verification.
