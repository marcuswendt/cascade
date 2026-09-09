# Browser player

The player runs a compatible graph in a browser without Studio or a Cascade
server. Available in Cascade 0.5+. Install `@field/cascade@latest`, or build the
checkout when developing Cascade itself.

## Build and launch

From a project containing `index.cascade`:

```sh
cascade build index.cascade --out web-player
```

The output directory must not already exist. It contains `index.html`,
`player.html`, `app.js`, `embed.js`, and any included assets. Serve that directory
with an ordinary static HTTP server or hosting service, then open `index.html`.
Do not open it through `file://`: browser module and asset loading requires HTTP.
No application backend is required. WebGPU needs a supported browser/device and
a secure context such as HTTPS or localhost.

Graph definitions are inspected and compiled at build time, not executed.
The build rejects unsupported server capabilities, server transport imports,
Node dependencies and dynamic node modules. It does not publish or upload files.

## Embed

For a simple embed, including across origins:

```html
<iframe src="/artwork/player.html" title="Generative artwork"
  style="width:100%;height:600px;border:0"></iframe>
```

For programmatic controls on the **same origin**:

Give the host container an explicit height, for example
`<div id="artwork" style="height:600px"></div>`. The iframe fills that container.

```js
import { mount } from './web-player/embed.js';

const player = await mount(document.querySelector('#artwork'), {
  frame: 1,
  fps: 30,
  autoplay: false,
  output: { nodeId: 'render', port: 'image' },
});

await player.setProp('render', 'strokeWidth', 2);
await player.seek(48);
player.play();
// Later, when the host view is removed:
await player.dispose();
```

The generic `mountPlayer` export from `cascade/player` accepts the same options
plus `url`, pointing to a built `player.html`. Each mount creates an iframe, so
two sketches can use the same node IDs and cache filenames without sharing data.
Programmatic cross-origin control is not provided; use the iframe directly.

Mount resolves after the first successful cook and display. A failed startup
rejects and removes the failed embed. Playback starts paused unless requested;
runtime failures pause playback and expose their diagnostic. Frame work is
serialized and playback coalesces requests instead of building a catch-up queue.

## Controls and output

`PlayerController` provides:

- `play()`, `pause()`, `seek(frame)`.
- `setInput(nodeId, name, value)` and `setProp(nodeId, name, value)`, which await
  the resulting cook.
- `selectOutput(nodeId, port)` and `getOutput(nodeId, port)`.
- `downloadOutput()`, returning the selected output as a `Blob`.
- `resize(width, height)` for the display, without changing authored resolution.
- `subscribe(listener)` for `frame`, `playing` and `error` events; returns an
  unsubscribe function.
- `dispose()`, which stops work and releases runtime, GPU, image and iframe resources.

Output selection defaults to the last renderable output in the run result;
select a node and port explicitly when a graph has several deliverables. Images/SVG and
geometry/scenes are displayable; scene rendering currently uses the shared CPU
wireframe/point renderer, not a shaded GPU renderer. Camera conventions match
Studio and offline rendering. For durable image retention, obtain a Blob:
image references returned by `getOutput` are current-frame references, not an
archive of every rendered frame.

## Assets and resource limits

Literal typed image/asset references in graph inputs or props are included
automatically. Files whose paths are computed in node code must be listed:

```sh
cascade build index.cascade --out web-player --asset assets/photo.png
```

Repeat `--asset` for additional files. Only those files are copied, preserving
project-relative paths below the output's `assets/` directory. Directories,
hidden files, path traversal and symlinks escaping the project are rejected.
The builder never copies the entire project, credentials, Python environments
or cache directories. Review authored graph values and custom code before
publishing: project modules are trusted code, not a sandbox.

The player supplies one asset store for declared `assets` capabilities and
existing `cascade/io` imports. Reads resolve packaged files; writes stay in
memory and create immutable references. `mediaUrl` resolves through that store,
not Studio's `/api/media`. Server-only preview transformations are unsupported
and fail explicitly rather than returning different pixels silently.

Generated encoded assets are limited to 256 MiB and 4,096 entries per iframe.
After a cook, assets no longer reachable from graph outputs, authored/controller
values or active display leases are released. Feedback history keeps referenced
images alive. Exceeding the live budget fails with a diagnostic; live images
are not silently replaced or evicted. Disposal revokes all generated URLs.

## Host limits

| Graph requirement | Static player |
| --- | --- |
| Definition-v1 CPU nodes, core/geometry/POP/scene built-ins | Supported |
| Canvas drawing and compatible `cascade/io` helpers | Supported |
| Declared `assets` | Packaged inputs and in-memory generated outputs |
| Declared `gpu` | Browser WebGPU, if available; no Dawn in the browser |
| Python, shell, filesystem, Studio/server transport | Rejected |
| Dynamic modules or mixed execution styles | Rejected |
| Project Studio panels | Not included |

Separate heavy preprocessing from the live graph when possible: export its
result as an explicit asset, then build the browser-compatible graph around
that input. The player does not emulate server operations or carry credentials.
