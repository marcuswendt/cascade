# Changelog

Notable changes to Cascade. Newest first.

## Unreleased

### Added

- **Stage cache keys Cascade owns.** Every Python stage call, Studio or
  headless, is keyed on the stage code (a hash of `exec.stages.sources`), the
  arguments with input files replaced by their content hash, and the Cascade
  version, and its cache state (`hit`, `miss`, `off`) and key are reported on
  every call: in the server log, in `run --json` under `stages`, and in the run
  trace. `exec.stages.cache` turns on a core result cache that verifies the
  files a stored result names before serving it.
- **Run traces.** Every `cascade run` writes `.cascade/runs/<time>-<graph>.json`
  with each node's time and its stage calls. `run --json` works without
  `--frames`.
- **Seeds.** `context.seed` (from the document's `seed` and the node id) and
  `context.random()` in both hosts; `cascade run --seed N`.
- **`cascade parity <graph> [--node] [--tolerance] [--json]`** cooks headless
  twice and through Studio's executor with caches off and reports every node
  output side by side.
- **Locks and replay.** `cascade lock <graph> <node> --name <name>` records one
  render in `locks/<id>.json`: the graph as cooked, every prop and seed, input
  file hashes, the project's source code (stored by hash in
  `.cascade/objects/`), versions and git state, and a fingerprint of every
  output. `cascade replay <id>` rebuilds that code in a throwaway copy of the
  project and compares fingerprints, without a worktree; `--live` uses the
  current code instead. `cascade lock verify` replays every lock and
  `cascade locks` lists them. All take `--json`.

- **`cascade serve`.** `start | stop | restart | status | logs | install |
  uninstall [project]` runs Studio as a supervised background service: one
  lock, record and log per project under `~/.cascade/serve/`, restart with
  backoff after a crash, and a stop that takes the Python worker with it.
  `status --json` reports port, actual host, pids, uptime, version and worker
  state. `install` writes and loads a macOS launchd job.
- **Host fallback.** When `--host` does not resolve (a MagicDNS name while
  Tailscale is down) or is not on this machine (`EADDRNOTAVAIL`), Studio binds
  `127.0.0.1` (or `--fallback-host`, repeatable) instead of crashing, and moves
  back to the preferred host when it returns.
- **Graph editing from the CLI.** `cascade graph create|read|list`, `node add|rm`, `connect`, `disconnect`, `set` (value, `--expr`, `--key frame=value`, `--unset`), `subnet create|move|dissolve` and `cascade edit` for a batch. Each edit is checked with the same code as `cascade check`, written atomically in the file's own formatting, and leaves a minimal diff: an edit and its inverse leave the file byte-identical. New nodes get stable kebab-case ids and are placed along the graph's flow when wired; wires across a subnet boundary go through named `Input`/`Output` nodes. See `doc/CLI_REFERENCE.md`.
- **`--json` on every command**: one `{ ok, data, warnings }` envelope on stdout.
- **`cascade mcp`**: the same operations as MCP tools over stdio (graph read/list, node add/remove, connect, set, subnets, check, cook, render, export; lock and replay once they land). See `doc/MCP.md`.
- The editing API (`GraphEditor`, `readGraph`, the operation types) is exported from `@field/cascade/runtime`.

### Changed

- `cascade run --frames --json` prints its manifest inside the envelope, as `data`, rather than at the top level.

### Fixed

- **An edited stage no longer runs its old code in a live Studio.** The warm
  Python worker restarts before the next request when its stage sources
  change, with Python's bytecode cache keyed by the code hash so a quick
  same-length edit is not served from an old `.pyc`.

- **A failed build keeps the previous `dist/`.** `npm run build` and
  `build:cli` build into `.dist-staging/` and swap it in only when every step
  passed; the log names the step that failed.

## 0.9.2 — 2026-10-12

### Added

- **Exported editors work on phones.** The preview is full width at the top,
  with pinch, pan and double-tap to fit. Controls sit in a bottom sheet with
  three snap points and folded groups, sized for thumbs (44 px targets, 16 px
  text, steppers). The header is one row with a ⋯ menu. Safe-area insets and
  `100dvh` keep everything clear of Safari's toolbar. Exports and scenes use the
  share sheet, with a download as the fallback. Landscape uses a side panel, and
  desktop is unchanged.
- **`editor.peek` and `editor.draft`.** These choose the controls kept in reach
  at the sheet's lowest point, and the values cooked while a slider is dragged
  (a lower density, say).

## 0.9.1 — 2026-10-11

### Added

