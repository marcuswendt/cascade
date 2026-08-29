# Authoring Cascade projects

Cascade projects are filesystem-native. The graph, custom nodes, assets, presets, and host policy live together in an ordinary repository, while Cascade supplies the stable runtime and optional Studio workspace.

## Create and open a project

```bash
cascade new my-artwork
cd ~/Documents/Cascade/my-artwork
cascade ./
```

For a workstation reached by name over a trusted VPN or LAN, bind deliberately
and allow the exact hostname used by the browser:

```bash
cascade ./ --host KURO --port 3030
```

Open `http://KURO:3030`. Loopback remains the default. Cascade trusts the
specific non-loopback bind hostname; `--trusted-host` is only needed when the
browser uses a different hostname. Wildcard remote binds are rejected.

`index.cascade` is the default graph name. A project may contain several `.cascade` files; pass one explicitly when there is no unambiguous default:

```bash
cascade print.cascade
```

The portable project shape is:

```text
my-artwork/
├── cascade.json
├── index.cascade
├── nodes/
├── panels/              # optional Studio-only extensions
├── assets/
├── package.json
└── tsconfig.json
```

Keep generated output in a project-specific directory such as `renders/`. Keep reusable algorithms in `nodes/` or a normal TypeScript package rather than in Studio components.

## Add a project panel

A project can provide an optional dockable Studio panel without adding UI code to Cascade. Create `panels/asset-browser/index.ts`:

```ts
import type { ProjectPanelApi } from 'cascade/studio/panel';

export const title = 'Assets';
export const icon = 'Images';

export function mount(element: HTMLElement, api: ProjectPanelApi) {
  const button = document.createElement('button');
  button.textContent = 'Use selected asset';
  button.onclick = () => {
    if (api.sourceNodeId) api.setParam(api.sourceNodeId, 'asset_id', 'asset-42');
    api.close();
  };
  element.append(button);
  return () => button.remove();
}
```

Panels are trusted browser code. Cascade discovers literal `title`, `icon`, and optional `rendererTypes` exports without executing the module, then compiles it only when Studio needs it. `mount` may be async and returns an instance disposer; `api.signal` aborts when its dock closes. Panels can call project stages, build media URLs, read/write node parameters, inspect selection, or close themselves.

Reusable panels may live under `shared/panels/`. `shared/` may be a directory or
a project-owned symlink to a sibling library; Cascade confines panel discovery
and compilation to that link's canonical target. A project-local panel with the
same name still wins.

The same module can provide project-owned value renderers without teaching Cascade about project data types:

```ts
export const rendererTypes = ['my-project.asset'];

export const renderers = {
  'my-project.asset': {
    mount(element, props) {
      const draw = ({ value }) => { element.textContent = String(value ?? ''); };
      draw(props);
      return { update: draw, dispose: () => element.replaceChildren() };
    }
  }
};
```

Each renderer instance owns its cleanup. An optional `update` method receives later values without remounting.

To open a panel from the Inspector, declare an action parameter:

```ts
node.param('asset_id', '', {
  label: 'Choose asset',
  action: 'panel:asset-browser',
});
```

The initiating node ID is captured as `api.sourceNodeId`; `setParam` uses the same history/dirty/cook path as the Inspector, so undo and save continue to work. Panels and project value renderers are Studio-only and are never imported during `cascade run` or by `cascade/runtime`.

## Project settings and credentials

`cascade.json` describes the whole folder, so every `.cascade` graph in the repository sees the same non-secret settings:

```json
{
  "name": "My Artwork",
  "credentials": ["image-api"],
  "settings": { "workingWidth": 1400, "outputUnits": "mm" }
}
```

Read settings without giving nodes write access:

```ts
import { config } from 'cascade/config';
const width = config.number('workingWidth', 1400);
```

Credential values never belong in the project. Cascade reads them from `~/.cascade/credentials.yaml` (or `CASCADE_CREDENTIALS`) and reports only whether each declared name is set. Server stages receive declared values through environment variables. A browser node uses the authorized proxy:

