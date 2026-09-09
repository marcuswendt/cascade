# Subnet persistence and shell execution

> **Status**: Ready to implement
> **Author**: Marcus Wendt <marcus@field.io>
> **Written**: 2026-08-29
> **Scope**: `src/nodes/Graph.ts`, `server/src/routes/`, `server/src/runtime/`, `server/src/project.ts`

Two independent changes, both found by building a real project against the
current core (`Cascade/my-artwork`, 23 node modules). Neither is
speculative: each one is a workaround that project is carrying today.

They can be implemented in either order by different people. Part 1 is small
and mostly mechanical. Part 2 is a new route and a new runtime module.

---

# Part 1 — Native subnet support

## What is already true

Subnets are, at runtime, finished. Do not rebuild any of this:

| Capability | Where |
|---|---|
| `SubnetNode`, `InputNode`, `OutputNode` | `src/nodes/core/nodes/` |
| Ports derived from child Input/Output nodes | `SubnetNode.syncPorts()` |
| Collapse a selection into a subnet (Cmd+G) | `Canvas.svelte:274` `collapseIntoSubnet()` |
| Dive in, exit, breadcrumbs, path bar | `Canvas.svelte:118–205` |
| Render only the current network's children | `Canvas.svelte:231–238` `getVisibleElements()` |
| Value flow in and out of the subnet | `SubnetNode.update()` |

A subnet you build by hand works. It stops existing the moment you save.

## The actual gap

`parent` is never written and never read. Grep `parent` in `src/nodes/Graph.ts`
— three hits, all in an unrelated parameter-path lookup. So:

- `nodeToJSON()` (`Graph.ts:1130`) emits `id`, `module`, `position`, `source`,
  `params`, `inputs`, `props`, `color`, `state` — and no parent.
- `fromJSON()` (`Graph.ts:1255`) creates every node flat, with `parent` null.

Reload a graph and every subnet is an empty box with its children scattered at
the root. `Graph.ts:212` says as much in a comment: *"When subnets are
implemented, this will traverse the hierarchy"*.

The two bookkeeping structures already exist and are both populated at runtime:
`graph._elements` is a flat list holding **every** node including children, and
`node.parent` / `subnet._children` carry the hierarchy on top of it. Only the
second one is lost on save.

## The change

### 1.1 Format: flat list plus a `parent` id

Do **not** nest children inside their subnet in the JSON.

```json
{ "id": "destruction", "module": "cascade.core.Subnet", "position": [1040, 700], "source": "stdlib" },
{ "id": "destroy-blur", "module": "project.destroy-blur", "position": [120, 40], "parent": "destruction", "source": "project" }
```

Three reasons the flat form is right here, and they are worth stating because
nesting is the obvious first instinct:

- **Ids are already globally unique.** `Graph.ts:169` dedupes across the whole
  element list, not per level. A parent id is therefore unambiguous.
- **Connections address elements by id and already cross subnet boundaries.**
  The connection format is `[[elementId, portIndex, portName], [...]]`. Nesting
  would force either a path syntax or a rewrite of connection resolution;
  a parent pointer needs neither.
- **The diff stays inside two functions.** Nesting means rewriting the loader.

`parent` is omitted for root-level nodes, so **every existing file loads
byte-identically**. No version bump is required. Bump `GRAPH_FORMAT_VERSION`
to `0.3` only if you also do 1.5.

Child `position` is **relative to the subnet's own position** — that is what
`collapseIntoSubnet()` already writes (`Canvas.svelte:341–345`). Keep it, and
say so in a comment, because it is not guessable from the field name.

### 1.2 `nodeToJSON` — write it

```ts
if (node.parent) result.parent = node.parent.id;
```

Place it beside `color`, which is the closest existing analogue: a structural
choice the author made that belongs in the file.

### 1.3 `fromJSON` — restore it, in the right order

The order is the whole of the difficulty. A subnet has no ports until
`syncPorts()` has seen its Input/Output children, and connections cannot attach
to ports that do not exist yet.

After the existing node-creation pass and **before** connection restoration:

