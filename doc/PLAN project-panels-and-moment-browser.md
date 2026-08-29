# Plan: project-provided panels, and the moment browser

A handoff document. Two things: a new extension point in Cascade, and the first
thing built on it.

**Goal.** A project can ship its own dockable window. The first one is a moment
browser for the `observatory-*` projects — a grid of thumbnails you open from a
button on the `observatory-moment` node and click to choose a moment.

Build the extension point first. The browser is the proof it works, not the
point of it.

---

## Why this needs a new extension point

Cascade has three places a project's behaviour can live, and a project owns
exactly one of them:

| | Owned by | Shipped how |
| --- | --- | --- |
| Node modules | the project | `nodes/<name>/index.ts`, compiled server-side by esbuild |
| Type renderers | **Cascade** | `src/editor/components/registerRenderers.ts` |
| Panels | **Cascade** | `src/editor/panels/*.svelte` |

`ObservatoryMoment.svelte` and `CloudAnalystMetadata.svelte` currently live
inside Cascade because there was no other way to ship them. That was called out
as a seam when they were added; a moment browser makes it untenable. Cascade
should not know what a moment is.

## The way through, which needs no new machinery

Cascade already compiles a project's TypeScript into the browser: esbuild, via
`server/src/compile.ts` (`compileProjectModule`), served from
`server/src/routes/nodes.ts` at `GET /api/nodes/:moduleName/compiled`.

**A panel does not need Svelte.** It needs a DOM element and something to draw
into it. So a project panel is a plain TypeScript module:

```ts
export const title = 'Moments';
export const icon = 'Aperture';

export function mount(element: HTMLElement, api: PanelApi): void { … }
export function unmount(): void { … }
```

compiled through exactly the same path as a node module. No Svelte compiler on
the server, no vendoring into Cascade, and the panel ships from `cloud-shared`
where it belongs.

### Server

Mirror the nodes routes — same shape, same plugin, same error handling:

- `GET /api/panels` → `{ panels: [{ name, title, icon }] }`, read from
  `panels/<name>/index.ts` at the project root (and through the `shared`
  symlink, which `ProjectRoot.resolve` already permits because it resolves
  lexically).
- `GET /api/panels/:name/compiled` → the compiled ESM.

`ProjectRoot` gains `listPanels()` and `panelMeta(name)`, alongside the existing
`listNodeModules()` / `moduleIcon()` / `moduleRunsOn()`, which parse the same way.

### Client

`registerLazyPanelComponent(type, loader, defaultTitle)` in
`src/editor/dockview/renderer.ts` already exists and is exactly the hook: the
loader fetches and imports the compiled module. Wrap each project panel in one
thin Svelte host component that owns a `<div>` and calls the module's
`mount`/`unmount` — one host for all of them, written once.

Add the discovered panels to `PANEL_TYPES` in
`src/editor/dockview/dockview-store.svelte.ts` so they appear in the panel menu
and dock, tab and float like Graph or Viewer. **Dockable only — Marcus's call,
no modal mode.**

### The API handed to a panel

Keep it small. Every addition is something a project can come to depend on.

```ts
interface PanelApi {
  runStage(stage: string, args: object): Promise<any>;   // exists: /api/exec
  mediaUrl(path: string, opts?): string;                 // exists
  getParam(nodeId: string, name: string): any;
  setParam(nodeId: string, name: string, value: any): void;
  selectedNodeId(): string | null;
  close(): void;
}
```

`setParam` must go through the same path the Inspector uses, so history and save
work without the panel knowing they exist.

---

## Opening it from a node

`ParamOptions` in `src/types/node.types.ts` already has an `action?: string`
field, added and never used. Give it meaning: a parameter declaring an action
renders as a **button** in the Inspector rather than a field, and the action
names the panel to open.

```ts
node.param('moment_id', '', {
  type: 'observatory.moment.id',
  label: 'Moment',
  action: 'panel:observatory-moments',
});
```

The node stays the source of truth, and `observatory-moment` gains one line.

---

## The moment browser itself

Lives in `cloud-shared/panels/observatory-moments/`.

