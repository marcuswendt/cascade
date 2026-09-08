# Changelog

Notable changes to Cascade. Newest first.

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
