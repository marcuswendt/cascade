# Production readiness

Written 12 October 2026, after the Cloud Observatory weekend (cloud-plots, cloud-wall, cloud-type, cloud-volumes, the flipbooks and the morph animations). Every item below comes from something that went wrong or was worked around on that work. Sources: the git logs since 9 October of Cascade and the four projects, `cloud-plots/docs/RETROSPECTIVE-2026-10.md`, the projects' `PROCESS.md` files, this repo's `CHANGELOG.md` and the session notes kept alongside the work.

## What production ready means here

Cascade is for my own art. Production ready does not mean users, a market or a hosted product. It means one powerful framework for generative design work that I can trust on a deadline.

The weekend made the shape of that clear. I directed everything over Telegram and agents did the work through scripts and CLI calls. Studio was opened rarely, mostly to look. So the headless, agent-driven path is the main road, and Studio is the inspection surface: where I look at a stage, scrub a timeline or show work to someone.

Five properties, in that light:

- Reliable. A cook gives the same answer headless and in Studio, a server stays up when the network changes under it, and a cache can never serve a result the code no longer produces.
- Reproducible. "This exact render, from this commit, these parameters and this seed" is something the graph records and can replay, without a worktree per commit.
- Recoverable. Restarting, rolling back to an approved state and resuming after a crash are single commands.
- Driveable. Everything Studio can do, the CLI can do, with `--json` output and a safe editing API, so an agent never hand-edits a `.cascade` file.
- Distributable. A project installs Cascade from a registry at a pinned version, and an exported editor carries only what I chose to share.

## Guiding principle: headless, and still readable

Marcus, 12 October: "It's important to me that the code stays inspectable and readable, but headless is a major path." Every headless and agent feature in this backlog is held to four tests:

- The graph stays legible: a few top-level stages left to right, subnets for clusters, bundle ports instead of wire fans, single-purpose nodes.
- Agent edits go through the API and leave clean, minimal diffs: stable node ids, no reordering of untouched content, and auto-layout for nodes an agent creates, so opening Studio shows a readable graph and not a pile.
- Every headless run leaves a trace that can be opened afterwards: each stage's output, timing and cache state, viewable in Studio as if it had been cooked there.
- CLI commands map one to one onto graph concepts (node, port, wire, parameter, keyframe, scene, lock), so a command and the change it makes read the same.

Each backlog item below ends with how it meets these tests.

## Agent-first workflow

This weekend's ad-hoc scripts are the clearest spec for the CLI. Each of them did something Cascade should own.

`cloud-plots/scripts/more_pages.py` and `expression_ladder.py` rendered ladders: three to five variants of one parameter per pick, numbered, on a sheet, so I could answer "the second from the left". The dial-in hour ran at a verdict every two to five minutes because of this format. It should be:

```
cascade sweep cloud-plots.cascade --node ink --param expressivity=0.25,0.5,0.75 \
  --param density=1x,2x,3x --scene picks/C29.scene.json --sheet out/C29-ladder.png --json
```

`locked_render.py`, `check_approved.py` and the sixteen `cloud-plots-locked-<commit>/` worktrees rebuilt each approved artwork from the code of its approval commit and checked it against the preview I had approved. `picks/approved.json` held the record by hand. It should be:

```
cascade lock cloud-plots.cascade --scene picks/C48.scene.json --name "C48 v1" --preview out/c48.png
cascade replay locks/c48-v1.lock.json --out delivery/ --verify
```

The `cloud-plots-canary-dialin`, `-expression`, `-graph-v2` and `-graph-v3` worktrees were branches made so an agent could try something without touching the live tree, and `regress_graph.py` proved each rebuilt graph pixel-identical. That should be:

```
cascade snapshot cloud-plots.cascade --name before-v3
cascade diff-render snapshots/before-v3 cloud-plots.cascade --all-scenes --json
```

