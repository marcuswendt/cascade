# The sketch kit: `@field/cascade-kit`

The helpers that sketch projects kept rebuilding, as one package a project
imports like any other dependency. It lives in this repository at
`packages/kit` and is not part of Cascade: the core never imports it, the
published `@field/cascade` does not ship it, and nothing in it needs a network
or an account.

Something earns a place here after about three real sketches have written it
themselves. Each module started as the copies found in `~/Documents/Cascade/`
on 2026-11-06, and its tests pin it to the exact bits of those copies, so a
sketch that swaps its copy for the kit renders the same bytes.

## Install it in a project

```bash
npm run build:kit                       # in the cascade checkout: writes packages/kit/dist
cd ~/Documents/Cascade/my-sketch
npm install --save-dev ../../Dev/cascade/packages/kit   # "@field/cascade-kit": "file:../../Dev/cascade/packages/kit"
```

`dist/` is not committed, so a fresh checkout of Cascade needs
`npm run build:kit` (or the full `npm run build`) before a project can load the
kit. A `file:` dependency is a link, so a rebuilt kit reaches every project at
once. The core is the opposite: pin a published `@field/cascade` exactly (see
"Pin the core" in [PROJECT_AUTHORING.md](PROJECT_AUTHORING.md)).

Import from the module you need:

```ts
import { oklchToSrgb8 } from '@field/cascade-kit/colour';
import { Rng, hashParts } from '@field/cascade-kit/random';
```

Every module except `video` and `nodes` runs on all hosts: `cascade run`,
Studio and the browser player. `video` and `nodes` use Node's `child_process`
and `fs`; import them only from `runsOn: 'server'` nodes and scripts. The root
entry `@field/cascade-kit` re-exports the all-host modules only.

## Modules