A grid of tiles: thumbnail, date, title beneath. Newest first. Click selects and
closes — that is the whole interaction. Filters along the top for a date range
and source; sort by instant or capture count. The CLI already does all of that:
`observatory moments list [--limit] [--has] [--missing] [--since] [--until]
[--source] [--sort instant|captures] --json`.

`stage_moments_list` in `cloud-shared/bridge/stages.py` already calls it and
takes `limit`. It needs the other flags passed through — a small change.

### The hard part: thumbnails

`moments list --json` returns `id`, `instant`, `title`, `members`. **No image.**
Getting a thumbnail means downloading that moment's photos. 74 moments was
679 MB. The existing web picker shows grey "no photo" tiles for exactly this
reason.

Three approaches. Do the first two; the third is not ours to build.

1. **Ask for less.** `moments list --has photo` filters at source, so the grid
   never contains a moment that cannot show one. One flag, and it removes most
   of the empty tiles.
2. **Fetch lazily, on scroll.** An `IntersectionObserver` per tile: download a
   moment's photo only when the tile is about to be visible, at thumbnail size,
   and never for a moment scrolled past. Opening the browser then costs one
   screen of images rather than the archive. Keep an in-flight cap (4–6) so a
   fast scroll does not open fifty connections.
3. **A thumbnail endpoint** — one small image per moment without the full asset.
   The real fix, and an Observatory API question rather than a Cascade one.
   Worth raising separately; the first two make the panel good without it.

Downloads land in `cloud-shared/cache/observatory-downloads/`, shared between
projects, so a moment you browsed to is already local when you select it and the
first cook is instant.

---

## Order of work

1. **The extension point.** `/api/panels`, `listPanels()`, the `mount`/`unmount`
   contract, the Svelte host, lazy registration, the `PanelApi`. Nothing
   observatory-specific — build it against a stub panel that renders "hello".
2. **The action parameter** and its button in the Inspector.
3. **The browser** in `cloud-shared/panels/observatory-moments/` — grid,
   filters, lazy thumbnails, selection writes `moment_id`.
4. **Move the two observatory renderers out of Cascade** into the project. The
   same machinery now allows it, and it closes the seam rather than widening it.

Step 4 is the one to not skip. It is the difference between having added an
extension point and having added a second special case.

---

## Acceptance

- A project with no panels behaves exactly as now; `/api/panels` returns empty
  and nothing appears in the menu.
- A panel added to `cloud-shared/panels/` appears in the panel menu of both
  projects that symlink `shared`, with no change to Cascade.
- The moment browser opens from the node button, lists moments, and clicking one
  sets `moment_id` — after which undo works and the value survives a save.
- Opening the browser downloads only the visible tiles. Measure it: opening on a
  74-moment archive should fetch on the order of one screen, not 679 MB.
- `src/editor/components/registerRenderers.ts` no longer mentions `observatory`.

---

## Files this touches

| Where | What |
| --- | --- |
| `server/src/project.ts` | `listPanels()`, `panelMeta()` — mirror `listNodeModules()` / `moduleIcon()` |
| `server/src/routes/panels.ts` | new; mirror `routes/nodes.ts` |
| `server/src/index.ts` | mount the route |
| `server/src/compile.ts` | reuse as-is; the `cascade/io` plugin applies unchanged |
| `src/editor/dockview/renderer.ts` | `registerLazyPanelComponent` already exists |
| `src/editor/dockview/dockview-store.svelte.ts` | `PANEL_TYPES` becomes dynamic |
| `src/editor/panels/ProjectPanelHost.svelte` | new; one host for every project panel |
| `src/editor/Inspector.svelte` | render an `action` parameter as a button |
| `src/types/node.types.ts` | `ParamOptions.action` — exists, give it meaning |
| `cloud-shared/panels/observatory-moments/` | new; the browser |
| `cloud-shared/bridge/stages.py` | pass the CLI's filter flags through `moments-list` |

## One caution

Cascade's working tree is worked on by more than one agent. Check `git status`
before starting and prefer small, frequent commits.
