# Cascade CLI Specification

> **Status**: Draft  
> **Author**: Marcus Wendt <marcus@field.io>  
> **Last Updated**: December 2025

## Overview

The `cascade` CLI is a Node.js/TypeScript command-line utility for working with Cascade projects outside of the visual editor. It provides project scaffolding, headless graph execution, validation, and development utilities.

### Product Family

| Product | Description |
|---------|-------------|
| **Cascade Studio** | Browser editor served by the project-scoped Cascade host |
| **cascade** | CLI for Studio, project management, validation, and headless execution |
| **cascade/runtime** | Neutral graph runtime used by custom frontends and services |

## Installation

```bash
# Global installation (recommended)
npm install -g @anthropic/cascade-cli

# Or via npx
npx @anthropic/cascade-cli init my-project

# After installation, available as:
cascade <command> [options]
```

## Commands

### `cascade init`

Create a new Cascade project with standard structure.

```bash
cascade init <project-name> [options]

Options:
  --template <type>     Project template (default: "blank")
                        Options: blank, dashboard, generative, api
  --with-apis <list>    Comma-separated API integrations to scaffold
                        Examples: strava, whoop, openai, replicate
  --dir <path>          Target directory (default: ./<project-name>)
  --no-git              Skip git initialization
  --author <name>       Author name for package.json and config

Examples:
  cascade init my-project
  cascade init training-app --template dashboard --with-apis strava,whoop
  cascade init art-project --template generative
  cascade init my-tool --with-apis openai,replicate
```

**Generated Structure:**

```
<project-name>/
├── <project-name>.cascade     # Main graph file
├── cascade.config.yaml        # Project configuration
├── package.json               # Node.js package manifest
├── tsconfig.json              # TypeScript configuration
├── .gitignore
├── README.md
├── assets/
│   ├── images/
│   ├── videos/
│   └── documents/
├── data/                      # API cache directory (gitignored)
└── src/
    ├── nodes/                 # Custom node definitions
    └── lib/                   # Shared utilities
```

### `cascade run`

Execute a graph file headlessly (no UI).

```bash
cascade run <graph-file> [options]

Options:
  --output, -o <path>   Output directory for results (default: ./output)
  --format <type>       Output format: json, csv, image, raw (default: json)
  --watch, -w           Watch for file changes and re-execute
  --verbose, -v         Verbose logging
  --dry-run             Validate and show execution plan without running
  --env <file>          Load environment variables from file
  --timeout <ms>        Execution timeout in milliseconds (default: 300000)
  --node <id>           Execute specific node only (and its dependencies)

Examples:
  cascade run my-project.cascade
  cascade run graphs/batch-process.cascade --output ./results
  cascade run render.cascade --node final_output --format image
  cascade run pipeline.cascade --watch --verbose
```

**Exit Codes:**
- `0` - Success
- `1` - Graph execution error
- `2` - File not found
- `3` - Validation error
- `4` - Timeout

### `cascade validate`

Validate a graph file without executing.

```bash
cascade validate <graph-file> [options]

Options:
  --strict              Enable strict validation (check for warnings)
  --json                Output results as JSON
  --fix                 Attempt to auto-fix issues (updates file)

Examples:
  cascade validate my-project.cascade
  cascade validate *.cascade --strict
```

**Validation Checks:**
- JSON syntax validity
- Schema compliance (version, required fields)
- Node type existence
- Connection validity (ports exist, types compatible)
- Circular dependency detection
- Missing asset references
- Deprecated node types (with --strict)

### `cascade export`

Export a graph to standalone formats.

```bash
cascade export <graph-file> [options]

Options:
  --format <type>       Export format: html, zip, json (default: html)
  --output, -o <path>   Output file path
  --embed-assets        Embed all assets inline (default: true for html)
  --minify              Minify output (html/json)

Examples:
  cascade export my-project.cascade --format html -o dist/index.html
  cascade export my-project.cascade --format zip -o release.zip
```

### `cascade serve`

Start a local development server for a project.

```bash
cascade serve [project-dir] [options]

Options:
  --port, -p <number>   Port number (default: 5173)
  --host <address>      Host address (default: localhost)
  --open                Open browser automatically
  --no-watch            Disable file watching

Examples:
  cascade serve
  cascade serve ./my-project --port 3000 --open
```

### `cascade add`

Add components to an existing project.

```bash
cascade add <type> <name> [options]

Types:
  node                  Add a custom node
  api                   Add an API integration
  template              Add from a template

Options:
  --category <cat>      Node category (for node type)
  --extends <base>      Base class to extend (Node, LensNode, etc.)

Examples:
  cascade add node MyFilter --extends LensNode --category "Filters"
  cascade add api spotify
  cascade add template image-pipeline
```

### `cascade list`

List available resources.

```bash
cascade list <type>

Types:
  nodes                 List all available node types
  templates             List project templates
  apis                  List API integration scaffolds

Examples:
  cascade list nodes
  cascade list templates
```