- **Share from the Inspector.** Studio's Inspector has a `share` toggle per
  parameter that publishes it to the exported editor, with label, group and
  min/max/step fields.

### Changed

- **The exported editor cooks in a module worker** (`editor-worker.js`), so a
  slow stage no longer freezes the page while someone drags a slider.

### Fixed

- **A fresh tree builds.** `npm run build` compiles the workspace packages
  before vite, and no longer leaves `dist/` without a CLI.

## 0.9.0 — 2026-10-11

### Added

- **Shareable editors (0.9.0).** `cascade export <graph> --out <dir>` builds a
  static editor site from a graph's new `editor` section. It has the published
  parameters (with a UI generated from their types), presets, scene files, one
  export button per declared output, and a read-only inspect view of every
  stage. `--plan` prints the manifest without building, and
  `--deploy vercel` deploys the site and checks that Vercel Authentication is
  on.

  The export is an allowlist. It ships the subgraph the outputs need and the
  selected assets, and nothing else. It refuses Python and dynamic nodes,
  wired-in live sources, `licensed/`, hidden and gitignored files. It scans the
  built site for credentials, local paths and backend URLs.
  `cascade freeze` snapshots chosen fields of a live source, and
  `cascade publish` marks a prop as a parameter. Scenes (`*.scene.json`) open
  in the editor, in Studio (File › Open/Save Scene) and in the CLI
  (`cascade scene`, `cascade run --scene --write`), with versioned,
  degrade-gracefully matching.

  The runtime gains `run({ reuse: true })`, an early cutoff for hosts that
  re-run on every edit, and `cascade.core.Frozen`. Node definitions gain
  `source: "live"`. See `doc/EDITOR_EXPORT.md`.

- **Bundle ports.** A node can export one `bundle` port carrying named fields
  instead of a dozen loose outputs. A producer declares `fields` (name to type)
  and an optional `schema`; a consumer declares the `fields` it reads, sees only
  those, and in Studio re-cooks only when one of them changed (per-field
  versions on top of early cutoff). Expressions read a wired bundle's fields
  with `ch("format.dpi")`. `cascade.core.Pick` and `cascade.core.Pack` convert
  between bundles and single values. `cascade check` reports unknown fields with
  the nearest declared name, and refuses an absolute read of another node's
  bundle. Studio draws a bundle as one neutral port whose hover and Inspector
  list its fields and values. Bundles reach Python stages as dicts. See
  "Bundle ports" in `doc/PROJECT_AUTHORING.md`.

- **Node previews on the canvas.** A project that sets
  `settings.nodePreviews: true` in `cascade.json` shows each node's first
  output as a readable preview card on the graph, refreshed per node cook. The
  same settings can carry a `workspace` used as the first-open dock layout when
  the browser has none saved; a layout that fails to load falls back to the
  built-in one.

- **Groups own their contents.** A group frame keeps an explicit
  `containedElements` list, separate from subnet parenting. Drag the frame
  header to move its members (nested contents move once); drop an item's
  centre inside a frame to add it, outside to remove it, and the smallest
  enclosing frame wins. The target frame highlights before release, and
  membership and positions share one undo step. Deleting a frame leaves its
  contents. View → Clean Up Layout now treats each group as a cluster: it lays
  out members first, fits the frame, then places the groups.

- **The Agent console keeps a Codex conversation, and panels can hand it a
  draft.** A Codex console resumes the thread id from `thread.started`, so
  later prompts continue one conversation per sketch as Claude's do; project
  `--sandbox` flags are normalised for `exec resume`. Codex item events
  (assistant messages, commands with their output, file changes) render in the
  console. Project panels get `api.openAgent(prompt)`, which opens the Agent
  panel with a draft to review and send, never sending it.

### Changed

- **Dragging a node re-renders only what moved.** Each node reads its position
  through its own motion store, and the graph is published once when the drag
  ends rather than copied every frame. At 100 nodes a pointer move costs 1.6 ms
  of script instead of 8.9 (5.6 ms of task time instead of 13.1).

- **Node drags apply once per frame.** Moving a node or a selection batches
  pointer moves to one update per animation frame instead of one per event.

- **Identical output stops invalidating the graph below it.** A node that
  re-cooks and commits the same values (compared structurally; the same
  object reference counts as changed, since it may be mutated in place) keeps
  its output version, and a node stale only because of that upstream re-cook
  is skipped. A node whose own parameters, code or wiring changed always
  cooks, and `node.earlyCutoff = false` opts a node out. The cook status
  carries the count as `cutOff`. Python projects get the matching half by
  keying their stage cache on content; cloud-plots does (see its
  `runtime/node_cli.py`). There, a no-op edit to `area-filter-mask` now costs
  2 stage calls and 47 ms instead of 13 calls and 866 ms.

