# Shareable editors

`cascade export` turns a graph into a small static website: a viewer, the
parameters you chose to publish, presets, scene files and export buttons. Send
the link to someone and they can change your scene, make new ones and send them
back, without Studio, an account or a server.

## The boundary: what leaves the project

An export is an allowlist. Read this before sharing anything.

- **Only the selected subgraph ships.** That is the nodes your published
  outputs and parameters depend on. Every other node, all annotations and
  comments, and the graph's metadata stay home. `--plan` lists both sides.
- **Only selected assets ship.** These are the files in `editor.assets`, the
  literal files a shipped prop points at, and the files of frozen snapshots.
  Nothing else is copied: not the project directory, `.cascade-cache`,
  credentials or Python environments.
- **Live data sources never ship.** A node that reads Observatory, a CLI, a
  cache, body data, the filesystem or a network is live. That means a
  `runsOn: 'server'` node, a node declaring `files`, `python` or `shell`, or a
  node declaring `source: 'live'`. Freeze it with `cascade freeze` into a
  snapshot of exactly the fields you name (one photo and a title, say). The
  export ships the snapshot in place of the node and drops everything upstream.
  If a live source is still wired in, the export fails and names it.
- **Personal fields are flagged.** Field names that look like notes,
  transcripts, calendar, body or health data, locations or contacts are marked
  PERSONAL in the plan, and so is any field you pass to `--personal`. Nothing is
  frozen unless you name it, so the default is the minimum.
- **Licensed, hidden and ignored files are refused.** These are anything under
  a `licensed/` directory, dotfiles such as `.env`, and anything git ignores.
  Licensed fonts are dropped into the editor by the person using it. They are
  read in their browser and never uploaded or bundled.
- **The built site is scanned before it is written.** The export stops if the
  site contains Turso/libSQL URLs, tokens, API keys, private keys, JWTs,
  `/Users/…`, `/home/…` or `~/` paths, Observatory endpoints, your home
  directory, or the value of any secret-looking environment variable or
  project `.env` entry.
- **The site makes no external calls.** It has no analytics. Its
  `vercel.json` sets a Content Security Policy that only allows its own
  origin, and it is marked noindex.
- **Scenes carry values, not project data.** A scene holds published parameter
  values and the files the person dropped. A file parameter marked
  `embed: "never"` (a licensed font) records only its name, size and SHA-256.

Every export writes `export-manifest.json`, listing each file, its size and
its source, each frozen field, and every PERSONAL flag. `cascade export --plan`
prints the same manifest without building anything.

## Make a graph shareable in 5 steps

1. **Publish the parameters** someone else may change:

   ```sh
   cascade publish index.cascade spec.capMm --label "Cap height" --group Type --min 3 --max 60 --unit mm
   ```

   This adds an entry to the graph's `editor.parameters`. In Studio, the
   `share` toggle beside a parameter in the Inspector does the same, with
   label, group and range fields. You can also edit the JSON directly (see the
   format below).

2. **Declare the outputs.** Add them to `editor.outputs`: one with `view: true`
   is shown in the viewer, and each one gets an export button (`png`, `svg`,
   `json` or `text`). Name the parameters that belong beside a button (dpi,
   ground) in its `parameters`.

3. **Freeze any live source** on the published path. Name exactly the fields to
   keep:

   ```sh
   cascade freeze index.cascade moment --output moment --fields photos[0],instant --personal instant
   ```

   This writes `frozen/moment.json` plus any files those fields refer to.
   Review them and commit them.

4. **Review the plan.** Check the nodes, files and PERSONAL flags:

   ```sh
   cascade export index.cascade --plan
   ```

5. **Build, and deploy if you want to:**

   ```sh
   cascade export index.cascade --out export/site
   cascade export index.cascade --out export/site --deploy vercel --project my-editor --scope field-io
   ```

   `--out` replaces only a previous export. `--deploy vercel` links in a scratch
   directory, so no `.env.local` can land in the site. It deploys to
   production, then checks that an anonymous request to
   `https://<project>.vercel.app` is refused. If it is not, it says to turn on
   Vercel Authentication. Add `--public` when the editor is meant to be open to
   anyone: a readable site is then reported as intended instead of failing.

## The `editor` section

It sits beside `nodes` in the `.cascade` file. The runtime ignores it, and
Studio keeps it verbatim when it saves. The types are in
`packages/contracts/src/editor.ts`.

```json
"editor": {
  "id": "cloud-type",
  "title": "Cloud Type",
  "groups": ["Input", "Focus", "Export"],
  "parameters": [
    { "id": "text", "node": "type-set", "prop": "text", "label": "Text", "group": "Input", "control": "textarea" },
    { "id": "font", "node": "type-set", "prop": "font", "control": "file", "accept": [".otf", ".ttf"], "embed": "never",
      "help": "Drop your licensed font. It stays in your browser." },
    { "id": "angle", "node": "focus", "prop": "angle", "control": "slider", "min": -90, "max": 90, "unit": "°",
      "visibleWhen": { "param": "field", "equals": "tilt" } },
    { "id": "seed", "node": "spec", "prop": "seed", "control": "seed" }
  ],
  "outputs": [
    { "id": "preview", "node": "preview-svg", "port": "svg", "format": "svg", "view": true },
    { "id": "png", "node": "png", "port": "image", "format": "png", "parameters": ["dpi", "pngGround"] }
  ],
  "presets": [
    { "id": "soft", "label": "Soft", "values": { "strength": 1 }, "keep": ["colour", "font"] }
  ],
  "assets": ["assets/fonts/InterDisplay-Medium.otf"],
  "fonts": [{ "family": "DM Mono", "file": "assets/fonts/DMMono-Regular.woff2", "license": "OFL-1.1", "weight": 400 }],
  "freeze": [{ "node": "moment", "output": "moment", "snapshot": "frozen/moment.json" }],
  "panel": { "module": "editor/panel.ts", "placement": "extend" },
  "inspect": true
}
```