### `cascade upgrade`

Upgrade project to latest Cascade version.

```bash
cascade upgrade [project-dir] [options]

Options:
  --check               Check for upgrades without applying
  --backup              Create backup before upgrading (default: true)

Examples:
  cascade upgrade
  cascade upgrade ./old-project --check
```

### Credentials

Credential values are intentionally managed outside the project and outside
the current CLI surface. Add them to `~/.cascade/credentials.yaml`, or point
`CASCADE_CREDENTIALS` at another file. Cascade reports presence only and never
renders stored values.

## Configuration

### `cascade.config.yaml`

Project-level configuration file.

```yaml
# Cascade Project Configuration
name: my-project
version: 0.1.0
author: Name <email@example.com>
description: Project description

# Cascade version constraint
cascade: ">=0.3.0"

# Project paths
paths:
  assets: ./assets
  data: ./data
  nodes: ./src/nodes
  lib: ./src/lib
  output: ./output

# External node packages
external_nodes:
  - ./src/nodes/custom
  - ./src/nodes/filters

# API integrations
integrations:
  strava:
    cache_dir: ./data/strava
    cache_ttl: 3600
  anthropic:
    model: claude-sonnet-4-20250514

# Graph settings
graph:
  entry: ./my-project.cascade
  auto_save: true
  auto_save_interval: 60

# CLI defaults
cli:
  run:
    timeout: 300000
    verbose: false
  export:
    format: html
    embed_assets: true

# Development server
serve:
  port: 5173
  open: false
```

### `~/.cascade/config.yaml`

Global user configuration.

```yaml
# Global Cascade Configuration

# Default author for new projects
author: Marcus Wendt <marcus@field.io>

# Default template
default_template: blank

# Telemetry (anonymous usage stats)
telemetry: false

# Auto-update check
check_updates: true

# Editor preferences (used by Cascade.app)
editor:
  theme: dark
  font_size: 13
```

### `~/.cascade/credentials.yaml`

API credentials storage (never committed to git).

```yaml
# API Credentials
# This file should never be committed to version control

strava:
  client_id: "..."
  client_secret: "..."
  refresh_token: "..."

whoop:
  access_token: "..."

anthropic:
  api_key: "sk-ant-..."

openai:
  api_key: "sk-..."
```

## Architecture

### Package Structure

```
packages/
├── @cascade/cli/              # CLI package
│   ├── src/
│   │   ├── index.ts           # Entry point
│   │   ├── commands/          # Command implementations
│   │   │   ├── init.ts
│   │   │   ├── run.ts
│   │   │   ├── validate.ts
│   │   │   ├── export.ts
│   │   │   ├── serve.ts
│   │   │   ├── add.ts
│   │   │   └── credentials.ts
│   │   ├── templates/         # Project templates
│   │   │   ├── blank/
│   │   │   ├── dashboard/
│   │   │   ├── generative/
│   │   │   └── api/
│   │   ├── scaffolds/         # API integration scaffolds
│   │   │   ├── strava/
│   │   │   ├── whoop/
│   │   │   ├── openai/
│   │   │   └── replicate/
│   │   └── utils/
│   │       ├── config.ts
│   │       ├── credentials.ts
│   │       └── logger.ts
│   ├── package.json
│   └── tsconfig.json
│
├── @cascade/contracts/        # Deterministic graph and node contracts
└── @cascade/runtime/          # Headless graph execution
```

### Dependency Graph

```
┌─────────────────┐     ┌─────────────────┐
│ Cascade Studio  │     │   cascade CLI   │
│   (Browser)     │     │   (Node.js)     │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     │
              ┌──────▼──────┐
              │ contracts + │
              │   runtime   │
              └─────────────┘
```

### Headless Execution

The CLI uses `@cascade/core` directly without any UI dependencies:

```typescript
// packages/@cascade/cli/src/commands/run.ts
import { Graph, GraphRunner } from '@cascade/core';
import { loadProject } from '../utils/project';

export async function run(graphPath: string, options: RunOptions) {
  // Load and parse graph
  const project = await loadProject(graphPath);
  const graph = Graph.fromJSON(project.graph);
  
  // Create headless runner
  const runner = new GraphRunner({
    headless: true,
    timeout: options.timeout,
    outputDir: options.output
  });
  
  // Execute
  const results = await runner.execute(graph, {
    node: options.node,
    verbose: options.verbose
  });
  
  // Output results
  await writeResults(results, options);
}
```

## Templates

### `blank`

Minimal project with empty graph.

### `dashboard`

Data dashboard template with:
- API data fetching nodes
- Data transformation nodes
- Visualization output

### `generative`

Generative art template with:
- Lens image processing nodes
- Animation/time nodes
- Export configurations

### `api`

API integration template with:
- Credentials loading
- Caching utilities
- Rate limiting
- Error handling

## API Integration Scaffolds