```ts
import { authorizedFetch } from 'cascade/net';
const response = await authorizedFetch('image-api', 'https://api.example.com/v1/render', {
  method: 'POST', body: JSON.stringify(payload)
});
```

Browser proxy credentials must declare the exact allowed hosts and header metadata alongside the secret:

```yaml
image-api:
  api_key: "..."
  env: IMAGE_API_KEY
  hosts: [api.example.com]
  header: Authorization
  scheme: Bearer
```

The proxy accepts HTTPS only, refuses undeclared hosts, strips caller-supplied authorization headers, and never returns the credential value to the page. Studio defers its initial cook when a required credential is missing and links to File → Project Settings.

## Add a custom node

Create `nodes/Multiply/index.ts`. The directory name defines the module ID `project.Multiply`.

```ts
import type { NodeDefinition, NodeExecutionContext } from 'cascade/contracts';

export const definition = {
  apiVersion: 1,
  label: 'Multiply',
  description: 'Scales a numeric value.',
  runsOn: 'portable',
  inputs: {
    value: { kind: 'data', type: 'float', default: 0 },
    factor: { kind: 'data', type: 'float', default: 2 }
  },
  outputs: {
    result: { kind: 'data', type: 'float' }
  }
} as const satisfies NodeDefinition;

export function execute(context: NodeExecutionContext<typeof definition>) {
  context.outputs.result.set(context.inputs.value * context.inputs.factor);
}
```

The definition is the complete static interface. Cascade and code agents can inspect it without importing the module, build the node UI, validate graph connections, and type-check `execute`. Do not create ports, props, or types inside `execute`.

Choose the narrowest execution locus:

- `portable` — deterministic TypeScript with host-neutral capabilities; usable in Node and browsers.
- `browser` — browser-only values or WebGL.
- `server` — filesystem, Python, shell, or other server-only work.

Capabilities are explicit:

```ts
export const definition = {
  apiVersion: 1,
  runsOn: 'server',
  capabilities: ['python'],
  inputs: { prompt: { kind: 'data', type: 'string', default: '' } },
  outputs: { result: { kind: 'data', type: 'object' } }
} as const satisfies NodeDefinition;
```

The runtime refuses unsupported host/capability combinations before executing the graph.

## Work with `.cascade` files

A graph document stores authored elements separately from runtime state. Nodes and annotations remain flat even inside subnets:

```json
{
  "nodes": [
    { "id": "process", "module": "cascade.core.Subnet", "position": [400, 200] },
    { "id": "multiply", "module": "project.Multiply", "parent": "process", "position": [80, 60] }
  ],
  "annotations": [],
  "connections": []
}
```

`parent` is omitted at the root. Child positions are relative to their parent. IDs are globally unique, and connections refer to element/port identities. When changing structure, load and validate the whole candidate before replacing the live graph.

## Run without Studio

Use the CLI for automation and CI:

```bash
cascade validate index.cascade
cascade check index.cascade
cascade inspect index.cascade
cascade run index.cascade
```

Applications can use `createRuntime()` from `cascade/runtime` directly. Register node modules and host capabilities, load the graph, mutate inputs or presets, run or trigger it, read outputs, then dispose it. This path loads no Svelte or Studio code and works in a backend service or a custom browser application.

Server and browser hosts are deliberately explicit. A graph that uses Python or shell stages belongs on the server or behind an application-defined bridge; the runtime does not silently move computation between environments.

## Verify a project

Before committing a custom node or graph:

1. Type-check the project with its normal TypeScript command.
2. Run `cascade validate <graph>` and `cascade check <graph>` to check the document plus static definitions, types, hierarchy, and connections without rendering.
3. Run the graph headlessly when its capabilities are available.
4. Open Studio only for visual inspection or authoring that benefits from the graph UI.

Treat warnings about legacy dynamic nodes as migration work. New nodes should always use deterministic definitions.
