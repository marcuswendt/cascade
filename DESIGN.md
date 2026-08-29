# Design

## Source of truth

- Status: Active
- Last refreshed: 2026-08-29
- Primary product surfaces: infinite graph canvas, Inspector, Viewer, node ports, project-defined workbenches
- Evidence reviewed: `VISION.md`, `ARCHITECTURE.md`, `src/types/coreTypes.ts`, `src/editor/Inspector.svelte`, `src/editor/Viewer.svelte`, `src/editor/components/PortEditor.svelte`, `src/editor/components/typeRenderers.ts`, Dockview theme styles

## Brand

- Personality: technical, direct, calm, precise, and built for expert creative work
- Trust signals: visible types, explicit execution locus, inspectable intermediate values, honest errors, stable filesystem paths
- Avoid: generic AI gradients, decorative card grids, excessive shadows, toy-like controls, hidden conversions, and visual noise that competes with outputs

## Product goals

- Goals: make every graph value understandable and, when meaningful, editable; keep browser/Python/WebGL values visually coherent; let project namespaces extend presentation without changing core UI
- Non-goals: spreadsheet-scale data editing, full 3D DCC tooling, silent expensive conversions, or bespoke conditionals for every node type
- Success signals: every `CORE_TYPES` member has a useful Inspector and Viewer state; connected/output values are clearly read-only; project renderers plug into the same contract; large values remain responsive

## Personas and jobs

- Primary personas: creative coders, technical artists, generative-design engineers
- User jobs: tune node inputs, understand intermediate outputs, compare execution contexts, detect malformed values, and move fluidly between Python and browser-backed stages
- Key contexts of use: dense desktop workbenches, long pipelines, large images/geometry, mixed CPU/GPU/server execution

## Information architecture

- Primary navigation: canvas selection determines Inspector and Viewer context
- Core screens: Graph, Inspector, Viewer, Logs/diagnostics
- Content hierarchy: value preview first, type and shape metadata second, expandable raw structure last

## Design principles

- One type, one presentation contract: the same type vocabulary drives ports, Inspector, and Viewer.
- Progressive disclosure: compact summaries in dense panels; richer previews and metadata in Viewer; raw JSON only on demand.
- Edit only what can be authored honestly: inputs may edit portable values; connected inputs and outputs are read-only; live GPU textures are inspected, not fabricated through form fields.
- Expensive context changes stay explicit: texture readback, server materialization, and file writes are actions or nodes, never invisible UI coercions.
- Project types extend by registration, not central switch statements.
- Tradeoff: geometry editors favor transparent structured editing and previews over specialized CAD interactions in this pass.

## Visual language

- Color: retain the dark neutral workbench and family colors from `TYPE_COLORS`; color communicates type family, not decoration
- Typography: system UI font for labels; compact monospace for values, paths, dimensions, and diagnostics
- Spacing/layout rhythm: dense 4/6/8px rhythm; metadata rows remain scannable without nested card chrome
- Shape/radius/elevation: 3–4px radii; borders establish hierarchy; shadows reserved for floating dialogs/menus
- Motion: immediate updates; brief status transitions only; no decorative motion
- Imagery/iconography: previews use the actual value; icons clarify actions or execution locus only

## Components

- Existing components to reuse: `PortEditor`, `JsonTree`, `ColorPicker`, Viewer image zoom/pan behavior, type renderer registry
- New/changed components: shared `TypeValue` presentation shell, structured JSON editor, image/texture inspector, geometry summary/preview, asset inspector, Viewer output list
- Variants and states: `compact`, `inspect`, `view`; editable/read-only; empty/loading/error/stale; connected source; truncated/expanded
- Token/component ownership: `coreTypes.ts` owns semantic type metadata; the presentation registry owns components; Inspector/Viewer only choose context and mode

### Core type presentation contract

| Family | Inspector/editor | Viewer |
| --- | --- | --- |
| `float`, `int`, `bool`, `string` | native compact controls | large readable value with type metadata |
| vectors and matrices | labeled numeric fields; integer rounding; identity action for matrices | formatted tuple/grid with dimensions |
| `color` | swatch plus RGBA fields | swatch, numeric values, colour-space note |
| `image` | path and descriptor metadata; thumbnail; portable fields editable only when unconnected | zoomable media preview plus size/channels/depth/space/path |
| `texture` | read-only live GPU metadata and unavailable/stale state | GPU preview when a canvas/source is exposed, otherwise dimensions/format/session metadata |
| `points`, `lines`, `polyline`, `rects` | count/bounds summary plus validated structured editor for unconnected inputs | lightweight SVG/Canvas2D preview, count, dimensionality, bounds, expandable structure |
| `mesh` | vertex/triangle/normal/UV summary plus validated structured editor | lightweight projected preview when feasible, statistics, expandable structure |
| `asset` | validated project-relative path/descriptor editor | media/file metadata and preview when renderable |
| `array`, `object`, `any` | validated structured editor with tree preview | searchable/expandable tree and concise shape summary |
| namespaced project types | registered renderer when available; safe generic structured fallback | same registry with richer `view` mode and generic fallback |

## Accessibility

- Target standard: WCAG 2.2 AA for interactive controls and text contrast
- Keyboard/focus behavior: all fields, expanders, reset/copy/open actions, and output selection are keyboard reachable with visible focus
- Contrast/readability: type color is never the only carrier of meaning; every value includes a textual type label
- Screen-reader semantics: groups use labels/headings; summaries announce type, shape, editability, and error state
- Reduced motion and sensory considerations: respect reduced motion; avoid pulsing status effects

## Responsive behavior

- Supported breakpoints/devices: desktop-first; Inspector remains usable from 240px width; Viewer adapts to Dockview panel size
- Layout adaptations: vector/matrix fields wrap or scroll; Viewer metadata collapses beneath previews; structured trees virtualize or truncate large collections
- Touch/hover differences: no essential information exists only in hover tooltips

## Interaction states

- Loading: preserve previous value when possible and show bounded loading status
- Empty: type-aware “No value” state, not a blank panel
- Error: inline typed diagnostic with preserved last-known-good preview where applicable
- Success: edits commit on change/blur and trigger the existing node update/cook path
- Disabled: connected inputs and all outputs explain why they are read-only
- Offline/slow network: retain cached preview and show stale/disconnected metadata for file-backed values

## Content voice

- Tone: concise, factual, technically precise
- Terminology: use the canonical type names and “browser”, “GPU”, and “Python/server” execution contexts consistently
- Microcopy rules: state the condition and recovery; avoid anthropomorphic or generic “something went wrong” text

## Implementation constraints

- Framework/styling system: Svelte 5, component-local CSS, existing Dockview workbench
- Design-token constraints: reuse `TYPE_COLORS` and current neutral palette; do not add a second design-token layer in this pass
- Performance constraints: never dump unbounded JSON into the DOM; image previews use `/api/media`; geometry previews sample large collections; texture UI avoids GPU readback unless explicitly requested
- Compatibility constraints: normalize legacy `number`, `boolean`, and `curves`; preserve namespaced project renderers and old image paths via `coerceImageRef`
- Test/screenshot expectations: unit-test type formatting/normalization and renderer resolution; component-test editing/read-only/error states; production build and Svelte check remain green

## Open questions

- [ ] Whether mesh Viewer should gain an interactive WebGL orbit view after the lightweight projected preview proves useful / product / medium impact
- [ ] Whether project packages can eventually ship Svelte renderers directly rather than app-side registration / architecture / high impact
- [ ] Whether large structured values need virtualization beyond bounded initial expansion / performance / medium impact
