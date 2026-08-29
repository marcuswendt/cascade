# Changelog

## [0.2.1] - 2026-08-29

- Removed generated release artifacts and tracked build output from the
  repository.
- Tightened repository ignore rules and consolidated follow-up documentation.
- Protected every project API with exact Host/Origin checks and added realpath
  confinement for reads and writes.
- Added explicit retry behavior for failed cooks without automatic retry loops.

## [0.2.0] - 2026-08-29

First major architecture rework since Cascade began in 2025.

- Split deterministic public contracts and the environment-neutral headless
  runtime into two internal workspaces, while keeping one published `cascade`
  package and CLI.
- Added literal TypeScript node definitions, static extraction, validation,
  presets, triggers, cancellation, inspection, and Node/browser hosts.
- Added a graph-owned cook scheduler with coalescing, branch propagation, staged
  outputs, progress state, and Studio feedback.
- Implemented persistent subnets, generic project panels and value renderers,
  project settings, external credentials, authorized network access, and
  allowlisted shell/process stages.
- Added project scaffolding, node scaffolding, validation, strict static checks,
  graph inspection, headless execution, and packed-consumer tests.
- Removed Electron and project-specific application code from Cascade core.
- Reduced the tracked codebase while adding the new runtime, security tests, and
  authoring guidance.

## [0.1.0] - 2025

- Initial visual node workspace, compatibility graph engine, live TypeScript
  editing, assets, annotations, Viewer, and Inspector.

Historical development reports and superseded desktop designs are retained in
`spec/archive/`.
