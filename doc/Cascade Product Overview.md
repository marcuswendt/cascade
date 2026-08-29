# Cascade product overview

Cascade is a reusable TypeScript node-graph runtime with an optional visual
Studio for generative design. It supplies the stable workspace and execution
primitives that creative projects repeatedly need, while keeping each
project's algorithm and external integrations in ordinary source code.

## What Cascade owns

- Deterministic, typed node definitions and `.cascade` graph documents.
- Inspectable graph scheduling, triggers, cancellation, progress, and errors.
- Files, assets, images, media, WebGL, Python, and allowlisted processes.
- Project presets, settings, credentials, version history, and loading/saving.
- A dockable Studio with Graph, Inspector, Viewer, code, logs, and
  project-owned panels.
- A headless runtime for servers, CI, custom browser frontends, and embedded
  applications.

## What projects own

- The generative algorithm and project-specific types.
- Custom nodes, panels, renderers, Python stages, and npm dependencies.
- External services, including model providers and their SDKs, model names,
  credentials, retry policy, and response normalization.

Provider-specific results enter the graph as ordinary Cascade values such as
images or assets. Downstream nodes remain independent of whether a value came
from WebGL, Python, a local executable, or a remote service.

## Why nodes

Nodes make each pipeline stage independently inspectable, testable, reusable,
and replaceable. Static definitions let Cascade and coding agents understand a
node's interface without executing it. The `execute` function then performs
only the declared computation against capabilities supplied by the host.

## One project, several hosts

The same deterministic graph can run in Studio, through Cascade's Node server,
inside a custom backend, or in a UI-free browser host when its declared
capabilities are available. Studio is an authoring and inspection application,
not a requirement of graph execution.

See [Project authoring](PROJECT_AUTHORING.md) for the project layout, node
contract, remote-workstation launch, panels, external services, and headless
workflow.