| Import | What it is | Rebuilt in (2026-11-06) |
|---|---|---|
| `colour` | sRGB transfer, OKLab, OKLCH, gamut mapping (`clip`, `bisect`, `shrink`), `gamutCmax`, hex, CSS, WCAG contrast | 12 copies: strata ribbon, commons plotter-kit, cairn-swatch, rides-atlas, race-story-frame, tmr-2026-preview, cloud-wall, cloud-volumes |
| `palette` | seeded k-means in OKLab, `paletteFromPixels(rgba, k)` | the Python k-means in cloud-volumes moods, field-rocks, pebble-set |
| `random` | `Rng` (sfc32 with numpy-like helpers), `mulberry32`, `rngFromString`, `fnv1a`, `sha1Hex`, `hashParts` (Python's `int(sha1("a|b")[:12], 16)`) | strata `num.ts`, cairn-swatch, cloud-shared, cloud-type, rides-atlas |
| `noise` | the GLSL hashes, `valueNoise1/2`, `fbm2`, `seededNoise2`, `smoothstep` | commons plotter-kit, field-logo |
| `paper` | `paperPixels` and `paperSheet`: mottle, tooth and vignette on any RGBA buffer or 2D context | commons plotter, pen-live, ripple-plot |
| `pen` | `plotSvg` (mm, numbered Inkscape layers, `%` guide layers, 0.1 mm pen), `dot`, `hatch`, `orderPaths`, `inkShade` (raster pen preview) | commons plotter-kit, cloud-plots `plotdoc` (Python) |
| `video` | `framesToMp4` (H.264 yuv420p, faststart), `videoFrame`, `runFfmpeg` (PATH, then Homebrew) | commons frames-to-video and plotter-source, cloud-wall, cloud-plots, cloud-volumes, cloud-palette |
| `cairn` | `readCairnSnapshot`, `painter`, `spaceEvents` (deduped across spaces), `eventsByDay`, `addDays` over the `data/spaces.json` + `data/events.json` snapshot | cairn-strata-hd, cairn-flow, cairn-stretch, cairn-swatch |
| `observatory` | moment records (`readMomentRecord`), photo moments (`selectMomentImage`, `bestFrame`), `parseLocalTime` | cloud-volumes, cloud-shared, cloud-wall |
| `cache` | `createCache`: a disk cache keyed on stage, inputs and the code's import closure, one log line per call | cairn-strata-hd river cache, after cloud-plots' stale-key lesson |
| `nodes` | `cascade-kit nodes`: stubs for another project's nodes (below) | cloud-shared's symlink and hand-copied stubs |

File access is always injected (`read` functions, a `root`), so the same code
runs under `cascade/io` in a node, in a dev script and in tests.

Using it today: cairn-strata-hd (colour, random, cache, cairn), commons
(colour, noise, paper, pen, video through `lib/plotter-kit.ts`) and
cloud-volumes (observatory, colour). Their old copies are in each project's
`_archive/`.

## The disk cache

```ts
import { loadBytes } from 'cascade/io';
import { createCache } from '@field/cascade-kit/cache';

// In a node bundled into <project>/.cascade-cache/nodes/, ../../ is the project root.
const cache = createCache({
  root: new URL('../../', import.meta.url),
  dir: 'river', name: 'river cache', offEnv: 'RIVER_CACHE',
  read: (path) => loadBytes(path, { raw: true }),
});

const { value, info } = await cache.cached('meander', space, { props, events: hash },
  ['nodes/river-meander/index.ts'], () => simulate(...));
```

The key covers the stage name, the inputs, every project file reachable by
relative imports from the listed entries, and the kit version. A hit is never
silent: each call prints `[river cache] meander FIELD: hit (disk) key …` to
stderr, which `cascade run --json` reports under `warnings`. Without Node's fs
(the browser player) it keeps a memory cache only. Keep cache use behind a
labelled prop or an off switch, and key it on everything wired in (see the
cache rule in `AGENTS.md`).

## Use another project's nodes

Cascade finds a project's nodes by listing `nodes/<name>/index.ts` and reads
each definition from that file's own syntax tree. It never runs a module and
never follows a re-export, so a borrowed node still needs a file in the
borrowing project that spells its definition out. `cloud-shared` did this
with a `shared/` symlink and stubs copied by hand into each consumer, plus a
script to catch them drifting. Instead:

1. Make the providing project a normal dependency, not a symlink:

   ```bash
   npm install --save-dev ../cloud-shared   # "cloud-shared": "file:../cloud-shared"
   ```

2. Generate the stubs (all of the provider's nodes, or name some):

   ```bash
   npx cascade-kit nodes cloud-shared observatory-moment image-crop
   ```

   Each `nodes/<name>/index.ts` gets the provider's `export const definition`
   statement copied verbatim, a type import, and
   `export { execute } from '../../node_modules/cloud-shared/nodes/<name>/index';`.
   The relative path is deliberate: `cascade run` leaves bare package imports
   external and Node cannot load the provider's TypeScript, while a relative
   path is bundled like the project's own code.

3. Check for drift in the project's `npm test` or `check` script:

   ```bash
   npx cascade-kit nodes cloud-shared --check
   ```

   It exits 1 and names each stub that no longer matches its provider. Rerun
   without `--check` to update them. A local node of the same name that the
   tool did not write is never overwritten.

Only definition-v1 nodes can be borrowed: the definition has to be a literal.
The provider's own imports (`cascade/io`, `cascade/stage`, its `lib/`) resolve
as they would in the provider. Assets and Python stages the borrowed node
needs are still the provider's to document; the stub only carries the node.

## Changing the kit

Run `npm run test:kit` from the repository root. A change to an expression in
`colour`, `random`, `noise`, `paper` or `pen` moves every consumer's pixels: the
tests compare against the consumer copies on purpose, so update a reference
only together with the sketches that depend on it. Bump `version` in
`packages/kit/package.json` and `src/version.ts` together when behaviour
changes; the version is part of every cache key.