`fonts` ships open-licensed fonts with the site and loads them in the page
(`@font-face`) and in the engine worker (`FontFace`), so a panel or a canvas
that names the family draws with it. Each entry must say `"license": "OFL-1.1"`;
anything else, or a file under `licensed/`, is refused.

- **Parameter `id`** is the key a scene uses. It survives renaming the node
  or the prop, so keep it stable.
- **`control`** is one of `number`, `slider`, `int`, `bool`, `select`
  (`options`, bare or `{ value, label }`), `text`, `textarea`, `color`, `file`
  (`accept`, `embed`), `seed` (with a Reroll button) and `vec2`. If omitted,
  it comes from the prop's type.
- **`visibleWhen`** takes `{ param, equals | in | not }`, or a list of them
  that must all hold.
- **Presets** set the values they name and reset everything else to the graph's
  value, except the ids listed in `keep`. The editor also offers "Graph
  defaults".
- **`panel`** is optional project code for the editor. It exports
  `mount(target, api)` and may return a disposer. The `api` has `get`, `set`,
  `values`, `subscribe` and `output`. A Svelte component works if the project
  has `svelte` installed, because the export compiles `.svelte` imports with
  the project's own compiler. `replace` hides the generated parameters.
- **Inspect** shows every stage and each of its outputs, read-only: geometry
  drawn, images and SVG shown, and anything else as JSON.
- **`peek`** lists the parameter ids a phone keeps in reach at the bottom
  sheet's lowest snap point, such as `["text", "seed"]`. By default these are
  the first text and seed parameters.
- **`draft`** sets values that are cooked while someone drags a slider on a
  phone, such as `{ "density": 0.5 }`. The preview is quicker during the drag,
  and the real values cook again on release. Draft values never reach a scene
  or an export.

## On a phone

The same export works on a phone without any extra setup. The preview fills the
top of the screen. Pinch to zoom, drag to pan, and double-tap to fit. The
controls sit in a bottom sheet with a handle and three snap points (peek, half
and full), and the groups start folded. Every control is at least 44 px with
16 px text, and numbers have − and + steppers. The header shrinks to the title
and a ⋯ menu, which holds the presets, the scene buttons, Inspect stages, the
exports and the last cook time. A pulsing dot shows the graph is cooking. Exports and
saved scenes open the share sheet (Save to Files, Photos, AirDrop) and fall back to a
download. File controls open the file picker. In landscape, the controls move to a side
panel. Desktop is unchanged.

## Scene files

A scene is what someone saved in an editor (`*.scene.json`):

```json
{
  "format": "cascade.scene",
  "version": 1,
  "graph": { "id": "cloud-type", "version": "h77d97e88f213c05d" },
  "name": "Derya, cover v2",
  "values": { "text": "CLOUD\nOBSERVATORY", "strength": 0.3, "seed": 11 },
  "files": {
    "font":  { "name": "HelveticaNowDisplay-Md.otf", "size": 81234, "sha256": "…" },
    "image": { "name": "sky.png", "mediaType": "image/png", "size": 50211, "sha256": "…", "data": "<base64>" }
  },
  "savedAt": "2026-10-11T15:00:00Z"
}
```

- **`graph.version`** is a hash of the editor id, the parameter interface and
  the structure of the exported subgraph. Tuning a value in Studio leaves it
  unchanged. Rewiring the graph or renaming a published parameter changes it.
- **A mismatch degrades rather than failing.** Another version or editor id is
  a warning. Unknown parameters are ignored with a warning. A value of the
  wrong kind is skipped with a warning. Missing parameters take the graph's
  values.
- **Files:** a file up to 2 MB is embedded unless its parameter says
  `embed: "never"`. A referenced file is matched by name and hash. In the
  editor, that is a file the person dropped before in the same browser. In
  Studio or the CLI, it is a file of that name under `assets/` (including
  `assets/fonts/licensed/`) or `licensed/`. If no match is found, the graph's
  file is kept and the person is told what to supply.

**Where scenes open:**

- **Exported editor:** "Open scene…" and "Save scene", or drop a
  `.json` file on the viewer.
- **Studio:** File › Open Scene… applies a scene to the open graph as an
  unsaved edit. Embedded files go into the project's `assets/`. File › Save
  Scene… writes one.
- **CLI:**
  - `cascade scene index.cascade s.scene.json --out new.cascade` writes a copy of the graph with the scene applied.
  - `cascade run index.cascade --scene s.scene.json --write preview-svg.svg=out.svg` renders with a scene and writes a chosen output.

The same scene gives byte-identical output in the editor and under `cascade run`.

## Limits

- Only browser-runnable definition-v1 nodes ship. Python, shell and dynamic
  nodes are listed together as "not exportable". Port them to TypeScript, or
  freeze their output.
- The editor cooks in a module worker. Unchanged stages are reused
  (`run({ reuse: true })`), so only the stages after an edit re-cook, and the
  page stays responsive while they do. Values cross to the page by structured
  clone; a value that cannot be cloned is shown as a description.
- In Studio, a parameter's `share` toggle in the Inspector publishes it, with
  label, group and range fields. Presets, outputs, `visibleWhen` and help text
  are still edited with `cascade publish` or in the JSON.
