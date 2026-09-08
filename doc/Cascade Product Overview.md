# Cascade product overview

Cascade is an open-source TypeScript graph runtime and visual Studio for generative design. It is intended to let a small experiment grow into a repeatable render, an interactive browser experience, a server process, or an installation without moving the creative algorithm into a different authoring system.

The project is free to use and does not require an account, cloud service, AI provider, or paid API. A sketch may integrate those services as project code, while Cascade keeps the core graph and runtime provider-neutral.

## The working model

A Cascade project is an ordinary directory or Git repository. Its `.cascade` documents describe graph structure; `nodes/` contains authored algorithms; assets, settings, panels, and host policy live beside them.

```text
contracts <- runtime <- hosts/controllers <- applications
```

- **Contracts** define documents, values, nodes, capabilities, diagnostics, and animation data without depending on a platform.
- **Runtime** loads definition-v1 graphs, schedules execution, resolves animation, and exposes inspection and lifecycle APIs.
- **Hosts** supply browser or server capabilities such as assets, media, GPU, files, Python, and allowlisted processes.
- **Applications** include Studio and project-specific browser or server experiences.

Studio currently uses a compatibility graph/controller. It can author and cook dynamic and definition-v1 nodes together, while the neutral runtime is the headless and embedding surface for definition-v1 graphs. These are not yet one execution implementation.

## Ownership

Cascade owns typed graph contracts, deterministic definition extraction, execution mechanisms, host capability interfaces, project loading and saving, Studio, and CLI workflows. A project owns its visual system, custom nodes, panels, assets, dependencies, delivery application, and external services.

Provider SDKs, credentials, model choice, cost, retries, and result normalization remain project concerns. Results should enter the graph as ordinary values such as images or assets, so downstream nodes do not depend on their source.

## Current capability map

| Need | Current path | Boundary |
| --- | --- | --- |
| Visual authoring | Studio | Mixed node styles work through the compatibility controller. |
| Static checks | `cascade check` | Requires definition-v1 project modules. |
| Headless execution | `cascade run` | Supports all-definition-v1 or all-dynamic documents; rejects mixed documents. |
| Offline animation | `cascade run --frames …` | Supported by both homogeneous graph forms. |
| Custom applications | `cascade/runtime` with a Node or browser host | Definition-v1 only; the application supplies modules and capabilities. |
| GPU computation | Studio `gpu` capability | One shared WebGPU device and per-node caches; texture transport/readback is not implemented. |
| Single-file export | Studio compatibility exporter | A separate minimal runtime with partial graph support; test each artifact. |
| Remote or AI services | Project-owned integration | Optional; Cascade core requires no paid provider. |

## Why deterministic nodes

A definition-v1 node has a literal interface and a typed `execute` function. Static tools read the definition from TypeScript syntax without importing the module; Studio adapts the compiled definition without cooking it for port discovery. Execution receives wired inputs, props resolved for the requested frame, and declared host capabilities.

Dynamic nodes remain supported by Studio and the CLI compatibility engine. They are useful for existing sketches during migration, but they are not part of the neutral embedded runtime.

## A practical project lifecycle

1. Scaffold with `cascade new`, install project dependencies, retain the lockfile, and author in Studio.
2. Put reusable computation in definition-v1 nodes and expose meaningful boundaries with `cascade.core.Input` and `cascade.core.Output`.
3. Validate structure, statically check definitions, then execute or render in CI.
4. Record assets, seeds, inputs, dimensions, frame/fps, and code revision with selected outputs when reproducibility matters.
5. For delivery, embed the neutral runtime in the target application and supply only the capabilities that environment supports.

See [Project authoring](PROJECT_AUTHORING.md), the generated [Node reference](NODE_REFERENCE.md), [Architecture](../ARCHITECTURE.md), and [Design](../DESIGN.md).
