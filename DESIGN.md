# Design

## Source of truth

- Status: Active
- Last refreshed: 2026-08-29
- Primary product surfaces: reusable graph runtime, optional Studio workbench, headless Node/browser hosts, Inspector, Viewer, node ports, project-defined workbenches
- Evidence reviewed: `VISION.md`, `ARCHITECTURE.md`, `spec/CASCADE_SUBNET_AND_SHELL_SPEC.md`, `src/types/coreTypes.ts`, `src/editor/Inspector.svelte`, `src/editor/Viewer.svelte`, `src/editor/components/PortEditor.svelte`, `src/editor/components/typeRenderers.ts`, and the approved plans under `.omx/plans/`

## Brand

- Personality: technical, direct, calm, precise, and built for expert creative work
- Trust signals: visible types, explicit execution locus, inspectable intermediate values, honest errors, stable filesystem paths
- Avoid: generic AI gradients, decorative card grids, excessive shadows, toy-like controls, hidden conversions, and visual noise that competes with outputs

## Product goals

- Goals: provide a stable reusable platform for generative design across interactive web work, high-resolution print, motion, video, sound, WebGL, Python, and external-service workflows; separate authored algorithms from platform and Studio concerns; make every graph stage inspectable; let projects reuse deterministic custom nodes without rebuilding file, version, preset, workspace, or execution infrastructure
- Non-goals: spreadsheet-scale data editing, full 3D DCC tooling, silent expensive conversions, bespoke conditionals for every node type, executing user modules to discover metadata, or requiring the Studio UI to run a graph
- Success signals: the same `.cascade` graph runs in Studio, a Node server, or a UI-free browser host; node contracts are statically inspectable and TypeScript-checkable; every `CORE_TYPES` member has a useful Inspector and Viewer state; connected/output values are clearly read-only; project renderers plug into the same contract; large values remain responsive

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
- The graph runtime is a product surface independent from Studio. Headless hosts consume it now; Studio's compatibility graph has one scheduler/controller boundary but still requires a deliberate built-in and structural-command migration before it consumes the neutral runtime directly.
- Node metadata is deterministic. A literal exported definition declares ports, properties, types, execution locus, and capabilities; `execute` performs computation only.
- Hosts provide explicit capabilities. File, Python, media, WebGL, and shell access are never ambient runtime assumptions. Provider-specific AI abstractions belong to projects or embedding hosts, not Cascade core.
- Neutral-runtime graph loads are atomic. Compatibility Studio collapse/extract are a known migration gap and must move behind transactional structural commands before that guarantee applies to every editor operation.
- Tradeoff: geometry editors favor transparent structured editing and previews over specialized CAD interactions in this pass.

## Architecture

- `@cascade/contracts` is the dependency-free source of truth for graph documents, core and namespaced types, deterministic node definitions, diagnostics, run results, capabilities, and schemas.
- `@cascade/runtime` is the deterministic environment-neutral graph loader, validator, scheduler, serializer, trigger engine, and hierarchy implementation. It depends only on contracts; dynamic compatibility remains in Studio/CLI during migration.
- The root `cascade` package is the sole published distribution and CLI owner. It exposes `cascade/contracts`, `cascade/contracts/schema`, `cascade/runtime`, `cascade/runtime/node`, `cascade/runtime/browser`, and the compatibility `cascade/shell` entry point.
- Node and browser hosts inject only the capabilities they support. Browser-only WebGL and server-only file, Python, and shell capabilities make portability constraints explicit before execution.
- The Studio owns canvas/view classes and a single `StudioGraphController`; its compatibility `Graph`/`Node` engine is still being reduced. Custom frontends and backend services use the neutral runtime directly and do not load editor code.
- **Web technology is the default renderer, and Python is the exception.** Canvas 2D, WebGL and WebGPU first; reach for a Python stage only for work that genuinely cannot be pushed to the browser — exotic ML libraries and the like. Marcus's ruling, 2026-09-07: *"Cascade should prefer web tech canvas/webgpu to keep things smooth and fast. only use Python for exotic ML libraries and similar things that can't be easily pushed to the browser."* The reason is interaction rather than taste: a Python stage costs a process spawn and a round trip per cook, which is invisible on one still frame and fatal to dragging a parameter or playing an animation. It also tends to be more faithful, not less — a gradient drawn with `createRadialGradient` is the same primitive the source artwork carries, where a per-pixel reimplementation is a guess about what that primitive means.
- Python interoperability remains a host capability for exotic libraries and compute stages. Exchange values cross explicit typed node boundaries rather than leaking Python process details into the neutral runtime.
- Internal packages remain two workspaces until independent versioning or external consumption justifies separate publication. More npm packages are not a goal by themselves.

