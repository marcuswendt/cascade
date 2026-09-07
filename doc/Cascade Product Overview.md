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

## Prior art, and the one that shares the bet

Cascade sits in a long-populated field — Houdini, TouchDesigner, Notch,
Nodes.io, Cables, vvvv, Blender geometry nodes — and none of those is the
comparison that matters. The instructive one is **ComfyUI**, which went from
nothing to ubiquitous not by being a better node editor but by being the only
sane interface to something people urgently needed. That is the only shape in
which a node tool wins: not "a node tool", but the only good interface to a
thing people suddenly need.

**Sentinel** (OOD Labs, <https://ood-labs.com/sentinel/>, noted 2026-09-07) is
the one tool sharing Cascade's actual bet, and states it more precisely than we
had: *"a real-time node graph built for agents, not adapted for them."* The
agent writes modules as GPU shader code and wires them in. Alpha, $199.99
one-time then $80/year, built by "one person and an agent", shipping most
weeks.

It is also not a competitor, and the difference is worth stating because it
explains what Cascade is for. Sentinel is Windows plus an NVIDIA card, CUDA,
RTX 4090 territory: live diffusion, audio reactivity, depth and gesture
tracking, Spout and NDI out — a **live visuals and stage** tool sold to VJs and
show designers, who are a real paying audience. Cascade is a Mac, offline,
print-and-archive pipeline where every generative parameter must trace back to
evidence. Same architectural insight, opposite ends of the building.

Two conclusions follow, and they are the reason this section exists rather than
a bookmark somewhere:

- **Agent-native authoring is not a moat.** One person and an agent built
  Sentinel; one person and an agent rebuilt Cascade in a day. The cost of
  making one of these has collapsed, so there will be many, and the survivors
  will be the ones sitting on a paying audience with hardware it already owns.
- **Therefore Cascade is a published instrument, not a product.** MIT, openly
  installable, no roadmap and no support promise — deliberately, because the
  freedom to hard-cut the geometry types across every sketch in an afternoon is
  currently its most valuable property, and a product cannot do that. Marcus's
  call, 2026-09-07.