`cloud-wall/scripts/flipbook*.py` (eight scripts: year, grid, insta, pause, ramp, smooth, extras) each built a frame sequence by hand and called ffmpeg. They should be one graph with a timeline:

```
cascade run flipbook.cascade --frames 1-480 --fps 24 --out renders/flipbook --mp4 flipbook-F1.mp4 --json
```

And the graph edits agents made by rewriting JSON should be:

```
cascade add cloud-plots.cascade ink-vocabulary --type project.InkVocabulary --in stage:ink   # stable id, auto-laid out inside the ink stage
cascade connect cloud-plots.cascade expression.out ink-vocabulary.expression
cascade set cloud-plots.cascade ink-vocabulary.long_strokes false
cascade key flipbook.cascade camera.zoom 0:1.0 120:1.4 --ease inOutSine
cascade cook cloud-plots.cascade --node ink-vocabulary --json   # leaves a trace in .cascade/runs/ that Studio can open
```

The same verbs should be exposed as an MCP server, so a Telegram-directed agent calls `cascade.set` and `cascade.sweep` rather than shelling out and parsing text.

## Backlog

Effort is rough: S is under a day, M one to three days, L a week or more.

### P0: blocks trusting a render or an agent

1. Locks and replay as a Cascade concept. What happened: approvals lived in `cloud-plots/picks/approved.json`, a mirror of a gitignored folder that only appeared at 17:14 on Sunday; entries were fixed after the fact (fd7d500, 8ad853f) and the locked delivery (5b7b3c0) needed sixteen `cloud-plots-locked-<commit>` worktrees and a 90 % preview match to prove each piece was the one approved. Fix: `cascade lock` and `cascade replay`, see Reproducibility below. Done on `locks-replay` (`src/cli/locks/`): `cascade lock <graph> <node> --name <name> [--scene] [--note] [--supersedes] [--preview]` writes `locks/<id>.json` (stable key order) with the graph object, every prop, the graph seed and any seed-named prop, input file hashes, the hash of each node module and stage entrypoint, Cascade and project versions with git state, a fingerprint of every output (file bytes, decoded pixels for rasters) and an 800 px preview; the project's source files go into `.cascade/objects/` by content hash. `cascade replay <id> [--out] [--live]` rebuilds that code in a throwaway APFS clone of the project, cooks the stored graph and compares fingerprints, refusing by name when an input file changed and listing the project files that changed since the lock; `cascade lock verify` replays every lock, `cascade locks` lists them, all with `--json` and as MCP tools; each cook leaves a run trace in `.cascade/runs/`. Demonstrated on cloud-plots (branch `locks`): Canary v1 and 11D locked as the graph renders them and replayed to matching fingerprints. Those are graph renders, not the delivered pages, which came from standalone scripts. Remaining: a read-only locks view in Studio; seeds a Python stage picks for itself are invisible to the lock (cloud-plots' are, so it records only the graph seed); a stage that calls a model (cloud-analyst) replays only because its answer is cached in a tracked file, so non-deterministic nodes still need to say so; the GPU adapter is not recorded; replay uses the running Cascade, not the locked version (item 12). Effort: L. Readable: a lock is a plain JSON file beside the graph, one per approval, and replay writes a normal run trace.

