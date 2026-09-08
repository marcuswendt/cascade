# Contributing to Cascade

Cascade is a free, MIT-licensed creative graph platform. Contributions can be
bug reports, reproducible sketches, documentation, tests, or code. Core
development does not require an AI provider or a paid service account.

## Find the owning layer

Read [AGENTS.md](AGENTS.md) for repository conventions, [DESIGN.md](DESIGN.md)
for product decisions, and [ARCHITECTURE.md](ARCHITECTURE.md) for dependencies.

- `packages/contracts/` owns public types and serialized formats.
- `packages/runtime/` owns environment-neutral execution mechanisms.
- `server/` owns project files, compilation, processes, and host transports.
- `src/editor/` owns Studio interactions and presentation.
- Sketch repositories own creative algorithms, providers, and project panels.

Keep provider SDKs and client-specific data in projects. Do not add dependencies
or packages without a demonstrated need and an agreed scope.

## Develop and verify

Use Node.js 22.13 or newer. Install dependencies with `npm install`; the core
uses TypeScript 6. `npm run dev` starts the Studio development frontend.
Project-host workflows are exercised through a built CLI and a project folder.

Add a focused regression test for a behavior change, make the smallest change
at the owning layer, and run that test first. Use the applicable repository gates:

```bash
npm run check
npm run test:run
npm --prefix server run build
npm run build
npm run build:cli
git diff --check
```

`npm run build` also runs `build:cli` through its postbuild hook. Keep a final
CLI build after any separate Vite build because Vite refreshes `dist/`. Coordinate
rebuilds when running Studio servers serve from that checkout.

For public API or packaging changes, run `npm run test:package`, which exercises
the packed distribution from a temporary consumer. Built-in node-definition or
registry changes also require `npm run build:node-reference`; include its result.

For prose-only changes, verify source claims, links, examples, and diff hygiene.
When changing generated project instructions in `server/src/projectTemplate.ts`,
also run `npx --no-install vitest run tests/project-template.test.ts`.

## Report useful evidence

A bug report should identify the Cascade version and whether it is a published
package or local checkout, the host/browser and relevant GPU, the smallest
reproducing graph, and expected versus observed output. Include safe fixtures
instead of credentials or private client data. A static check passing is not
proof that a graph rendered successfully.

For visual changes, preserve the inputs, seed, frame/fps, dimensions, and code
revision used for comparison. Compare decoded pixels or geometry where useful;
file size and image-wide averages do not establish visual equivalence.

## Documentation and releases

Update current instructions alongside behavior changes. Keep historical notes
dated and mark proposals as unimplemented. Update the root
[CHANGELOG.md](CHANGELOG.md); `spec/CHANGELOG.md` preserves earlier history.
Never edit the generated [node reference](doc/NODE_REFERENCE.md) by hand.

Release/version rules live in [AGENTS.md](AGENTS.md). Publishing and deployment
are separate maintainer actions; a documentation update does not publish a release.