1. **Link.** For every node with a `parent` field, look up the parent and call
   `parent.addChild(child)` when it exists, falling back to setting
   `child.parent` and pushing to `_children` — the same two-branch shape
   `Canvas.svelte:264` `addChildToNetwork()` already uses. Extract that helper
   somewhere shared rather than writing it a third time.
2. **Sync, deepest first.** Walk the subnets in reverse depth order and call
   `syncPorts()` on each. Deepest first matters for nested subnets: an inner
   subnet must have its ports before the outer one counts its children.
3. Let connection restoration run as it does now. It is already retried across
   passes (`Graph.ts:1677` `restoreConnections()`), so a port that appears late
   is handled — but do not rely on that to paper over a wrong sync order,
   because the retry only fires on the next cook.

Note that `inputIndex` / `outputIndex` need no work: they are `addParm` props
on the Input/Output nodes and already round-trip through `result.props`.

### 1.4 Malformed input

A graph file is hand-editable and generated by scripts, so all three of these
will happen:

- **`parent` names a node that does not exist** — load the child at root and
  `console.warn` with both ids. Never drop the node.
- **A parent cycle** — detect during linking, break the offending link, warn.
  A cycle would otherwise hang the depth walk.
- **`parent` on a node whose parent is not a network** (`isNetwork()` false) —
  warn and load at root.

### 1.5 Two related bugs, worth fixing in the same pass

- **`Graph.nodeByPath()` (`Graph.ts:205`) is flat.** It splits the path and
  then returns `getNode(lastSegment)`, ignoring every segment before it. Make
  it walk `children()` properly. The path bar in the canvas and
  `Node.node(relativePath)` both depend on it, and the latter is how one node
  references another's parameter.
- **`Graph.removeElement()` (`Graph.ts:229`) does not remove children.**
  Deleting a subnet leaves its children in `_elements` with a dangling
  `parent`, which makes them invisible at every level — they are filtered out
  of the root by `!el.parent` and out of every network by
  `el.parent === network`. Remove children recursively, and remove the child
  from its parent's `_children` when a child is deleted directly.

## Acceptance

Against `~/Documents/Cascade/my-artwork`, which is a real
23-node graph with two chains that want to be subnets:

1. Select the five `destroy-*` nodes, Cmd+G, save, reload. One subnet node,
   five children inside it, the same ports, and the connections into
   `marks-render` and out to `ink-composite` intact.
2. Same for the twelve `marker-*` nodes. Their chained `marks` connections
   survive, and the subnet exposes one input and one output.
3. Nest: put the destruction subnet inside another subnet, save, reload.
4. Delete a subnet containing children. Nothing is left orphaned in the file
   or in `_elements`.
5. Load any pre-existing `.cascade` file — `my-artwork`'
   `my-artwork.cascade` is the one to use — and confirm a byte-identical
   round trip through save.

A unit test on `Graph.toJSON()` / `Graph.fromJSON()` alone catches most of
this and does not need the editor.

---

# Part 2 — Shell execution

## Why

`/api/exec` runs Python and nothing else (`server/src/routes/exec.ts`:
`execFile(python, [scriptPath, ...args])`). A compiled node module runs in the
browser and cannot spawn anything itself, so **any** subprocess a project needs
has to be dressed up as a Python script.

`Cascade/my-artwork` carries the consequence. Everything in it
is TypeScript except a Python shim whose entire job is:

```python
subprocess.run([ARCHIVE_CLI_BIN, *args], capture_output=True, text=True)
```

That is a twenty-line file, a worker process, and a Python dependency, to run
one CLI. Any project wanting `ffmpeg`, `git`, `sips`, `exiftool`, `yt-dlp` or a
local model runner pays the same tax.

## The design

A `cascade/shell` runtime module, an `/api/shell` route behind it, and a
project-level allowlist that decides what may run.

### 2.1 Runtime — `server/src/runtime/shell.ts`

Sits beside `runtime/io.ts` and is injected the same way, by
`cascadeRuntimePlugin()` in `server/src/compile.ts`. Extend that plugin's
`onResolve` filter to `/^cascade\/(io|shell)$/` and map each to its file.