## Graph and node conventions

- A custom node lives at `nodes/<Name>/index.ts`; its folder identity resolves to `project.<Name>`.
- The module exports a literal `definition` and a typed `execute`. Static inspection accepts JSON-like literals, arrays, parentheses, `as const`, and `satisfies`; identifiers, calls, spreads, computed properties, and other evaluation-dependent syntax are rejected.
- Deterministic modules have no module-level values or top-level effects, do not access ambient globals or browser storage, and do not import sibling node implementations. Data dependencies are graph wires; props configure the node; hosts inject declared capabilities. Static architecture diagnostics reject violations before execution.
- `definition.runsOn` is required (`portable`, `browser`, or `server`), and declared capabilities must be valid for that locus.
- Trigger events are explicit, queued FIFO, and fan out in authored connection order. Data dependencies cook before a gated trigger target. Trigger cycles are rejected.
- `.cascade` documents retain a flat authored element list. Optional `parent` identifiers describe nested subnets for nodes and annotations; child positions are relative to their parent network.
- Loading prepares and validates authored elements, hierarchy, executable nodes, ports, connections, pending connections, and topology before one assignment-only structural commit.
- Existing dynamic modules remain supported by the current Studio/CLI engine during migration. The headless runtime is deterministic-only, and malformed definitions never fall back to dynamic execution.

## Headless and deployment model

- `createRuntime()` is the common entry point for Studio, Node services, UI-free browser embeds, tests, and custom web frontends.
- Registration is sealed after the first graph load. A loaded graph supports inspect, input/property/preset mutation, trigger, run, cancel, subscription, output retrieval, and disposal without editor dependencies.
- One run is active per graph; there is no hidden run queue. API misuse rejects, while graph execution resolves to an explicit success/failure/cancelled result.
- A graph may run wholly in a backend, wholly in a compatible browser, or across an explicitly designed bridge. The runtime never silently moves a stage between hosts.
- File loading/saving, format versioning, presets, project paths, and workspace conveniences belong to stable platform services around the neutral runtime, not to individual generative algorithms.

## Security boundaries

- User node modules are trusted project code, not a sandbox. Deterministic definitions and architecture checks prevent common hidden-state designs and improve inspection, tooling, and portability; hard isolation would additionally require a separate realm or worker per node instance.
- Shell is a server-only capability backed by one project-scoped service. Projects invoke configured aliases as a fixed executable plus argument array with `shell: false`; arbitrary executables, interpolation, unsafe working directories, dangerous request-time environment overrides, and unbounded output are rejected. The subprocess inherits the server environment before project and allowlisted request overrides are applied.
- Browser shell transport is loopback-only, uses exact Host and Origin checks plus a process-lifetime random capability token, has route-local request limits, and never logs tokens, paths, arguments, environment, stdin, stdout, or stderr.
- Timeout, cancellation, and output limits terminate the full process tree and wait for closure before reporting completion.

## Agent workflow contract

- Repository guidance must let a code agent find the project manifest, graph documents, nodes, assets, presets, runtime host, and verification commands without reverse-engineering Studio internals.
- Project creation and node creation use canonical templates and CLI checks. A good agent workflow is: inspect contracts, author a literal definition, implement typed computation, run static definition extraction and TypeScript checks, then run the graph headlessly before opening Studio.
- Public contracts and examples favor small composable modules, direct imports, explicit capabilities, and deletion of redundant wrappers. Agent guidance must name deprecated compatibility paths and their migration target.

## Visual language

- Color: the workbench resolves through one set of semantic tokens in `src/editor/theme.css`, which carries a dark and a light value for each name; the theme setting follows the system unless the artist picks one. Family colors from `TYPE_COLORS` are unchanged, and color still communicates type family, not decoration
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