2. Stage caches that cannot go stale. What happened: the cloud-plots stage cache in `runtime/node_cli.py` ignored the stage's own source, so an edit was served the old result (fixed 12 Sep in the sketch, not in core); and the persistent Python worker (`server/src/pythonWorker.ts`) keeps imported modules in memory until it is killed, so an edited stage kept running old code in a live server this weekend. Fix: core owns the cache key (node definition hash, stage source and its imported project modules, parameters, input hashes, Cascade version); the worker watches the project's Python sources and respawns on change; a cache hit is reported on success, not only on failure (`server/src/runtime/stage.ts` reads stderr only when a stage fails). Done on `cache-parity`: `server/src/stageCache.ts` keys every stage call (Studio route and headless bridge alike) on the stage code hash (`StageSources`, every `.py` under `exec.stages.sources`, default the entrypoint and worker folders plus `src/`), the args with input files replaced by content hashes, and the Cascade version; each call's key and state (hit, miss, off, with the reason) goes to the server log, `run --json` and `.cascade/runs/`. The core result cache is opt-in (`exec.stages.cache`) and checks the files a stored result names. The worker fingerprints its sources before every request and restarts when they change; reproduced first (an edited module kept answering with the old value), and the fix also needed Python's bytecode cache keyed by code hash, because a same-length edit within a second was served from the old `.pyc`. Checked against the real cloud-plots worker: an edit to `src/cloud_plots/` restarted it before the next call. Remaining: cloud-plots' own cache does not yet honour `cache: "off"` or report its hits (`node_cli.py`, whose regression script only compares the old graph with v3, so it was left alone); Studio shows the trace in the server log only, not in the UI. Effort: M. Readable: the cache key is printed in the trace, so a stale or fresh result is visible, never inferred.

2a. Network side effects in stages must be opt-in and visible in the run trace. What happened (12 Oct): two headless cooks during the locks work (`cascade run` and `cascade lock` on cloud-plots, moments not yet analysed) made two paid Claude calls through the `cloud-analyst` stage, unapproved, because the stage called the API on any cache miss and nothing in the run said so. Fixed in cloud-plots (d983478): the analyst makes no call unless `CLOUD_ANALYST_ONLINE=1` is set for the cooking process; offline it returns the cached answer, or a result marked `analysis: "none"` with the reason on stderr, and never writes the cache. Remaining, in core: a stage declares that it can reach the network or spend money (`effects: ['network', 'paid']`), the host refuses such a call unless the run opts in (`--online`, a per-project allowlist), and every such call is a line in the run trace with its cost when the provider reports one. Effort: M. Readable: an effect is declared on the node and shown in the Inspector and the trace, never discovered from a bill.

3. CLI parity for graph editing. What happened: agents changed graphs by editing `.cascade` JSON directly, then needed `regress_graph.py` and a pixel compare to prove nothing broke (graph v2 and v3 rebuilds, e99e53e). The CLI today has `run`, `check`, `inspect`, `publish`, `freeze`, `scene` and `export`, but no way to add, connect, set or remove. Fix: `cascade add | connect | disconnect | set | remove | move | group`, each validating through the same code as `cascade check` and writing atomically, plus a small TypeScript API (`openGraph().add().connect().save()`) the CLI is built on. Effort: M. Readable: each command is one graph concept, writes a minimal diff with stable ids, and places new nodes inside the named stage with auto-layout. **Status: done on `cli-graph-mcp` (12 Oct).** `graph create|read|list`, `node add|rm`, `connect`, `disconnect`, `set` (value, expression, keys, unset), `subnet create|move|dissolve` and `edit` (batch), on one API (`packages/runtime/src/edit`, file host `src/cli/graphFile.ts`); edit-then-inverse is byte-identical in tests; `doc/CLI_REFERENCE.md`. Open: Studio still edits through its own `Graph` model and sees CLI edits through its file watch; moving Studio's edit actions onto the same API is the remaining step.

4. Structured output and an MCP server. What happened: only `run --frames` takes `--json`; everything else returns text that agents parse. Fix: `--json` on every command with a stable schema, and `cascade mcp` exposing the same verbs (inspect, set, cook, sweep, render, lock, replay, export). Effort: M. Readable: MCP tools and `--json` schemas use the same names as the graph and the CLI; no second vocabulary. **Status: done on `cli-graph-mcp` (12 Oct).** `--json` on every command (`{ ok, data, warnings }`); `cascade mcp` serves the edit, read, check, cook, render and export tools, with `lock`/`replay` wired to the CLI commands once item 1 lands; `doc/MCP.md`. Open: `sweep` (item 10) has no CLI command yet, so no tool.