- **What a Viewer shows cooks first.** A pass ran in plain topological order,
  so a sink nobody was looking at (an export, a plot check, the mockup) could
  run ahead of the node on screen. Now the selected or pinned node of each open
  Viewer and everything it depends on cook first, and the rest of the pass runs
  after, in the same order as before. With no Viewer (the CLI, tests, cook-all)
  nothing changes. On cloud-plots, a Viewer on `hatch-curves` showed its result
  after 3.4 s instead of 7.4 s on a cold cook.

- **An edit cancels the stage it supersedes.** Changing a parameter while a
  long Python stage runs used to wait for that stage, and then for every
  request queued behind it. Now the superseded cook is aborted: its request is
  withdrawn from the worker (dropped if queued, interrupted with SIGINT if
  running, killed if it does not answer), its result is never applied, and the
  pass restarts from the edit. The cook strip shows how many cooks were
  superseded. Measured on cloud-plots, an edit during a 12 s stage now lands in
  0.6 s instead of 10.9 s. Project workers should answer an interrupt with
  `{"cancelled": true}` to stay warm; see `doc/PROJECT_AUTHORING.md`.

### Fixed

- **Three wire and runtime fixes.** Studio's browser-shell adapter sends
  execution options (stdin, timeout, cwd, env) at the top level of the
  `/api/shell` body again; nested under `options` the route dropped them. A
  Switch node's `index` is a document prop, serializes, and re-routes on cook.
  Project CLI instances of one module share a single executor build, so one
  cannot import the `.mjs` while another rewrites it.

## 0.8.0 — 2026-10-10

### Added

