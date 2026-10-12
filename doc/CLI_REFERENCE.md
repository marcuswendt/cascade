# CLI reference: editing graphs

Everything an agent needs to build or change a `.cascade` graph without hand-editing JSON. Each command is one graph concept (node, wire, parameter, subnet), checks the edit with the same code as `cascade check`, and writes the file atomically. For running, rendering and exporting, see `cascade --help`, `doc/EDITOR_EXPORT.md` and `doc/WEB_PLAYER.md`.

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
| `cascade graph list [dir]` | Every `.cascade` under a directory, with node and wire counts. |
| `cascade node add <graph> <type> [--name <id>] [--in <subnet>] [--set k=v]... [--at x,y] [--comment <text>]` | Add a node. `<type>` is a module id or a short name: `Circle` is `cascade.geo.Circle`, `InkVocabulary` is `project.InkVocabulary`. The id defaults to the type in kebab case (`copy-to-points`, then `copy-to-points-2`). |
| `cascade node rm <graph> <node> [--recursive]` | Remove a node and its wires. A subnet with children needs `--recursive`. |
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

## `--json`, on every command

Every command, not only the editing ones, prints one envelope on stdout and nothing else:

```json
{ "ok": true, "data": { "file": "/…/index.cascade", "changed": true, "results": [
  { "op": "set", "node": "render", "param": "strokeWidth", "field": "props", "before": 2, "after": 3 } ] },
  "warnings": [] }
{ "ok": false, "error": { "message": "render has no parameter \"strokewidth\"; props: size, filename, …" }, "warnings": [] }
```

`data` is the command's structured result where it has one (the editing commands, `inspect`, `run --frames`), and `{ "output": [lines] }` for a command that only prints. What a command warns becomes `warnings`. The exit code is 0 for `ok` and 1 otherwise. `run --frames --json` puts its render manifest in `data`.

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