5. Headless and Studio give the same pixels. What happened (12 Oct): GPU stages cooked differently in Studio and headless, so a render checked in one host did not match the other. Fix: a seeded RNG passed to every node through the runtime instead of `Math.random`, fixed GPU precision and blend state per stage, and a `cascade parity <graph> --scene ...` check that cooks both hosts and reports the pixel difference. Cloud Type already does this by hand (`parity-dots`, 9b8f752); move it into core. Done on `cache-parity`: `context.seed` and `context.random()` in the runtime and Studio's adapter, from the document's `seed` and the node id (`packages/runtime/src/seed.ts`); `run --seed`; `cascade parity <graph> [--node] [--tolerance] [--json]` cooks headless twice and through Studio's executor (compatibility graph, definition adapter, same Dawn and project capabilities) with caches off and prints each node output's two comparisons side by side. Reproduced: on MPS a colliding float `index_add` gave 40 different sums in 40 runs and the Canary daylight drawing came out two ways across fresh processes; WGSL has no float atomics, and a 400-triangle blended Dawn render repeats exactly and matches through Studio's path. Fix for the Python side, merged into cloud-plots opt-in (276219e): fixed-point `index_add` in daylight-dots and dot-mix behind a `deterministic` prop per graph or pick (or `CLOUD_PLOTS_DETERMINISTIC=1`), default off so approved pieces keep their pinned behaviour; ten identical drawings in ten runs on, and the default-off regression against main was identical except main's own mix-page flake (seam band 3,953 vs 3,949 between two runs of the same code). Parity also found Studio's executor skips the module architecture check headless enforces. Remaining: the browser's WebGPU is a different adapter, compared with `--tolerance` (doc/HEADLESS_GPU.md); `--scene` is not supported yet (apply one with `cascade scene` first). Effort: M. Readable: the parity report shows both hosts' stage outputs side by side, per stage, not one number for the graph.

6. A fresh tree always builds. What happened: vite emptied `dist/` and then failed on a stale `packages/contracts/dist` (MISSING_EXPORT SCENE_EMBED_LIMIT), leaving no CLI at all. Fixed in 82b6576 by building packages first. Done on `ops-serve`: `npm run build` and `build:cli` run `scripts/build.mjs`, which builds packages first, writes every step into `.dist-staging/` and swaps it in with two renames only when all steps passed; a forced failure left `dist/` byte-identical. Remaining: a CI job that builds from a clean clone. Effort: S. Readable: no graph impact; the build log says which package failed.

22. Headless frame renders cost the stage time only (P0, added 12 Oct). What happened: `cascade run --frames` started a fresh Python process for every stage call on every frame, each re-importing its libraries: about 7 s a frame, and the 483-frame morph film took 12.5 min across six parallel processes. Fix: the headless bridge uses the project's warm worker (`exec.stages.worker`), the one Studio uses, with the code-hash restart from item 2; one worker per `cascade run`, so a frame range is one process; and frames after the first cook with `reuse: "strict"`, so a node whose props and inputs did not change, and that nothing which cooked this frame feeds, keeps its outputs (`--fresh` cooks everything). Done on `headless-worker`: cloud-plots `morph.cascade` frames 1–60 went from 588 s (Cascade as installed, one process per stage call, 303 calls) to 5 s, 6 s with `--fresh`, from a cold project cache, and all 240 frames are byte-identical to the old renders. `cascade parity` keeps fresh processes on purpose, so a cold-start difference stays visible. Effort: M. Readable: no graph impact; the run trace still lists every stage call per frame and node.

### P1: costs time every session