- **Number fields scrub.** Middle-drag any numeric field (vector components,
  ints, a scalar's number box, colour channels) to drag its value, Houdini
  style. On a trackpad, drag the X/Y/Z letter or the parameter's name, or
  Option-drag the field. Shift is 10× coarser, Cmd/Ctrl 10× finer, Esc restores
  the start value, and a whole drag is one undo step. Vectors with a range show
  a hairline marking where the value sits.
- **Drag a node onto a Viewer to pin it there.** Drag a node out of the graph
  panel, or Cmd-drag it, and drop it on a Viewer: the Viewer shows that node and
  locks to it. Click the lock to follow the selection again. Each Viewer locks
  on its own, and locks survive a reload.

### Changed

- **The graph stays calm until you select.** Wires idle at half opacity. A
  selection brings its node and wires to full strength and fades the rest;
  hover previews the same. Wires now draw under nodes, so they no longer cross
  names or take clicks. The levels are the `--graph-*` variables in
  `src/editor/theme.css`.
- **Dragging a parameter's name into the agent console is now Option-drag**,
  because a plain drag on the name scrubs.

### Fixed

- **The workspace stays as you left it.** Panel layout, every Viewer and what
  each one is pinned to are saved with the project, beside the graph as
  `<name>.workspace.json`, on every change rather than every 30 s. Before, one
  browser key held the layout for every project on the same host and port, so
  opening another project unpinned your Viewers, a reload soon after arranging
  lost the arrangement, and `localhost`, `127.0.0.1` and a Tailscale name each
  had their own layout. A pinned node that is not in the loaded graph now shows
  as missing and keeps the pin, instead of the Viewer quietly following the
  selection. A layout that fails to restore is kept as
  `<name>.workspace.failed.json`.
- **Studio no longer wakes the GPU while idle.** The Viewer requested an
  animation frame on every frame whenever anything was on display, which kept
  the compositor ticking at display rate. It now redraws on a cook or a
  selection change and stops while the tab is hidden: 10 s idle went from 1,250
  frame callbacks to none.
- **A scrub label no longer throws when its node goes null on teardown.**
- **The Pinterest extension no longer puts Save buttons over canvases.** Studio
  sets `<meta name="pinterest" content="nopin">`.

## 0.7.1 — 2026-09-12

### Added

- **File > Open lists the graphs on the machine running the server.** It called
  the browser's file picker, which lists the machine in front of you — opened
  from Goa while the project sat in London, three of four graphs were
  unreachable. `GET /api/graph` already returned them; the menu had never caught
  up. The local picker remains, behind "Open from this computer…".
- **`cascade run --node <id>`**, repeatable, naming which output nodes to
  render. `--entry-node` did most of this and was unfindable, because "entry
  node" reads as *start here* rather than *render this*. One named node narrows
  the cook as well as the saving; several narrow the saving.

### Fixed

- **The `files` capability resolves symlinks before deciding a path is inside
  the project.** `path.resolve` normalises `..` and does not follow links, so a
  project containing `cache -> /somewhere/else` read outside itself. Containment
  rather than a ban: a link that stays inside the project still works.

## 0.7.0 — 2026-09-12

### Removed

- **The dynamic executor.** `cascade run` had a second execution path: when the
  deterministic runtime declined a graph, the CLI built a Studio `Graph`,
  compiled each node with esbuild and cooked it through the class-based
  scheduler. About 160 lines of second implementation, with behaviour that
  differed from the one every other surface uses.

  Removed on a measurement: all nine graphs across six sketches either render
  through the deterministic runtime or are refused by the runtime's own
  `runtime/preflight-environment` for declaring `runsOn: 'browser'`. 72 nodes,
  none dynamic. A graph with no definition-v1 nodes is now refused by name
  rather than run through the other path.

  Nothing in the CLI reads the class registry any more, so
  `registerStandardNodes()` is gone from the runner and the bundled CLI no
  longer carries the class-based standard library.

### Added

- **`cascade.geo.FromRects`** and `rectsToGeometry`. `rects` was a declared core
  type with no consumers; it converts to geometry as one closed polygon per
  rect, with the tag preserved as a primitive string attribute. Raster rects
  need their frame height, and the node refuses rather than guessing it — an
  unflipped raster rect renders mirrored and plausible.
- **A `files` capability on the CLI host.** Declaring `files` previously got a
  node `undefined`, which pushed authors towards an undeclared `node:fs` import
  — the invisible version of the thing declarations exist to make visible.
  Reads resolve inside the project, writes are confined to `.cascade-cache/`.
- **Stage output reaches the operator.** A stage could log and nobody could read
  it: `stderr` was consulted only on failure and `stdout` only for its last
  line. `cascade run --verbose` now forwards both.
- **`--strict`** fails `validate` and `check` when a node names a module with no
  file, and the summary says how many were unresolved rather than reporting
  "passed" directly under the list.

### Fixed

- **Scrubbing no longer kills the cook it is waiting for.** The timeline marked
  time-dependent nodes dirty *before* its own already-cooking guard, so every
  scrubbed frame aborted the cook in flight and then deferred — a graph slower
  than the mouse never finished one. The coalescing that was already there is
  what makes leaving the running cook alone correct.
- **A cancelled cook is no longer logged as a failure.** The node's state was
  already right; only the console was lying, several times a second, which
  buries the real failure when one arrives.

## 0.6.0 — 2026-09-10

All three items from a user's first day with the npm package.

### Added

- **`cascade.math.*` — arithmetic as nodes.** `Binary` (add, subtract,
  multiply, divide, power, modulo, min, max, atan2), `Unary` (abs, negate,
  floor, ceil, round, sqrt, sign, sin, cos, tan, asin, acos, exp, log, radians,
  degrees, fract), `Clamp`, `Mix` and `Compare`.

  The maths already existed as expressions — every parameter field takes
  `sin($T)`, `clamp`, `lerp`, `fit`. So these are not a second way to compute
  but a second way to *place* a computation: an expression is private to one
  parameter, and a value you want to look at, reuse, or wire into three places
  has to be a node.

  Grouped with an operation to pick rather than one node per operation, which
  is Houdini's form and would be about twenty-five nodes. Inputs are `any` and
  every operation is component-wise with scalar broadcast, so multiplying a
  `vec2` by a scalar and adding two `vec3`s both work. There is no `Fit`:
  `cascade.core.Remap` already is one.

  Division and modulo by zero give zero rather than `Infinity`, and `sqrt` of a
  negative gives zero rather than `NaN` — a non-finite number flows into a
  position and the geometry silently vanishes, which is a blank frame with no
  error anywhere.

- **Connections can be made backwards.** A drag or click may begin on an
  unconnected input pin and end on an output; the endpoints are normalised
  before the connection is built, so variadic fan-in, the `Input` node a subnet
  auto-creates, and multi-select fan-in all behave identically in either
  direction. A *connected* input keeps the disconnect gesture.

### Fixed

- **The node search panel no longer closes when the search narrows to one
  result.** The pointer had not left it — the panel shrank away from underneath
  a stationary cursor, which fired `mouseleave` at the exact moment you were
  about to click the thing you searched for. Leave-to-close now applies only
  while the panel is being browsed by hover, not once you have typed.

## 0.5.2 — 2026-09-10

### Fixed

- **The load warm-up no longer reports false errors.** A node's ports are
  created by running its code, so on load a connection into a node that has
  never executed has no port to attach to, and Studio cooks the graph
  repeatedly until the wiring settles. Early passes reached nodes whose
  upstream edge had not bound, those nodes ran with `undefined` on that input
  and threw their own "nothing wired to my image input", and a later pass then
  succeeded — leaving a correct graph and a log full of errors that never
  cleared. Reported against the `volume-field` sketch by someone who had
  verified from the cache files that the render was in fact right.

  The scheduler now distinguishes an input that is *pending* from one that is
  *missing*: a node with an unbound inbound edge is held back as not-ready
  rather than cooked and failed. Once the warm-up stops making progress the
  graph says so, and an edge that still has not bound is treated as unbindable
  — so a genuinely unwired node errors as it always did, rather than silently
  never cooking.

## 0.5.1 — 2026-09-09

- Prepared the 0.5 browser-player release for npm, with updated README and
  cascade.field.io documentation covering web embeds, geometry, subnets,
  particles, Feedback, scenes, animation and bounded Dawn renders for agents.
- Clarified browser/server execution limits, current wireframe/point rendering,
  explicit asset packaging and same-origin player controls. The npm homepage
  now points to cascade.field.io.

## 0.5.0 — 2026-09-09

### Browser player

- `cascade build <graph> --out <new-directory>` exports definition-v1 graphs as
  static pages with a lightweight iframe embed API. Browser execution supports
  assets and WebGPU; server capabilities and dynamic modules are rejected at
  build time. No Studio server is required. See [Web player](doc/WEB_PLAYER.md).
- Each embed owns its runtime, IO bridge and generated assets. Playback and
  edits serialize, failed cooks pause playback, and disposal releases resources.
  Generated images have immutable paths and explicit retention limits.
- Browser image loading now decodes bridged assets correctly, including SVG
  bitmaps. Studio and the player share browser GPU acquisition.

### Runtime correctness and performance

- POP checkpoint caching enforces its 64-entry bound even for one simulation,
  copies mutable particle state at the boundary, and replays the trail window
  so warm and cold renders agree. Malformed field and trail data report errors.
- Nested Feedback runs children only in their owning loop, orders dependencies
  across container boundaries, publishes history consistently, and clears
  transient state after failures or cancellation.

### Documentation and verification

- Updated architecture, authoring and agent guides for geometry, simulations,
  scenes and static deployment. Added real-browser embed and packed-consumer
  checks alongside focused runtime and IO regressions.
- Retired archived Quill examples with a recoverable backup; removed incidental
  Quill examples from current guidance while retaining removed-node rejection tests.
- Streamlined shared player image decoding, MIME inference and cleanup error
  handling without changing the public player contract.
- Removed unused Studio component props and consolidated CLI execution-style
  checks. Empty/dynamic fallback and mixed-graph rejection remain unchanged.
- Deleted the unreachable WindowManager UI and its private window/tab components;
  Dockview remains Studio's sole layout host. Removed the commented-out Canvas
  sample initializer. The active Graph/Node compatibility engine is unchanged.

## 0.4.0 — 2026-09-09

### Documentation

- Updated current guides and generated project instructions for definition-v1
  animation, stored `props`, instance identity, vector metadata, and the shared
  GPU capability. Clarified host requirements, Studio's remaining runtime
  migration, export limitations, and the distinction between implemented
  workflows and future product directions.

### Animation

- The deterministic runtime resolves expressions and keyframe channels at an
  explicit frame through the shared parameter resolver. `cascade run --frames`
  can render fully definition-v1 graphs with compatible Node-host capabilities;
  mixed definition-v1/dynamic graphs remain unsupported by the CLI.

### Node authoring

- **A definition-v1 node knows its own id.** `context.nodeId` is the instance's id, which is what lets `cachePath(context.nodeId, '.png')` name a scratch file per instance rather than per module — `field-logo` runs one module three times at three sizes, and a literal path made them overwrite each other. An id is deliberately all a node gets: it names a namespace, not a position, so a v1 node stays a pure function of its own inputs.
- **A stored value left under `params` is now reported instead of lost.** The deterministic runtime reads `props` and nothing else, so a document converted to definition-v1 without moving its values reverted every one of them to its default and reported success. `preflight()` names them (`runtime/stray-params`), and `cascade check` prints them under their own heading. It is a warning, not an error — such a graph runs perfectly well on its defaults, which is exactly the problem.
- **One rule for what stops a run.** `PREFLIGHT_WARNING_CODES` lives in the runtime and is read by both the run path and the CLI's `classifyPreflight`, replacing a copy that existed only in the CLI. A duplicated preflight rule is what previously let `validate` and `check` pass graphs `run` then rejected.

### Authoring, continued

- **A prop can declare a default expression**, so a node arrives already moving — `sine-oscillator` and `ripple` shipped a static `0` once converted, where their dynamic versions baked in `$T`. It is a *default*: a document that saved a plain number keeps it and does not start animating on load. Applied once per prop, so a deleted expression is not reinstated when a retarget re-runs setup, and visible in the Inspector rather than a hidden fallback.

- **A vector prop can declare `min`, `max` and `step`.** All six vector types were typed `never` for those three fields, so the standing "one `vec2`, not two floats" convention silently cost the Inspector its clamp and its drag granularity every time it was followed. One range across all components; matrices stay excluded.
- **A module with no file is named, with the paths it was looked for.** `prepare()` synthesises a definition from the ports the document saved for any unresolvable module, which keeps legacy nodes loadable and also let a typo validate clean. A warning, because such a node can never run through the deterministic runtime anyway.
- **The stray-`params` warning covers inputs as well as props** — the case the conversions produce most, since a parameter another node drives must be an input.

### Interface

- **Port and wire colours resolve through per-theme tokens.** The palette was thirteen hex values chosen against a black canvas; in light mode gold sat at 1.3:1 against white. Also collapses `DATA_TYPE_COLORS`, which was a second palette with different values for the same families.
- **A parameter's label reaches its control.** `SelectInput` declared an `id` and never applied it, so every select-shaped parameter's `<label for>` pointed at no element.

### Build

- **The CLI build resolves `@cascade/runtime/params`.** `src/nodes/Node.ts` imports `resolvePropBinding` from it, the browser build resolved it through `vite.config.ts`, and the CLI build had no alias — so the CLI, which is what the sketches actually run, was the broken half.

### Camera

- **A camera is a core type, and it is Houdini's camera.** `camera` joins `CORE_TYPES`, `cascade.core.Camera` emits one, and every derivation — basis, view and projection matrices, horizontal and vertical angle — lives in `cascade/runtime/camera` so no renderer derives it twice. Following `/obj/cam` costs the two things the obvious design would have done instead: there is **no field of view** (`focal` and `aperture` in millimetres, angle derived — Houdini's 50 mm on 41.4214 mm is exactly 45°), and the orientation is **`translate` and `rotate`** rather than eye-and-target, looking down its own **-Z** with **+Y** up, with look-at layered on top as an override. `resolution` is on the camera because Houdini derives the vertical aperture from the frame shape; it is one `vec2i` rather than `resx`/`resy` because the vec rule is the more specific one. Matching a frame is therefore always one number, never two.
- `rotate.z` is a roll about the camera's own view direction. The first two rotation orders tried were indistinguishable from this one by every test in the suite — with `rotate.z` at zero all three agree exactly — so the test that separates them asserts that roll changes the up and leaves the view direction alone.

