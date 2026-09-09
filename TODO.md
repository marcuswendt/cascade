# Cascade follow-up work

This file tracks only unresolved product work. Completed release history lives
in [CHANGELOG.md](CHANGELOG.md); architecture decisions live in
[ARCHITECTURE.md](ARCHITECTURE.md).

These are candidate improvements, not shipped features or a release schedule.
Confirm scope and acceptance criteria against a real project before implementation.

## Studio migration

- Move remaining built-in nodes from the compatibility `Graph`/`Node` engine to
  deterministic definitions and `cascade/runtime`.
- Make subnet collapse/extract a fully transactional runtime operation.
- Reduce the existing Svelte accessibility and unused-style warnings.
- Replace or retire the separate minimal HTML export runtime with a supported
  deployment path built on `cascade/runtime`.

## Creative workspace

- Improve text annotation auto-sizing, dragging, and keyboard shortcuts.
- Add contact-sheet rendering, saved visual variants, and side-by-side
  comparison for seeded and parameter-driven exploration.
- Record the inputs needed to reproduce a selected output: graph/code revision,
  assets, seed, frame/fps, dimensions, and relevant host information.

## GPU pipeline

- Add generation-stamped texture handles, graph texture transport, handle
  readback, and lifecycle accounting on top of the shared GPU device.
- Prove GPU-to-GPU composition and visual parity in a representative sketch,
  measuring full parameter-to-picture latency rather than render-pass time.
- Extend the [optional Dawn headless path](doc/HEADLESS_GPU.md) beyond its first
  RGBA8 image-rendering proof: validate the team's Windows/Linux machines and
  explicit software CI backends, measure larger workloads, and add representative
  browser/native visual baselines. Improve Windows supervisor process-tree
  termination before relying on it for project code that spawns children.

## Distribution and cloud

- Design cloud project storage against the current server-owned project APIs.
- Add end-to-end browser coverage for project creation, saving, panels, and
  headless execution.
- Turn current project-package/shared-library discovery into a documented,
  versioned distribution workflow without machine-specific checkout paths or
  duplicated static definitions.
- Build installation host adapters against a representative project, beginning
  with record/replay for live inputs and operator recovery.
