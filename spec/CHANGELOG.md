# Changelog

Historical release notes through 0.2.3. Current release notes and unreleased
changes live in [the root changelog](../CHANGELOG.md). Entries below describe
their release date, not the current implementation.

## [0.2.3] - 2026-08-29

- Raised the supported runtime to Node.js 22.13 or newer and upgraded the
  repository to TypeScript 6. TypeScript 7 remains deferred until stable.
- Upgraded Studio to Vite 8, the Svelte Vite plugin 7, and Dockview 8 through
  its public package API.
- Removed the Monaco Vite plugin. Code panels now load Monaco on demand and use
  Monaco's native editor and TypeScript workers.
- Centralized Markdown rendering behind Marked and DOMPurify for every
  component that renders authored Markdown.
- Removed built-in model-provider SDKs, AI nodes, provider settings, and the
  embedded code-generation bridge. AI and other external services are now
  project-owned integrations built on deterministic nodes, Python, shell, or
  Studio's authorized network path.
- Kept named-workstation launch concise: `cascade . --host KURO --port 3030`
  infers `KURO` as the trusted browser hostname.

## [0.2.2] - 2026-08-29

- Restored origin-less same-host browser capability discovery while retaining
  exact Host checks and hostile/null Origin rejection.
- Added strict `--host` and `--port` parsing plus first-class named-workstation
  launch support for authenticated private VPN interfaces.
- Allowed reusable project panels beneath the confined canonical target of a
  project-owned `shared/` link.
- Removed the unused WebSocket watcher and legacy project client, and made the
  AI CLI bridge use the current Studio origin.
- Replaced deprecated `lucide-svelte` with `@lucide/svelte`, refreshed
  compatible dependencies, and kept major framework/SDK migrations separate.
- Expanded packaged agent guidance for local, remote, and headless workflows.

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