### Series

- **A series is a graph plus an ordered list of parameter sets** (`CascadeSeries`, `runSeries`), cooked once per set and addressed by **record id, never index**, because a filter change reorders a set and a judgement pinned to a position silently becomes a different picture. `CascadePreset` and `applyPreset` already were the parameter set and had no callers. There is no marked region: the affected subgraph is derived from the overrides, so nothing can be marked wrongly.
- A parameter set is **sparse**, so every instance cooks from a baseline captured before the first `applyPreset` — otherwise an instance that overrides nothing inherits the previous one's values, which is accidental feedback in a mechanism specified as having none, and it presents as a flaky renderer rather than as a bug. `first` reorders the work and never the results, so a gallery fills in as instances land without the list reshuffling under a selection.

### Capabilities

- **Studio can reach the shell.** The server has had an allowlist-gated `/api/shell` for a while and Studio never wired it as a node capability, so a definition declaring `capabilities: ['shell']` ran through `cascade run` and threw in the browser — a node marked `runsOn: 'portable'` that runs in one host is what `runsOn` exists to prevent. A `CascadeAbortSignal` is bridged to a DOM one rather than serialised; a 403 re-handshakes exactly once and then reports, naming the Allowed Commands editor rather than a status code.

### Correctness

- **A `vec3` prop stays a `vec3`.** `isColorValue` answers true for any three- or four-number array and the deserialise path had no `type === 'color'` guard, so every vector prop in every sketch was rewritten on load — `[0.55, 0.12, 1.95]` reached `execute` as a colour object, coerced and divided by 255. A guard existed one branch away and never ran, because a **project** module's definition arrives asynchronously and `node.parameters` is empty at load. Coercion is now decided by ambiguity: objects and strings still normalise, arrays only where the prop is already declared a colour.
- **An error in the log says what it is.** The Log panel `JSON.stringify`s any object and `Error.message` is non-enumerable, so a `TypeError` and a `GPUPipelineError` were equally invisible as `{}`.
- **Selecting a failing node no longer cooks it forever.** The Viewer's rAF pump is throttled to 100 ms and polls its watched node while dirty; an execute that throws never reaches `clean`, so it ran a full `scheduler.flush()` ten times a second, re-fetching inputs over the network, at 61 fps and never looking wrong. `Node.hasSettledFailure` is what the poll now skips — deliberately not folded into `isDirty`, because an explicit `requestOutput` still retries and that is the transient GPU and network case.
- **Renaming a node is a double click.** The name label sits in the middle of the node body and a single click opened the rename editor, so aiming at a node to select it renamed it instead, in memory only and discarded on reload.
- **A proxied Studio can save.** `https` origins are accepted and default ports matched, so a reverse-proxied or Tailscale-served Studio can POST — which is also what unblocks WebGPU, the clipboard and the microphone, all of which need a secure context.

