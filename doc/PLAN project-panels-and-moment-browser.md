# Plan: project-provided panels, and the moment browser

A handoff document. Two things: a new extension point in Cascade, and the first
thing built on it.

> Implementation note: architecture review replaced the module-global
> `unmount()` proposal with a disposer returned by each `mount()` call. Project
> value renderers use a separate `mount`/`update`/`dispose` lifecycle. Discovery
> checks exact `panels/<name>/index.ts` and `shared/panels/<name>/index.ts`
> entries, with the project-local entry taking precedence.

**Goal.** A project can ship its own dockable window. The first one is a moment
browser for the `archive-cli-*` projects — a grid of thumbnails you open from a
button on the `archive-item` node and click to choose a moment.

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

`ArchiveItem.svelte` and `ArchiveAnalysisMetadata.svelte` currently live
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

export function mount(element: HTMLElement, api: PanelApi): void | (() => void) { … }
```

compiled through exactly the same path as a node module. No Svelte compiler on
the server, no vendoring into Cascade, and the panel ships from `shared-project`
where it belongs.

### Server

Mirror the nodes routes — same shape, same plugin, same error handling:

- `GET /api/panels` → `{ panels: [{ name, title, icon }] }`, read from exact
  `panels/<name>/index.ts` and `shared/panels/<name>/index.ts` entries.
- `GET /api/panels/:name/compiled` → the compiled ESM.

`ProjectRoot` gains `listPanels()` and `panelMeta(name)`, alongside the existing
`listNodeModules()` / `moduleIcon()` / `moduleRunsOn()`, which parse the same way.

### Client

`registerLazyPanelComponent(type, loader, defaultTitle)` in
`src/editor/dockview/renderer.ts` already exists and is exactly the hook: the
loader fetches and imports the compiled module. Wrap each project panel in one
thin Svelte host component that owns a `<div>` and calls the module's `mount`,
then invokes its returned disposer — one host for all of them, written once.

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
  type: 'archive.item.id',
  label: 'Moment',
  action: 'panel:archive-items',
});
```

The node stays the source of truth, and `archive-item` gains one line.

---

## The moment browser itself

Lives in `shared-project/panels/archive-items/`.

A grid of tiles: thumbnail, date, title beneath. Newest first. Click selects and
closes — that is the whole interaction. Filters along the top for a date range
and source; sort by instant or capture count. The CLI already does all of that:
`archive-cli moments list [--limit] [--has] [--missing] [--since] [--until]
[--source] [--sort instant|captures] --json`.

`stage_moments_list` in `shared-project/bridge/stages.py` already calls it and
takes `limit`. It needs the other flags passed through — a small change.

### Thumbnails — solved upstream, 2026-08-29

**This section used to describe the hardest part of the panel. It no longer
applies.** The archive shipped preview serving in response to the feedback note,
and the design below is what to build against. The lazy-per-tile-download
approach previously planned here is obsolete — do not build it.

`moments list --json` now returns on every row:

```json
{
  "id": "…", "instant": "…", "title": null, "members": 1,
  "photoCount": 5, "videoCount": 0,
  "preview": {
    "captureId": "…", "assetId": "…",
    "pixelWidth": 4032, "pixelHeight": 3024,
    "widths": [320, 1280],
    "urls": { "320": "https://…?w=320&exp=…&sig=…", "1280": "…" },
    "expiresAt": "…",
    "kind": "photo"
  }
}
```

One call renders the whole grid. Verified here: **1.05–1.27 s for 300 moments**
over three runs, against roughly 2 s *per tile* before. The URLs are signed and need no
credentials — an unauthenticated `curl` returned a 320×240 JPEG, 19 KB, in
0.44 s — so they go straight into `<img src>` and the browser does parallelism,
caching, lazy loading and cancellation itself.

Three rules. Each one, got wrong, looks like flaky images rather than a mistake:

