# MCP server

`cascade mcp [project-directory]` serves the CLI as MCP tools over stdio, so an agent calls `set` instead of shelling out and parsing text. The tools are the CLI's commands under the same names, and every result is the same `--json` envelope (`{ ok, data, warnings }`, or `{ ok: false, error, warnings }` with `isError` set). Graph paths are relative to the project directory and may not leave it.

## Set it up in Claude Code

From the project directory:

```sh
claude mcp add cascade -- npx --no-install cascade mcp .
```

Or in the project's `.mcp.json`, so every session in the project has it:

```json
{
  "mcpServers": {
    "cascade": { "command": "npx", "args": ["--no-install", "cascade", "mcp", "."] }
  }
}
```

With a global install (`npm i -g @field/cascade`), use `"command": "cascade", "args": ["mcp", "."]`. The tools then appear as `mcp__cascade__set`, `mcp__cascade__render` and so on.

## Tools

| Tool | CLI equivalent |
| --- | --- |
| `graph_list`, `graph_read`, `graph_create` | `cascade graph list \| read \| create` |
| `node_add`, `node_remove` | `cascade node add \| rm` |
| `connect`, `disconnect` | `cascade connect \| disconnect` |
| `set` | `cascade set` (value, `expression`, `keys`, `removeKeys`, `interpolation`, `unset`) |
| `subnet_create`, `subnet_move`, `subnet_dissolve` | `cascade subnet create \| move \| dissolve` |
| `edit` | `cascade edit` (a batch of operations, all or nothing) |
| `check`, `inspect` | `cascade check \| inspect` |
| `cook` | `cascade run <graph> [--node <id>]` |
| `render` | `cascade run <graph> --frames … [--fps] [--out] [--node]… [--scene]` |
| `export` | `cascade export <graph> --plan \| --out <dir>` |
| `lock`, `replay`, `locks` | `cascade lock <graph> <node> --name`, `cascade replay <id> [--live]`, `cascade locks` |
| `ladder`, `pick` | `cascade ladder <graph> <node> --name --vary node.prop=a,b,c \| --seeds a,b,c` (`vary` is `{ "node.prop": [a, b, c] }`), `cascade pick <ladder> <n>` |

The editing tools take `dryRun`. Reads and edits run inside the server through the same functions the CLI commands call. Cooking, rendering, checking, exporting and the lock tools run `cascade <command> --json` as one child process each, so a long render leaves nothing behind in the server and returns exactly what the CLI would print. Calls run one at a time, so two edits to one file never interleave.

Each tool is an `mcp` entry on its command's row in `src/cli/verbs.ts`, with its description and input schema, so a tool cannot name a command this build does not have (`tests/cli-verbs.test.ts` checks every tool against the table and this page).

## A session

```text
graph_read   { "graph": "index.cascade" }
node_add     { "graph": "index.cascade", "type": "Transform", "set": { "rotate": 0.4 } }
connect      { "graph": "index.cascade", "from": "motif.output_0", "to": "transform.geometry" }
set          { "graph": "index.cascade", "target": "render.opacity", "keys": [{ "frame": 1, "value": 0.25 }, { "frame": 48, "value": 1 }] }
render       { "graph": "index.cascade", "frames": "1-48", "out": "renders/check" }
```

See `doc/CLI_REFERENCE.md` for what each operation guarantees about diffs, placement and subnet boundaries.

## Another project, per call

Every tool takes an optional `project`: the project directory for that call, absolute or relative to the directory the server was started in. Without it nothing changes. With it, the call's paths (`graph`, `out`, `scene`, `directory`) resolve against that project and may not leave it, and `cook`, `render`, `check` and the others run their CLI child there. So one server started in `commons` can edit and render a sketch next to it:

```text
graph_read { "project": "/Users/me/Documents/Cascade/cloud-volumes", "graph": "index.cascade" }
cook       { "project": "../cloud-volumes", "graph": "index.cascade", "out": "renders/check" }
```

A `project` that is not a directory is refused.