### Headless GPU

- Optional pinned Dawn (`webgpu@0.6.0`) in the CLI, loaded only for GPU execution.
  Browser and Node hosts reuse shared device/cache lifecycle; portable and server
  definitions may declare `gpu`. Browser-only nodes remain browser-only.
- Explicit `cascade/gpu` RGBA8 texture readback, with padded-row removal and
  cancellation cleanup. Graph texture transport remains outside this stage.
- `run --frames ... --json` returns an image manifest and adapter metadata;
  `--timeout <ms>` runs a supervised render process for agent/test callers.
  Dedicated opt-in hardware and packed-package gates exercise real GPU output.
- Documented the decision, local/unreleased status, CLI manifest contract,
  verification evidence and platform limits in [Headless GPU](doc/HEADLESS_GPU.md).

## 0.3.1

### Fixed

- **A stored value equal to its default is no longer dropped on save.** A prop declaring a default expression would start animating on reload if you set it *back* to its default: the save filters out any parameter matching its default, so nothing was written and the expression re-applied to a number you had chosen. Shipped in 0.3.0. Diagnosed and fixed by Marcus's Codex session.

  The lesson is in how it survived three tests. Every proof of "a stored value beats the default expression" used a value obviously *different* from the default — `7` against `2`, `7` against `0`, `0.4` against `0` — because a distant value reads as the stronger test. Only *equal to the default* fails, and the boundary was the case nobody tried. The regression test now saves and reloads, because the fault is in what gets written rather than in what gets read.

