# Cascade follow-up work

This file tracks only unresolved product work. Completed release history lives
in [spec/CHANGELOG.md](spec/CHANGELOG.md); architecture decisions live in
[ARCHITECTURE.md](ARCHITECTURE.md).

## Studio migration

- Move remaining built-in nodes from the compatibility `Graph`/`Node` engine to
  deterministic definitions and `cascade/runtime`.
- Make subnet collapse/extract a fully transactional runtime operation.
- Reduce the existing Svelte accessibility and unused-style warnings.

## Creative workspace

- Improve text annotation auto-sizing, dragging, and keyboard shortcuts.
- Finish Quill chat cables, model selection, and UI polish.

## Distribution and cloud

- Design cloud project storage against the current server-owned project APIs.
- Add end-to-end browser coverage for project creation, saving, panels, and
  headless execution.