7. `cascade serve` with service management. What happened: restarting Studio meant finding the right `screen` session, killing the server and the Python worker by hand and starting again, often with a stale worker left behind. Fix: `cascade serve start | stop | restart | status | logs` with a pid file per project, launchd install on macOS, and a restart that takes its workers with it. Done on `ops-serve`: a supervisor per project (lock, record and log in `~/.cascade/serve/<project>-<hash>/`) restarts a crashed Studio with backoff, stops it with SIGTERM then kills its process group so the Python worker goes too, and `status --json` reports port, actual host, pids, uptime, version and worker state; `serve install` writes and loads a launchd job. Remaining: the last cook in `status`. Effort: M. Readable: `status` names the graph, port, workers and the last cook, so the running state can be read rather than guessed from `ps`.

8. Host binding with a fallback. What happened (12 Oct): Studio was bound to `KURO` (the README in every cloud-plots worktree says to open `http://KURO:3030`); when Tailscale's MagicDNS did not resolve, `getaddrinfo ENOTFOUND KURO` crashed the server with no fallback. Fix: resolve the host before listening; on failure log it, bind `127.0.0.1` plus the Tailscale IP if present, and keep retrying the name in the background. Done on `ops-serve`: an unresolvable name or EADDRNOTAVAIL falls back to `127.0.0.1` (or `--fallback-host` / `CASCADE_FALLBACK_HOSTS`, in order), the preferred host is probed every 10 s and rebound when it returns, and `serve status` shows the actual binding and why. Effort: S. Readable: the server logs which address it bound and why.

9. Timeline render to MP4. What happened: the flipbooks and morph animations were built as eight ffmpeg scripts in cloud-wall, outside the graph. `run --frames` already writes PNG sequences. Fix: keyframe channels on parameters, `--mp4` / `--mov` with codec, crf and fps in the render manifest, and the timeline in Studio for scrubbing. `--mp4` done on `timeline-io`: `cascade run <graph> --frames 1-594 --mp4 renders/h1.mp4 [--crf 18]` encodes the sequence with ffmpeg as H.264 yuv420p at the run's fps (the graph's timeline fps unless `--fps`), padding odd sizes, and adds `video` to the `--json` manifest; a stepped range or several output sequences are refused by name. Evidence: the cloud-wall flipbook port (ce07219, d62152f) still needed a wrapper script for the encode. Remaining: `--mov` and codec choice, keyframe channels in Studio's timeline beyond the dope sheet. Effort: L. Readable: keyframes live on the parameters they animate, as channels in the graph, never in a side script; each frame's trace can be opened.