1. **Branch on `preview`, not on the counts.** `photoCount`/`videoCount` say the
   moment holds media; `preview` present says something can actually be drawn.
   Measured on this archive: 237 moments, 218 hold media, **217 are drawable**.
   The single gap is `a7825ffb-6518-44da-9915-81fa3bf012c4` — asset
   `a7825ffb/cee5055e`, whose original bytes are missing from storage rather
   than undecodable. A known hole, confirmed upstream, and no backfill closes
   it. Do not chase it as a picker bug.

   **A video-only moment is no longer part of that gap** (changed upstream
   2026-08-29). Every video now carries a poster frame at both rungs, so a
   video-led moment has a `preview` like any other. An earlier version of this
   plan told you to draw a placeholder for those — that is wrong, delete the
   thought.
2. **The URLs expire, `expiresAt` on the row (15 minutes).** Never cache them to
   disk or bake them into a saved artifact. On a `403 preview_link_expired`,
   refetch the *listing* — one call for the whole page, not one per tile. Treat
   `invalid_preview_signature` as a real bug, not as a refresh.
3. **Honour `preview.kind`** — `"photo"` or `"video"`. A poster is a still
   lifted out of a movie, not a picture someone framed, so mark it with a play
   glyph rather than presenting it as a photograph. The listing prefers a
   photograph and only falls back to a poster, so a moment holding both leads
   with the photograph. Rare in practice — 215 photo against 2 video on this
   archive — so build it correctly and do not spend much on it.
4. **Pick a width from `widths`**, currently `[320, 1280]`. Asking for a width
   that is not stored returns the nearest one, which will not be the size the
   layout expects.

**The bridge needs no change.** `stage_moments_list` returns the CLI rows
verbatim, so the new fields already arrive — verified end to end through
`/api/exec`, with `preview.urls` and `expiresAt` intact at the panel layer.

Previews are for *choosing*. The plot source stays the full-resolution
`captures download`, which is unchanged and still hash-verified.

---

## Order of work

1. **The extension point.** `/api/panels`, `listPanels()`, the per-instance `mount` disposer
   contract, the Svelte host, lazy registration, the `PanelApi`. Nothing
   archive-cli-specific — build it against a stub panel that renders "hello".
2. **The action parameter** and its button in the Inspector.
3. **The browser** — grid, filters, selection writes `moment_id`. Thumbnails
   come from the listing's `preview.urls`; see the section above for the three
   rules that make them reliable.
4. **Move the two archive-cli renderers out of Cascade** into the project. The
   same machinery now allows it, and it closes the seam rather than widening it.

Step 4 is the one to not skip. It is the difference between having added an
extension point and having added a second special case.

---

## Acceptance

- A project with no panels behaves exactly as now; `/api/panels` returns empty
  and nothing appears in the menu.
- A panel added to `shared-project/panels/` appears in the panel menu of both
  projects that symlink `shared`, with no change to Cascade.
- The moment browser opens from the node button, lists moments, and clicking one
  sets `moment_id` — after which undo works and the value survives a save.
- The grid renders from **one** listing call. A tile shows an image when the row
  has a `preview` and a video affordance when it has `videoCount` without one —
  never an empty tile because nobody asked.
- An expired signature refetches the listing once, not once per tile.
- `src/editor/components/registerRenderers.ts` no longer mentions `archive-cli`.

---

## Files this touches

| Where | What |
| --- | --- |
| `server/src/project.ts` | `listPanels()`, `panelMeta()` — mirror `listNodeModules()` / `moduleIcon()` |
| `server/src/routes/panels.ts` | new; mirror `routes/nodes.ts` |
| `server/src/index.ts` | mount the route |
| `server/src/compile.ts` | extract one shared browser-entry compiler; keep node and panel preflight separate |
| `src/editor/dockview/renderer.ts` | `registerLazyPanelComponent` already exists |
| `src/editor/dockview/dockview-store.svelte.ts` | `PANEL_TYPES` becomes dynamic |
| `src/editor/panels/ProjectPanelHost.svelte` | new; one host for every project panel |
| `src/editor/Inspector.svelte` | render an `action` parameter as a button |
| `src/types/node.types.ts` | `ParamOptions.action` — exists, give it meaning |
| `shared-project/panels/archive-items/` | new; the browser |
| `shared-project/bridge/stages.py` | pass the CLI's filter flags through `moments-list` |

## One caution

Cascade's working tree is worked on by more than one agent. Check `git status`
before starting and prefer small, frequent commits.