```ts
export interface RunResult { stdout: string; stderr: string; code: number; }
export interface RunOptions {
  /** Project-relative working directory. Defaults to the project root. */
  cwd?: string;
  /** Milliseconds. Defaults to the project's shell.timeout. */
  timeout?: number;
  stdin?: string;
  /** Extra environment on top of the server's. Values are strings only. */
  env?: Record<string, string>;
}

export async function run(command: string, args?: string[], options?: RunOptions): Promise<RunResult>;

/** Convenience for the common case: a CLI with a --json flag. Parses the last
 *  non-empty stdout line, which is the same contract runStage already relies
 *  on, and throws with stderr attached on a non-zero exit. */
export async function runJson<T = any>(command: string, args?: string[], options?: RunOptions): Promise<T>;
```

`args` is an **array and never a string**. No shell interpolation, no `sh -c`.
`execFile`, not `exec`. This is not only a quoting convenience — it removes
shell injection as a category, and every real use in the projects at hand is a
fixed binary with a list of arguments.

Usage, which is the whole point of the change:

```ts
import { runJson } from 'cascade/shell';
export const runsOn = 'server';

export async function execute(node: any) {
  const data = await runJson('archive-cli', ['captures', 'envelope', id, '--json']);
  node.out('envelope', 'param', { type: 'archive-cli.envelope' }).setValue(data.data);
}
```

### 2.2 Route — `server/src/routes/shell.ts`

`POST /api/shell`

```json
{ "command": "archive-cli", "args": ["moments", "list", "--json"],
  "cwd": "subdir", "timeout": 120000, "stdin": null, "env": {} }
```

Response mirrors `/api/exec`, so the two are legible side by side:

```json
{ "ok": true, "stdout": "…", "stderr": "…", "code": 0 }
```

On failure: HTTP 500 with `ok: false`, plus `error`, and `timedOut: true` when
the signal was `SIGTERM`. Both are already the shape `exec.ts` returns.

Rules:

- `command` is resolved **only** through the project's allowlist (2.3). Not on
  it → **403**, and the message must name the file and the exact line to add.
  A refusal that does not say how to fix it will be read as a bug.
- `cwd` goes through `resolveWithinRoot()` (`server/src/pathSafety.ts`).
  Default is the project root, as `/api/exec` already does.
- Timeout defaults to the project's `shell.timeout`, then to 120 s. Clamp to a
  hard ceiling — an unbounded subprocess from a browser page is the one failure
  here that needs no attacker.
- `maxBuffer` 64 MB, matching `exec.ts`.
- Environment: inherit the server's, then apply `env` from the config, then
  `env` from the request. Credentials stay where the tool keeps them; Cascade
  does not become a secret store.

### 2.3 The allowlist — `cascade.json` at the project root

```json
{
  "commands": {
    "archive-cli": "~/.local/bin/archive-cli",
    "ffmpeg": "ffmpeg"
  },
  "shell": { "timeout": 120000 }
}
```

A value is an absolute path, a `~`-relative path, a project-relative path, or a
bare name resolved on `PATH`. Resolve once at server start, warn about any
entry that does not resolve, and **do not** make an unresolvable entry fatal —
a project that names `ffmpeg` should still open on a machine without it.

Why an allowlist rather than free-form:

The server binds localhost, and any page in the browser can POST to it. Today
the blast radius of `/api/exec` is bounded by what it will run: a Python file
that already exists inside the project. Free-form shell would widen that to
anything on the machine, reachable from any tab. An allowlist keeps the
existing shape — *the project author declares what this project may run* — in a
file that sits beside the graph and shows up in a diff.

It also does real work beyond safety: a project states its dependencies, and
`cascade` can say *"this graph needs ffmpeg and you do not have it"* rather
than failing inside a node.

Load it in `ProjectRoot` (`server/src/project.ts`), which is where every other
project-scoped fact already lives. Missing file means no commands and is not an
error.

### 2.4 `runsOn` inference