9a. The timeline is saved with the graph. What happened: the cloud-wall flipbook port (ce07219, d62152f): fps, in/out range and loop lived only in Studio's Timeline panel, which opened every graph at 30 fps over frames 1-250, so H1 (24 fps, 594 frames) was set up by hand on every open, and a headless render had to be told the rate again. Done on `timeline-io`: the document has `timeline: { fps, start, end, loop }`; the Timeline panel reads it when a graph opens and writes it on every change, so it saves with the graph; the runtime takes `timeline.fps` as the graph's own rate (a run's `--fps` still wins); and `cascade run --frames timeline` renders the saved range. Effort: S. Readable: one visible field in the `.cascade` file, the same numbers Studio shows.

10. Sweeps and contact sheets built in. What happened: `more_pages.py`, `expression_ladder.py`, `approved_overview.py` and the 10x10 `type_evo` loop (0cb1e88) each wrote their own grid renderer. Fix: `cascade sweep` over a parameter grid or a list of scenes, writing numbered variants, a labelled contact sheet and a manifest that can be turned straight into a lock. Effort: M. Readable: a sweep is a scene list plus a parameter grid in a file, not code; every variant keeps its trace and can be opened in Studio by number.

11. Agents on their own copy. What happened: several agents and a codex session edited the cascade repo and the cloud-plots tree at once (the graph-v3, expression and canary-dialin branches merged back by hand; title-type landed mid-batch and put a title layer into 65 finals that had to be re-rendered). Agent shell calls against the live server also starved interactive cooks (9 Sep). Fix: `cascade sandbox <project>` makes a copy-on-write working copy on its own port bound to loopback, with `cascade sandbox merge` that runs `check` and a render diff first; and a pin of shared defaults for the length of a batch. Effort: M. Readable: merge shows the graph diff and the render diff before anything lands.

12. Publish to npm. What happened: the registry still has 0.8.0 while the repo is at 0.9.1, so cloud-type vendors `vendor/field-cascade-0.9.1.tgz` through `scripts/vendor-cascade.sh` and every exported project carries a tarball. Fix: a release script that runs `svelte-check`, the tests and `test:package`, then publishes and tags. Projects depend on a version range. Effort: S. Readable: no graph impact; projects stop carrying an opaque tarball.

13. Python stages in exported projects. What happened: export refuses Python nodes, so cloud-type's expression stage had to be ported to TypeScript with a dot-for-dot parity check (c0f5095). Fix: keep the refusal for editors, and for projects shipped as source, declare Python dependencies in the project (a lockfile and an entry in `cascade check`) so a clone can run `cascade setup` and cook. Port to TS only what has to run in a browser. Effort: M. Readable: dependencies are declared in the project and reported by `cascade check`, not discovered by failure.

14. Licensed fonts. What happened: Helvetica Now is read in place from a gitignored `assets/fonts/licensed/` and never copied; export refuses `licensed/`. That works but is a convention, not a rule. Fix: a `licensed` asset kind in the graph, resolved by name from a per-machine font directory, outlined to paths in any exported SVG, and listed by `cascade export --plan` as excluded. Effort: S. Readable: the graph names the font as an asset; `--plan` shows it excluded.

15. The privacy boundary at export, tested. What happened: body data was stripped from the analyst on Sunday morning and brand names left the key in the afternoon, both after review. Export already scans for secrets, paths and backend URLs. Fix: a project-level `private` field list (health, calendar, diary text) that export and `freeze` refuse unless named, and a test fixture that proves a frozen scene carries no private field. Effort: S. Readable: the private list is one visible field in the project, and `--plan` names every field it withheld.

15a. `cascade freeze` evaluates Python stages. What happened: the Cloud Volumes review editor (cloud-volumes 08b9e53) needed a frozen year of moments, and `cascade freeze` cooks only what the browser runtime can, so the project wrote the snapshot itself (`moods/tools/freeze_year.py`) and the snapshot's provenance lives in a script, not in the graph. Fix: freeze cooks the upstream graph headlessly with the same host as `cascade run`, Python stages included, then stores exactly the chosen fields as today. Effort: S. Readable: the snapshot names the graph and node it came from, and `--plan` lists it.

15b. A public editor deploy is a choice, not an error. What happened: the Cloud Volumes review editor (08b9e53) was meant to be public, and `cascade export --deploy vercel` exits with an error whenever the site is readable anonymously. Done on `export-fonts-public`: `--public` makes a readable site the expected result and says so; without it the check still fails the deploy. Effort: S. Readable: the flag is on the command line, so a public deploy is visible in the command that made it.

15c. Exported editors carry their OFL fonts. What happened: the Cloud Volumes editor (08b9e53) draws its labels in "DM Mono", and the exported site fell back to the system monospace because nothing shipped the font. Done on `export-fonts-public`: `editor.fonts` lists `{ family, file, license: "OFL-1.1", weight, style }`; export copies each file, writes `@font-face` rules into the page and loads the same faces into the engine worker, so canvas text in the worker gets them too. Any other licence, or a file under `licensed/`, is refused. Effort: S. Readable: the fonts are a list in the editor section, and `--plan` shows each file.

### P2: worth doing once the above holds

16. One execution path. `doc/Cascade Product Overview.md` says Studio still uses a compatibility controller while the neutral runtime serves headless. Two implementations is where parity bugs come from. Merge them. Effort: L. Readable: one runtime means Studio shows exactly what headless cooked.

17. Gates that see everything. `tsc` and vitest both pass on a broken Studio build; only `svelte-check` reads `.svelte` (8 Sep). Put `svelte-check` in `npm test` and the pre-push hook. Effort: S. Readable: no graph impact.

18. Stage timings and progress in the run manifest. cloud-plots added `[time] stage: s` lines because nothing said what was slow, and a hung cook looks the same as a working one. Fix: per-stage timings, cache hits and a heartbeat in `--json` output. Effort: S. Readable: this is the trace that makes a headless run inspectable.

19. Mobile editors. Exported editors on a phone, for showing and light editing. In progress on `mobile-editor`. Effort: M. Readable: the phone editor shows the same published parameters and stage inspect view as the desktop export.

20. Count assertions as a node contract. Knockouts, holes and caption bands each silently broke the one-dot-per-second count. A node should be able to declare an invariant on its output (`count == input.count`) that `run` checks. Effort: S. Readable: the invariant is declared on the node and shown in the Inspector, not buried in a script.

21. Asset provenance. The upside-down moment e139c146 and the timezone audit (nine picks and seventeen wall cells on the wrong instant) were data errors found after review. Inputs should carry their source and a check stage at ingest, recorded in the lock. Effort: M. Readable: provenance is shown on the input node in Studio and recorded in the lock.

## Reproducibility

The goal: any approved render can be rebuilt from one file, without checking out the commit it was made at.

A lock is a JSON file in the project's `locks/` folder, written by `cascade lock` at the moment I approve something. It holds the graph as cooked (the full `.cascade` content, not a path), the scene and every parameter value, the seed of each node, the content hashes of every input asset, the git commit and dirty state of the project and of Cascade, the Cascade version, the source hash of every project node and Python stage it used, the host (headless or Studio, GPU adapter), the output hashes, and a preview image. The name and status (approved, superseded, not delivered) replace what `picks/approved.json` held by hand.

Replay needs the code as it was. Rather than a worktree per commit, `cascade lock` stores the project's node sources in a content-addressed store inside the project (`.cascade/objects/`), the way git stores blobs. Most locks share almost all of their sources, so the store stays small. `cascade replay` materialises the sources from the store into a temporary directory, runs the stored graph with the stored scene and seeds, and with `--verify` compares the output hashes, or the preview when the host differs, and reports the difference. Cascade's own version comes from the registry, which is one more reason the npm release in item 12 matters.

Two rules make it hold. A lock is immutable once written; a change is a new lock that names the one it supersedes. And a node that is not deterministic for a given seed must say so in its definition, so `cascade lock` can warn at approval time instead of at delivery.

Snapshots are the lighter cousin: `cascade snapshot` records the same thing for a whole graph without an approval, so an agent can mark "before graph v3" and diff renders against it later. That replaces the `cloud-plots-regress-base` worktree and `regress_graph.py`.

## Solved this week

- Fresh-tree build: packages compile before vite (82b6576, 0.9.1).
- The exported editor cooks in a module worker, so a slow stage no longer freezes the page (43f2b8c).
- The Python worker queues requests on the Node side and cancels the one in flight, so an edit no longer waits behind superseded requests (10 Oct, `server/src/pythonWorker.ts`).
- Early cutoff: identical output keeps the graph below it cached (3be33f5); an edit cancels the stage it supersedes (f1d064c); what a Viewer shows cooks first (408fc10).
- Bundle ports with per-field early cutoff, which made the seven-stage cloud-plots graph readable (fd06a57, 9df36a0).
- Shareable editors: `cascade export`, `freeze`, `publish` and scene files, with an allowlist export that refuses Python, live sources, `licensed/` and secrets (0c0f439, 0.9.0); parameters shared from the Inspector (bf77ccb).
- Frame sequences from the CLI: `cascade run --frames 1-100 --fps --json`.
- In the cloud-plots sketch, not yet in core: the stage cache key now includes the stage source (12 Sep), stage timings in the log, and the locked-delivery checks (`check_approved.py`, 0.1 mm pen check).