- **A browser-only node is refused on the run path again.** A change earlier the same day made the static checker's downgrades apply to execution too, so `cascade run` executed a browser node headlessly and failed on an undefined capability instead of reporting that it needs a browser. The run gate is now separate from static classification: only a stranded `params` value is tolerated.

- **`cascade run` reports stranded `params` values.** Previously only `cascade check` did, so a run went onto the defaults in silence.

### Added

- **A `gpu` capability, stage one of WebGPU support.** One `GPUDevice` per page, shared by every node that declares the capability, with somewhere to keep a compiled pipeline between cooks. No `texture` port yet, so nodes still exchange images and the rendered picture is unchanged — what it removes is each node holding its own device, which is what made two GPU nodes unable to share anything. Design: `PLAN webgpu` in the vault.

## 0.3.0

Two features carry the minor bump: an **animation system** and an **agent console**. Everything else is either a consequence of those or a fault they exposed.

### Animation

- **A timeline panel** with transport, a playhead, scrubbing and a dope sheet.
- **Keyframe channels** on parameters — a third binding beside the raw value and the expression, resolved in one place (`Node.evalParm`: channel, then expression, then value). Constant, linear and smooth interpolation.
- **Houdini's gestures**, because they are the ones people already have in their hands: alt-click a parameter to set a key, ctrl-click to delete one, right-click to open its channel.
- **Expressions on parameters**, evaluated by the neutral runtime so a headless cook resolves them with the same code Studio does. `$F`, `$FF`, `$T` (zero on frame 1, as in Houdini), `$FPS`, `ch()`, `chs()`, `chv()`, plus the maths library exposed bare — `sin(...)`, not `Math.sin(...)`. Angles are radians.
- **Offline rendering.** `cascade run` renders a graph cold, `--frames 1-100` writes a sequence, and image nodes rasterise through Skia (`@napi-rs/canvas`, an optional dependency) rather than a browser. Measured against Studio's own render of the same node at a maximum channel difference of 1.