`project.moduleRunsOn()` (`server/src/project.ts`) infers server-side from
`/\/api\/exec|runStage\s*\(/`. Add `cascade/shell` to that pattern, or a node
importing it will be classed as a browser node.

### 2.5 Expose it to the CLI too

`cascade run` uses the same project allowlist as the Studio server. Keep the
resolution logic shared by the route and CLI rather than embedding policy in
either transport.

## Explicitly out of scope

- **Streaming output.** A long `ffmpeg` will want progress on the websocket.
  Real, and a separate change — it needs a job id, a cancel, and a UI. The
  buffered form covers every current use.
- **A persistent worker for shell commands.** `/api/exec`'s worker exists to
  keep a torch model warm. A CLI has no warm state; per-call spawn is correct.
- **Retiring `/api/exec`.** `my-artwork` depends on it and on the
  Python worker's warm model. Leave both alone.

## Acceptance

1. A node importing `cascade/shell` compiles, is reported `runsOn: 'server'`,
   and runs an allowlisted command.
2. A command absent from `cascade.json` returns 403 with a message naming the
   file and the line to add.
3. `cwd` escaping the project root is refused by `resolveWithinRoot`.
4. A command that hangs is killed at the timeout and reports `timedOut: true`.
5. A non-zero exit surfaces stderr rather than an empty result.
6. `my-artwork` deletes `nodes/_shared/node_cli.py`,
   `nodes/_shared/worker.py` and `shared/bridge/stages.py`'s three CLI stages,
   replacing them with `runJson` calls, and behaves identically. Only the
   Real-ESRGAN stage stays on `/api/exec`, which is the correct division: a
   warm model process there, a one-shot command here.

That last one is the test that matters. It is the project the change exists
for, and it is sitting in `~/Documents/Cascade` ready to be converted.

---

# Part 3 — Project settings, and where configuration belongs

Added 2026-08-29, from Marcus: *"Perhaps we should allow the user to edit
meta-data in file > project settings? Project name: My Artwork. Also this
would be a good place to add a dictionary of config settings, e.g. API keys
that could be used by the project's nodes."*

Yes to the dialog. Two things need deciding first, because getting them wrong
is expensive later: **what a "project" is** versus what a graph is, and
**whether secrets go in it**. The second one is a no, and the reason is worth
reading before the dialog gets built.

## 3.1 The bug underneath the request

The browser tab now leads with the project name — `My Artwork - Cascade`
rather than `Cascade - my-artwork` (`App.svelte` `updateWindowTitle()`).
That change needed a fix first, and it is the kind of thing a settings dialog
would otherwise have quietly inherited:

`Graph.fromJSON()` read `metadata.name` **only from inside `if (json.project)`**
— the block that carries npm packages. A graph with no packages, which is most
of them, dropped its name on load and then wrote `'Cascade Graph'` back over it
on the next save. Every project's tab said the same thing because every
project's name had been erased. Fixed, with three tests in
`tests/serialization.test.ts`.

One of the same shape is still there and should go in this pass:
`toJSON()` writes `metadata.created: new Date().toISOString()` on **every**
save, so `created` is always the moment of the last save. Read it from the
existing file and only generate one when there is none.

## 3.2 Two kinds of configuration, and they are not the same file

There are now two candidates, and conflating them is the trap:

| | `.cascade` file, `metadata` | `cascade.json` at the project root |
|---|---|---|
| Describes | **this graph** | **this folder** |
| How many | one per graph, and a folder may hold several | exactly one |
| Travels | with the graph, wherever it is copied | with the repo |
| Holds | name, description, author, created | allowed commands, paths, defaults |

`ProjectRoot.listGraphFiles()` supports several graphs in one folder. So
*"Project name: My Artwork"* is ambiguous as stated: both names exist:

- **Graph name** → `metadata.name` in the `.cascade` file. `My Artwork`.
- **Project name** → `cascade.json`, covering every graph in the folder.

The title resolves graph name, then project name, then file name. A folder with
one graph — the common case — shows the same string either way, so the
distinction costs the user nothing and stops being wrong the moment a second
graph appears.