Each API scaffold includes:
- Node definition(s)
- TypeScript interfaces for API responses
- Caching configuration
- README with setup instructions
- Credentials template entries

### Available Scaffolds

| API | Nodes | Description |
|-----|-------|-------------|
| `strava` | Activities, Athlete, Segments | Fitness tracking |
| `whoop` | Recovery, Sleep, Strain, Workouts | Recovery metrics |
| `openai` | Chat, Completion, Embedding, Image | OpenAI API |
| `anthropic` | Message, Completion | Claude API |
| `replicate` | Run, Prediction | ML model hosting |
| `fal` | Run, Queue | Fast ML inference |
| `spotify` | Tracks, Playlists, Audio | Music data |
| `notion` | Database, Page, Block | Workspace API |
| `airtable` | Records, Table | Database API |
| `github` | Repos, Issues, PRs | GitHub API |

## Output Formats

### `cascade run` Output

**JSON (default):**
```json
{
  "success": true,
  "duration_ms": 1234,
  "outputs": {
    "node_id": {
      "port_name": <value>
    }
  },
  "errors": [],
  "warnings": []
}
```

**CSV:**
For tabular data outputs, generates CSV files per output node.

**Image:**
For Lens/image outputs, saves PNG/JPEG files.

**Raw:**
Outputs raw values to stdout (useful for piping).

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CASCADE_CONFIG` | Path to global config file |
| `CASCADE_CREDENTIALS` | Path to credentials file |
| `CASCADE_LOG_LEVEL` | Logging level (debug, info, warn, error) |
| `CASCADE_NO_COLOR` | Disable colored output |
| `CASCADE_TELEMETRY` | Enable/disable telemetry |

## Error Handling

### User-Friendly Errors

```
$ cascade run missing-file.cascade

  Error: File not found
  
  Could not find graph file: missing-file.cascade
  
  Did you mean one of these?
    • my-project.cascade
    • test.cascade
  
  Run 'cascade run --help' for usage information.
```

### Verbose Mode

```
$ cascade run my-project.cascade --verbose

  ┌─ Cascade Run ─────────────────────────────────────┐
  │ Graph: my-project.cascade                         │
  │ Nodes: 12                                         │
  │ Connections: 15                                   │
  └───────────────────────────────────────────────────┘

  [00:00.000] Loading graph...
  [00:00.012] Validating connections...
  [00:00.015] Building execution order...
  [00:00.016] Execution order: node1 → node2 → node3 → ...
  [00:00.018] Executing node1 (strava/Activities)...
  [00:00.234] ✓ node1 completed (216ms)
  [00:00.235] Executing node2 (whoop/Recovery)...
  ...
  
  ┌─ Results ─────────────────────────────────────────┐
  │ Status: Success                                   │
  │ Duration: 1.234s                                  │
  │ Outputs written to: ./output/                     │
  └───────────────────────────────────────────────────┘
```

## Implementation Phases

### Phase 1: Core CLI (Week 1-2)
- [ ] Package setup and build configuration
- [ ] `cascade init` with blank template
- [ ] `cascade validate`
- [ ] `cascade run` (basic execution)
- [ ] Global and project configuration loading

### Phase 2: Templates & Scaffolds (Week 3-4)
- [ ] Additional project templates
- [ ] API integration scaffolds (strava, whoop, openai)
- [ ] `cascade add` command
- [ ] `cascade list` command

### Phase 3: Advanced Features (Week 5-6)
- [ ] `cascade serve` development server
- [ ] `cascade export` to HTML/ZIP
- [ ] Watch mode for `cascade run`
- [ ] `cascade upgrade` for migrations

### Phase 4: Polish (Week 7-8)
- [ ] `cascade credentials` management
- [ ] Comprehensive error messages
- [ ] Documentation and examples
- [ ] npm package publishing

## Success Criteria

- [ ] `cascade init` creates valid, runnable projects
- [ ] `cascade run` executes graphs identically to Cascade.app
- [ ] All commands have `--help` documentation
- [ ] Exit codes are consistent and documented
- [ ] Works on macOS, Linux, and Windows
- [ ] CI/CD integration examples provided

## Future Considerations

### Plugin System
Allow third-party node packages to be installed via CLI:
```bash
cascade install @cascade/lens-advanced
cascade install @community/audio-nodes
```

### Remote Execution
Execute graphs on remote Cascade servers:
```bash
cascade run my-graph.cascade --remote https://cascade.example.com
```

### Graph Diffing
Compare two graph versions:
```bash
cascade diff v1.cascade v2.cascade
```

### REPL Mode
Interactive graph exploration:
```bash
cascade repl my-project.cascade
> node("strava").props.days = 60
> run("strava")
> inspect("strava.stats")
{ totalRides: 45, totalDistance: 1200, ... }
```

---

*This specification defines the Cascade CLI. Implementation should follow the phased approach, prioritizing core functionality before advanced features.*
