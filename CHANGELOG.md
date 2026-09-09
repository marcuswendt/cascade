# Changelog

Notable changes to Cascade. Newest first.

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