`cascade.json` is the same file Part 2 introduces for the shell allowlist.
Do not add a second one.

## 3.3 API keys: not here

**A key must never go in `cascade.json` or in a `.cascade` file.** Both are in
git — `my-artwork`, `my-artwork` and `shared-library` are all GitHub repos
pushed today — and a key committed once is a key that has to be rotated, not
deleted.

There is a second reason that is specific to Cascade and easier to miss. The
server serves project media to the page. A credential in the project tree risks
being exposed through a browser-facing surface and must remain outside it.

Credentials live in `~/.cascade/credentials.yaml`, outside every project and
never committed. Let the project **name** what it needs rather than hold it:

```json
{
  "name": "My Artwork",
  "commands": { "renderer": "/usr/local/bin/project-render" },
  "credentials": ["image-api"],
  "settings": { "workingWidth": 1400 }
}
```

`credentials` is a list of names, so Cascade can say *"this graph needs a
Magnific key and you have not set one"* before a node fails halfway through a
cook. The values stay in `~/.cascade/credentials.yaml`.

### How a node then uses one

Two tiers, and the split matters:

**Server-side nodes** (`runsOn: 'server'` — anything going through `/api/exec`
or `/api/shell`) get credentials injected into the subprocess environment by
the server, from the names the project declared. The key never enters the page.
This already covers most real cases: the CLI, the upscaler, anything with its
own auth.

**Browser nodes calling an HTTP API** must not be handed the raw key, because a
key in page memory is a key in the devtools console and in any bundle that gets
exported. Give them a proxy instead:

```ts
import { authorizedFetch } from 'cascade/net';
const res = await authorizedFetch('image-api', 'https://api.example.com/v1/render', {
  method: 'POST', body: JSON.stringify(payload),
});
```

The server attaches the credential's header and forwards. The page names the
credential; it never holds it. Which host each credential may be sent to is
part of the credential's own definition, so a name cannot be used to
exfiltrate a key to somewhere else.

That is more work than reading a key out of a config file, and it is the
difference between a tool that is safe to open someone else's graph in and one
that is not.

### What a settings dictionary *should* hold

Everything that is not a secret, and there is plenty of it: model names,
endpoints, default working resolution, output directory, units. Expose it
read-only to nodes:

```ts
import { config } from 'cascade/config';
const width = config.number('workingWidth', 1400);
```

Worth having on its own merits — `my-artwork` currently carries a default
working width as a parameter on one node, which is fine until two nodes need to
agree.

## 3.4 The dialog

**File → Project Settings…**, editing both files from one place, each field
labelled with which one it writes.

From the `.cascade` file: name, description, author. `created` shown read-only
once 3.1's second bug is fixed.

From `cascade.json`: project name, allowed commands, required credentials
(with a live "set" / "not set" against `~/.cascade/credentials.yaml`, never
showing a value), and the settings dictionary as editable key/value pairs.

Three rules:

- **Never render a credential's value**, not even masked. Show whether it is
  set and identify `~/.cascade/credentials.yaml` (or `CASCADE_CREDENTIALS`) as
  the external configuration location.
- **Editing graph metadata marks the graph dirty**; editing `cascade.json`
  writes immediately, because it is not part of the undo history and pretending
  otherwise will lose edits.
- **A missing `cascade.json` is normal.** Create it on first save from the
  dialog, never on open.

## Acceptance

1. A graph with `metadata.name` and no `project` block keeps its name through
   load, save, and reload. *(Done — `tests/serialization.test.ts`.)*
2. The tab reads `My Artwork - Cascade`, and `My Artwork * - Cascade` when
   dirty. *(Done.)*
3. `created` survives a save.
4. A folder with two `.cascade` files shows each graph's own name, and both
   report the same project name.
5. A credential is usable by a server-side node and by a browser node through
   the proxy, and appears nowhere in the page's memory, the built bundle, or
   any file in the project directory.
6. Opening a graph that declares a credential the user has not set says so up
   front rather than failing mid-cook.
