# CLI reference: editing graphs

Everything an agent needs to build or change a `.cascade` graph without hand-editing JSON. Each command is one graph concept (node, wire, parameter, subnet), checks the edit with the same code as `cascade check`, and writes the file atomically. Running, rendering, exporting and locks are listed under [The other commands](#the-other-commands); see also `cascade --help`, `doc/EDITOR_EXPORT.md` and `doc/WEB_PLAYER.md`.

## The guarantees

- **Minimal diffs.** Only the keys an edit is about change. Node ids are stable, untouched nodes keep their place, a new key goes where Studio would write it, and the file keeps its own formatting: Studio's compact arrays, or plain `json.dump` indentation with `1.0` and `—` left as they were. An edit followed by its inverse leaves the file byte-identical (`tests/graph-edit.test.ts`).
- **Tidy placement.** A new node waits in a lane beside the graph until it is wired; the first `connect` moves it one step along the existing flow from its neighbour, beside anything already there. Studio flows top to bottom, and a graph laid out some other way (cloud-plots' diagonal stages) is followed instead. `--no-layout` leaves positions alone; `--at x,y` places a node exactly.
- **Closed subnets.** No wire crosses a subnet boundary directly. Connecting across one, moving nodes in or out, or grouping nodes routes the wire through the subnet's `Input` and `Output` nodes, named after what they carry (`motif-out-geometry`), reusing one that already carries the same value and removing one that is no longer used.
- **Refused, not broken.** An edit that would make `cascade check` fail (a cycle, a wrong type, a misspelt parameter, a value of the wrong type) is refused and nothing is written. A graph that already failed can still be repaired one edit at a time: only new failures count. A file that changed on disk while the edit ran (Studio saved, another agent wrote) is not overwritten.

## Commands

| Command | What it does |
| --- | --- |
| `cascade graph create <graph> [--name <title>]` | A new empty graph. Never overwrites. |
| `cascade graph read <graph> [--in <subnet>]` | Nodes with stored parameters, subnets with their ports, wires as `a.out -> b.in`. |
| `cascade graph list [dir]` | Every `.cascade` under a directory, with node and wire counts. Skips `renders/`, `out/`, `dist/` and `node_modules/` below it. |
| `cascade node add <graph> <type> [--name <id>] [--in <subnet>] [--set k=v]... [--at x,y] [--comment <text>]` | Add a node. `<type>` is a module id or a short name: `Circle` is `cascade.geo.Circle`, `InkVocabulary` is `project.InkVocabulary`. The id defaults to the type in kebab case (`copy-to-points`, then `copy-to-points-2`). |
| `cascade node rm <graph> <node> [--recursive]` | Remove a node and its wires. A subnet with children needs `--recursive`. |
| `cascade node move <graph> <node>... [--to <subnet\|root>] [--at x,y]` | Move existing nodes without remove and re-add: into a subnet or out to the top level (rewired at each boundary), and/or to a canvas position (the first node lands at `x,y`, the rest keep their offsets). Parameters, comments and wires stay. Alias `node mv`. |
| `cascade connect <graph> <node.output> <node.input> [--no-layout]` | Wire two ports. A port can be left off when the node has one on that side. An input that was fed is rewired, and the old wire is reported. |
| `cascade disconnect <graph> <node.output> <node.input>` | Remove that wire. With one argument, `<node.input>` removes whatever feeds it, `<node.output>` everything it feeds. |
| `cascade set <graph> <node.param> <value>` | Store a value, read by the parameter's declared type: `0.5`, `true`, `640,480`, `#f4f1ea`, `"300"`. A value equal to the default is not stored. |
| `cascade set <graph> <node.param> --expr '<e>'` / `--clear-expr` | Bind or remove an expression (`$T * 0.1`). Props only. |
| `cascade set <graph> <node.param> --key 0=1 --key 120=1.4 [--interp linear]` / `--remove-key 120` | Set or remove keyframes on the prop's channel. Interpolation is `constant`, `linear` or `smooth` (the default). |
| `cascade set <graph> <node.param> --unset` | Forget the stored value and its bindings. |
| `cascade subnet create <graph> <node>... [--name <id>] [--label <text>]` | Group sibling nodes. The subnet takes the place of the first of them in the flow. |
| `cascade subnet move <graph> <node>... --to <subnet\|root>` | Move sibling nodes into a subnet or out to the top level, rewiring at each boundary. |
| `cascade subnet dissolve <graph> <subnet>` | Lift the nodes back out and remove the subnet. The inverse of `create`. |
| `cascade edit <graph> <operations.json \| ->` | A batch, all or nothing. Each operation is the JSON below. |

Every edit takes `--dry-run` (check, write nothing) and `--json`.

## The other commands

Running, sharing, locks and Studio. `cascade --help` has their options; `cascade render --help` and `cascade lock --help` have their own.

| Command | What it does |
| --- | --- |
| `cascade [project-directory \| graph-file]` | Open Studio on a project or graph. |
| `cascade new <name>` | Create a Cascade project. |
| `cascade node <Name> [project-directory]` | Create a deterministic custom node. |
| `cascade projects [directory]` | Show or set the default projects directory. |
| `cascade serve start\|stop\|restart\|status\|logs\|install` | Run Studio as a managed background service. |
| `cascade run <graph-file> [options]` | Cook a graph headlessly; `--frames` renders a sequence. |
| `cascade render <graph-file>` | Render an animation across worker processes, then a preview video. |
| `cascade validate <graph-file>` | Validate a graph file without executing. |
| `cascade check <graph-file>` | Statically check node definitions, types and graph structure. |
| `cascade inspect <graph-file>` | Every node with its classification and full definition. |
| `cascade parity <graph-file>` | Cook headless twice and through Studio's path; report per-node differences. |
| `cascade build <graph-file> --out <new-directory>` | A standalone browser player ([WEB_PLAYER.md](WEB_PLAYER.md)). |
| `cascade export <graph-file> (--plan \| --out <dir>)` | The graph's published editor as a static site ([EDITOR_EXPORT.md](EDITOR_EXPORT.md)). |
| `cascade share <graph-file \| site-directory> [--name <slug>] [--scope <team>] [--protected]` | One link for the team: export the editor (or take a static directory with an `index.html`), deploy it to the Vercel project `cascade-<slug>` (team `field-io`), print the production URL (`data.url` with `--json`) and record it in the project's `shares.json`. Public unless `--protected` ([EDITOR_EXPORT.md](EDITOR_EXPORT.md#share-as-a-link)). |
| `cascade publish <graph-file> <node>.<prop>` | Publish a node prop as an editor parameter. |
| `cascade freeze <graph-file> <node> --fields <a,b>` | Snapshot chosen fields of a live data source for export. |
| `cascade scene <graph-file> <scene.json> --out <new-graph-file>` | Apply a scene file to a copy of the graph. |
| `cascade mcp [project-directory]` | Serve these commands as MCP tools over stdio ([MCP.md](MCP.md)). |
| `cascade lock <graph-file> <node> --name <name>` | Record a render (graph, params, seeds, inputs, code) in `locks/<id>.json`. |
| `cascade lock verify [<lock-id>...]` | Replay locks and report which still match. |
| `cascade replay <lock-id>` | Re-render a lock from its stored code and compare fingerprints. |
| `cascade locks` | List the project's locks. |
| `cascade ladder <graph-file> <node> --name <name> --vary <node.prop>=<a,b,c> \| --seeds <a,b,c> [--cairn <vault dir> [--vault <dir>]]` | Cook 3 to 5 variants (values zipped across params, or graph seeds) from the stored code; write `ladders/<id>/<n>.png`, a labelled contact sheet `ladders/<id>/sheet.png` and the record `ladders/<id>.json` (per variant: graph, params, seed, inputs, fingerprint; the code and git commit once). `--cairn` copies each variant to `<dir>/<id>-<nn>.png` and prints a `cairn:choice` card (`--json`: `data.cairnChoice`) to post in the Cairn chat; see [Picking on the phone](#picking-a-ladder-variant-in-cairn). |
| `cascade pick <ladder-id> <n> [--name <lock name>]` | At approval, write `locks/<id>.json` for variant `n` from the ladder's record, without cooking again; `cascade replay` reproduces that image pixel for pixel. |
| `cascade help node [<type>] [--project <dir>]` | A node type's inputs, props and outputs (type, default, range, description), where it runs and its capabilities, read from the installed package or the project's `nodes/`; without a type, every node type. No repository checkout needed. |
| `cascade doctor [project-directory] [--fix]` | What a headless run here will find: the declared Python environment, the stage interpreter, ffmpeg, the canvas. `--fix` builds the environment. See [Python for stages](#python-for-stages-cascadejson-python). |

Every verb is one row in `src/cli/verbs.ts`: its usage and summary for `--help`, the handler that runs it, how it treats `--json`, and the MCP tools that call it. A new verb is a row there, its handler, and its line here (`tests/cli-verbs.test.ts` checks both this page and [MCP.md](MCP.md)).

## `--json`, on every command

Every command, not only the editing ones, prints one envelope on stdout and nothing else:

```json
{ "ok": true, "data": { "file": "/…/index.cascade", "changed": true, "results": [
  { "op": "set", "node": "render", "param": "strokeWidth", "field": "props", "before": 2, "after": 3 } ] },
  "warnings": [] }
{ "ok": false, "error": { "message": "render has no parameter \"strokewidth\"; props: size, filename, …" }, "warnings": [] }
```

`data` is the command's structured result where it has one (the editing commands, `inspect`, `run`, `parity`), and `{ "output": [lines] }` for a command that only prints. What a command warns becomes `warnings`. The exit code is 0 for `ok` and 1 otherwise. `run --json` puts its manifest in `data`: the status, the seed, the path of the run trace in `.cascade/runs/`, the frames and files with `--frames`, and `stages`, one entry per Python stage call with its node, key and cache state (`hit`, `miss`, `off` and why). `parity --json` puts its report in `data`, with `data.ok` false when outputs differ; see [Seeds and parity](PROJECT_AUTHORING.md#seeds-and-parity).

## Operations, for `cascade edit` and the MCP server

```json
[
  { "op": "node.add", "module": "Circle", "id": "dot", "in": "motif", "set": { "radius": [0.2, 0.2] } },
  { "op": "connect", "from": "dot.geometry", "to": "copy.source" },
  { "op": "disconnect", "from": "a.out", "to": "b.in" },
  { "op": "set", "target": "render.opacity", "keys": [{ "frame": 0, "value": 0 }, { "frame": 48, "value": 1 }], "interpolation": "linear" },
  { "op": "set", "target": "render.strokeWidth", "expression": "1 + $T * 0.1" },
  { "op": "node.remove", "id": "old", "recursive": false },
  { "op": "subnet.create", "nodes": ["a", "b"], "label": "Motif" },
  { "op": "node.move", "nodes": ["c"], "to": "root", "position": { "x": 400, "y": 120 } },
  { "op": "subnet.move", "nodes": ["c"], "to": "root" },
  { "op": "subnet.dissolve", "id": "motif" }
]
```

Values in operations are JSON values, used as given and checked against the declared type.

## The TypeScript API

The CLI and the MCP server are thin layers over one API, so a script can use it directly:

```ts
import { GraphFile } from './src/cli/graphFile.js';

const graph = await GraphFile.open('index.cascade');
await graph.apply({ op: 'node.add', module: 'Circle', id: 'dot' });
await graph.apply({ op: 'connect', from: 'dot.geometry', to: 'render.scene' });
const { results, warnings } = await graph.save();
```

The editor itself (`GraphEditor`, `readGraph`, the operation types) is environment-neutral and exported from `@field/cascade/runtime`: it edits a parsed document in memory and asks a callback for node definitions, so a browser host can use the same code.

## A graph built from nothing

```sh
cascade graph create index.cascade --name "Built from the CLI"
cascade node add index.cascade Circle --set radius=0.18,0.18 --set divisions=6
cascade node add index.cascade Rectangle --set size=2,2
cascade node add index.cascade CopyToPoints
cascade connect index.cascade circle copy-to-points.source
cascade connect index.cascade rectangle copy-to-points.target
cascade subnet create index.cascade circle rectangle copy-to-points --label Motif
cascade node add index.cascade Transform --set rotate=0.4
cascade connect index.cascade copy-to-points transform.geometry     # routed out through motif-out-geometry
cascade node add index.cascade Camera
cascade node add index.cascade Render --set size=800,800 --set strokeWidth=3 --set 'background=#f4f1ea'
cascade connect index.cascade transform render.scene
cascade connect index.cascade camera render.camera
cascade set index.cascade render.opacity --key 1=0.25 --key 48=1 --interp linear
cascade check index.cascade && cascade run index.cascade --frames 1 --json
```

Opened in Studio, the top level reads `motif → transform → render`, with the camera beside `transform`, and `motif` holds the circle and rectangle side by side above `copy-to-points` and its output.

## Outputs as files (`run --out`)

`cascade run <graph> --out <dir>` copies each image output to `<dir>/<node>.<ext>`, or `<dir>/<node>.<port>.<ext>` for a node with more than one image output. With `--frames` the same names carry the frame: `<node>[.<port>].<frame>.<ext>`. Which outputs: every image output nothing downstream consumes (a `cascade.core.Null` passing an image counts), or those of `--node`; `--out-node <id>` (repeatable) adds a mid-graph node's. `--out` may be project-relative or absolute; `files` in the result is spelled the same way. `run --json` lists every image output as `data.images: [{ node, port, source, file? }]`, with or without `--out`. The MCP `cook` and `render` tools take `out` and `outNodes`.

## Picking a ladder variant in Cairn

Marcus picks on his phone, in the Cairn web chat, by tapping a picture; the tap locks it. The loop for an agent:

1. `cascade ladder <graph> <node> --name <name> --seeds 1,2,3 --cairn <vault>/<space>/_attachments/ladders/<id> --json` (`<id>` is the name lower-cased with dashes). Each variant is copied to `<dir>/<id>-<nn>.png`, and `data.cairnChoice` is the card. At most 8 variants.
2. Post `data.cairnChoice` in the reply exactly as returned:

   ````text
   ```cairn:choice
   {"prompt":"Dial: which one? (ladder dial, index.cascade render)","options":[{"label":"seed 1","value":"pick:dial:1","image":"Work/Projects/Cascade/_attachments/ladders/dial/dial-01.png"}, …]}
   ```
   ````

   `label` says what the variant changed (`seed 1`, `hue=0.3`); `image` is relative to the vault, the nearest `.obsidian` (then `.git`) above `--cairn`, or `--vault`.
3. A tap comes back as `Picked: seed 1 (pick:dial:1)`. Run `cascade pick dial 1 --project <project>` (MCP: `pick { "ladder": "dial", "variant": 1 }`).
4. Reply with the locked image, `![[<that option's image>]]`, and the lock id.

## Checks that fail a run (`cascade.assert.*`)

Put the check in the graph instead of a script beside it:

```sh
cascade node add index.cascade NotBlank --name poster-not-blank --set 'message="the poster rendered empty"'
cascade connect index.cascade render.image poster-not-blank.image
cascade node add index.cascade cascade.assert.Range --name density-ok --set min=0.2 --set max=0.8
cascade connect index.cascade stats.density density-ok.value
cascade run index.cascade --json      # exit 1: { "ok": false, "error": { "message": "Assertion failed in \"density-ok\" (cascade.assert.Range): value 0.93 is outside [0.2, 0.8]." } }
```

`Range` (a finite number in `[min, max]`), `Equals` (JSON-equal to `expected`, numbers within `tolerance`), `True`, and `NotBlank` (a PNG or PPM that is not one flat colour within `tolerance`, nor fully transparent). Each passes its input through and runs when the graph runs whole, or when the `--node` you name is downstream of it. An image wired only into assertions is still saved by `--out`. Headless only for now; see `doc/NODE_REFERENCE.md`.

## Debug output and environment (`.cascade/runs/`, `--env`)

Every run's trace in `.cascade/runs/<time>-<graph>.json` holds, per node, what it printed while it cooked: `console.log/info/warn/error/debug` from the node, and its Python stages' stderr, as `logs: [{ level, text }]` (500 lines per node, the rest counted in `logsDropped`). `run --json` gives the same lines as `data.logs: [{ node, level, text }]`. A failed run writes its trace too, and the error ends with `Run trace: <path>`. Each run (one per frame with `--frames`) carries `ms`, the cook; `frameMs`, the whole frame to its outputs on disk; and `saveMs`, the difference (collecting and writing the outputs), beside each node's own `ms`.

`--env NAME=value` (repeatable) sets a variable for the run: Python stages, the warm stage worker and `cascade render`'s worker processes see it, so `CLOUD_ANALYST_ONLINE=1` no longer needs a shell prefix. The trace records the names under `env`, never the values. The MCP `cook` and `render` tools take `env: { NAME: "value" }`.

## Python for stages (`cascade.json` `python`)

A project whose stages import numpy or Pillow declares them, and Cascade keeps a virtual environment for it in `.cascade-cache/python/venv` (inside the project, never system-wide):

```json
{
  "exec": { "stages": { "entrypoint": "runtime/node_cli.py" } },
  "python": { "requirements": ["numpy", "Pillow>=10"] }
}
```

`requirements` is a list of pip specifiers or a project-relative requirements file; `interpreter` (default `python3`) is what creates the venv. `cascade doctor` reports it as `current`, `missing` or `stale` (cascade.json changed since it was built); `cascade doctor --fix` creates or rebuilds it, moving an old one to `.cascade-cache/python/_archive/`. With none declared, doctor fails when a stage source imports numpy and the stage interpreter cannot (`stage imports`), which is how a project on the system Python renders nothing. While one is declared, stages run under its interpreter instead of a bare `python`/`python3` in `exec.stages.python` (a project-relative executable there still wins), and a stage call with the environment missing or stale fails with the command that fixes it, rather than later on an `ImportError`. MCP: `doctor { "fix": true }`.