### The agent console

- **A coding agent per sketch**, running in the project directory, with a document watcher so the graph picks up what it rewrites without a reload.
- **It reconnects rather than stranding.** A run belongs to the server, not to the HTTP request, so closing the browser detaches a reader and nothing else. Reopening replays the buffered transcript from a sequence number and rejoins the live stream.
- Only commands in the project's own `cascade.json` allowlist are launched, and the document is saved before the prompt is handed over.

### Authoring

- **A right-click menu on nodes**, a **Definition panel** naming where a node comes from, and the Inspector's parameter list becoming *Parameters*.
- **Retargeting a node keeps the parameters someone tuned.**
- **Extract and embed**, both ways: lift a node out of the graph into a file, or pull an external node in to make local edits. Relative imports are rewritten with the module so neither direction breaks.
- **A generated node reference**, so the built-in library documents itself.
- Dynamic nodes are no longer called "legacy". Statically inspectable ES modules are the preferred style, and definition-v1 nodes are classified by their definition rather than only by their exports.
- **Parameters and props are one store.** They were two, which is why expressions and keyframes were unreachable from the `param()` declaration every sketch actually uses.

### Portability

- Image nodes ask the host for a drawing surface instead of reaching for `document`, so the same node renders in the browser and headless. `runsOn` defaults to `portable` for an undeclared module rather than `browser`.
- **`cascade run` executes the standard node library.** It never registered the class-based nodes, so every `cascade.image.*` threw `Unknown Cascade node type` and a graph built in Studio would not render headlessly. The registration lived beside Vite `?raw` imports, which do not resolve under Node.
- **`cascade.geo.SvgExport` can write from the CLI.** It declares the `assets` capability, which only the browser supplied — so `validate` and `check` both passed on a graph that then refused to run. The Node host provides it through the existing `cascade/io` policy, so writes stay confined to `.cascade-cache/`.

- **`validate` and `check` run against the host that would run the graph.** They used to construct a *different* host from `run` — the runner installed `shell` and `assets`, the static commands installed nothing and never called the runtime's preflight — so both printed "passed" on a graph that then refused to run. The static path now runs the same code `run` throws from, and reads what the host provides rather than keeping its own list. An unsatisfiable capability is an error; a node declaring `runsOn: 'browser'` is a warning, because it asserts nothing about the CLI.

### Packaging

- **Published as `@field/cascade`, under MIT.** Scaffolded projects alias it, so `cascade` in a project's imports is this package and not the unrelated `cascade` on npm.
- An installed copy compiles `cascade/shell`; the Studio's browser dependencies are no longer runtime dependencies.
- Types ship for `cascade/io` and `cascade/net`.

### Interface

- Slimmer panel tabs, and a control to fold a group down to a hairline.
- `View > Focus <panel>` opens a panel that is not there rather than doing nothing, on ⌘1 through ⌘7.
- Node names and parameter names are drag sources carrying their address, so a path can be dragged into the agent console instead of typed.
- Text zoom in the agent console on the standard keys, scoped to the panel under the pointer.

### Fixes worth naming

Each of these was silent — nothing errored, and the interface looked correct.

- **Studio never handed the graph to the engine context**, so `markTimeDependentDirty()` marked nothing and scrubbing the timeline recooked nothing at all. `ch()` paths could never have resolved either.
- **Every geometry fingerprinted to the constant string `"object:x:"`**, because the fingerprint read `width`/`height`/`size` and a `Geometry` has none of them. The viewer's first raster stayed on screen for the session, so parameter changes appeared to do nothing on any geometry node.
- **A browser reload sent SIGTERM to the running agent**, mid-edit, every time.
- **`graph.execute()` was not always a full render**: a node that never cooked was still marked clean, because it "ran" during port discovery with empty inputs. A cold `cascade run` could silently drop its terminal node.
- **An image drawn without `await image.decode()`** reports the right dimensions and paints nothing.
- An expression badge that never recomputed, so `$T * 0.5` read `0` at every frame.

## 0.2.22 and earlier

Not recorded. This file starts at 0.3.0.
