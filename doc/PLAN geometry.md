# Plan: a geometry library, and the four-level model that makes one worth having

Written 2026-09-04, from Marcus by voice: *"A basic geometry library as we have in Houdini. Point, line, polygon, polyline, meshes, potentially even surfaces. Some core data types, so we can implement nodes like add point, scatter, and other operations which produce new geometry like a rectangle, circle. All these basic tools which are super universal and basically needed in Houdini. Something that feels very familiar for Houdini users and gives Cascade a strong geometry foundation. My interest at the moment is simple 2D vector graphics, so I think that's a little bit more interesting."*

So the target is 2D vector graphics, and 3D is a door to leave open rather than a deliverable.

The finding that shapes the whole plan: **Cascade already has five geometry types, no node has ever produced or consumed one of them, and the three places that read them each expect a different shape.** This is not a library to be written next to an existing one. It is a set of type names with nothing behind them, being interpreted differently by every reader, and the first decision is whether to fill them in or replace them.

The three projects that use those types in earnest, `cloud-plots`, `cloud-posters` and `cascade-logo` in `~/Documents/Cascade`, answer that decision before it is argued. One of them abandoned all five core types for a single namespaced geometry type of its own. The other hand-rolls per-primitive attributes, a grouping node, and a fallback rule for style, and carries two live bugs which are both an operation dropping an attribute it had never heard of. Their evidence has its own section, and it changed two decisions in this plan rather than decorating them.

## The principle this is an instance of

Marcus, the same day, on why Houdini composes: *"It's these unified types — geometry, shaders, composition — that make Houdini so composable. A small number of powerful, reusable types understood by many nodes."*

That is the governing rule, and it is worth stating plainly because it inverts the usual instinct. **The value of a type is the number of nodes that understand it.** A type understood by one node is a parameter with extra steps; a type understood by forty is what makes a graph feel like a medium rather than a wiring diagram.

Two consequences that should outlive this plan:

**Adding a type should be rare and expensive; adding an attribute should be free.** Every new type multiplies the connection surface and divides the node set, which is why Houdini has a handful and not a hundred. A geometry table with arbitrary attributes absorbs almost every extension that would otherwise arrive as a new type — colour, weight, radius, tag, layer, pen number, whatever the next project needs — and absorbs it without a single node changing.

**Cascade's current type list is the failure this principle predicts.** It is long and thin: forty-odd core types, and the only per-element user data anywhere in the geometry set is `Rect.tag?: string` and `Polyline.weight?: number`. One reserved slot per type, non-extensible, and five geometry types that no node understands at all. The rest of this plan is one domain being fixed; the same reading applies later to raster composition and to material or shader description, and each will be tempting to solve with three new types instead of one good one.

## Where this is going, and what that constrains today

Marcus, the same evening: *"In the future I want to extend this with volumes, 3D geometry, cameras, lights, scenes, to be able to describe a 3D scene with transforms — very much aligned with Houdini's OBJ and SOP geo volume models and contexts."*

That is not a wish list to defer; it settles four things that are being decided this week, and it is cheaper to honour them now than to discover them.

**+Y up stops being a preference and becomes structural.** An OBJ-style scene of cameras and lights wants a right-handed Y-up world, which is what was already chosen, so the flip stays where it is: at the raster and SVG boundary, and nowhere else.

**`P` as a declared 2-or-3 component attribute is the mechanism, not a compromise.** A 3D `SOP` context is the same attribute table with `P.size: 3`, so the geometry type does not fork. The reason the size is declared per attribute rather than fixed is exactly this.

**Volumes are a primitive kind, not a new type.** Houdini keeps a volume as a primitive inside the same geometry, alongside polygons, which is the strongest possible argument for the one-type decision — and it means the `kinds` vocabulary must be open-ended from the start rather than a closed pair of `poly` and `bezier`. A volume primitive references its voxel data the way a geometry-file reference already works; `observatory-weather-volume` in `~/Documents/Dev` is the real workload when that arrives, and it should be read before the design is written.

**Scenes are the third namespace, and it now has its case.** The line drawn under question 2 said a third reserved namespace should have to argue for itself. This is the argument: cameras, lights and object transforms are not geometry and do not belong in `cascade.geo.*`. Houdini's own split is the model — OBJ nodes are a hierarchy of transforms, cameras and lights, and SOP nodes are the geometry inside an object. So a later `cascade.obj.*` carries a scene or object type holding a transform and a hierarchy, and a geometry becomes something an object *contains* rather than something a scene *is*.

The one thing to avoid in the meantime is putting a transform hierarchy into the geometry type because 3D has not arrived yet. A detail-level transform on a geometry is a tempting shortcut and it is the wrong place: it would make every geometry carry a scene concept, and then the scene type would have to negotiate with it.

## What Cascade actually has

`packages/contracts/src/values.ts` declares `points`, `lines`, `polyline`, `mesh` and `rects` in `CORE_TYPES`, with an interface for each:

```ts
export type Point = readonly [number, number] | readonly [number, number, number];
export interface PointSet { readonly points: readonly Point[] }
export type LineSegment = readonly [Point, Point];
export interface LineSegments { readonly segments: readonly LineSegment[] }
export interface Polyline { readonly points: readonly Point[]; readonly closed?: boolean; readonly weight?: number }
export interface Mesh { readonly positions: readonly number[]; readonly indices: readonly number[]; readonly normals?: readonly number[]; readonly uvs?: readonly number[] }
export interface Rect { readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly tag?: string }
export interface Rects { readonly rects: readonly Rect[] }
```

Those five interfaces are referenced by exactly one thing in the repository: the `ValueForType` conditional in the same file. Nothing imports `PointSet`, `LineSegments`, `Rects` or the contracts `Polyline`. Grep for producers and there are none: every node in `packages/runtime/src/builtins/core` is structural or scalar (`Switch`, `Merge`, `Select`, `Null`, `Random`, `Remap`, `Subnet`, `Input`, `Output`), and the whole Studio compatibility set under `src/nodes` is ten routing nodes, eleven image nodes in `lens`, and one prompt node in `quill`. Not one of them declares a geometry-typed port.

The types are therefore untested by use, and it shows.

**The shapes disagree, three ways.** Three files read geometry values and no two of them agree with the contract or with each other.

For `lines`, the contract says `{ segments: [[Point, Point], ...] }`. `src/editor/components/typePresentation.ts` reads `data.lines`. `src/utils/geometryRaster.ts` reads a flat `[x1, y1, x2, y2]` per entry, with a comment explaining why: *"A stipple render emits each mark as a flat `[x1, y1, x2, y2]` rather than a pair of pairs, which is why counting them as chains reported zero."* Nothing anywhere looks for `.segments`. The contract's shape for `lines` has never been read by any code.

For `points`, the contract says `{ points: Point[] }`. `typePresentation` accepts a bare array or `.points`. `geometryRaster` accepts a bare array, or `.point`, or `.position`, or a **string** ending in `.npy` which it fetches over `/api/media` and decodes, which is a fourth shape and not an object at all.

For `polyline`, the contract type is a **single chain**. Both Studio consumers treat the value as an *array* of chains, and `geometryRaster`'s summary counts `chains` and `vertices`. So the declared type cannot describe what the type is actually used for, and there is no name for a bundle of chains, which is the single most important value in 2D vector work.

For `rects`, the contract is `{ rects: Rect[] }` with `x`/`y`/`width`/`height` objects. `geometryRaster` only handles `[x, y, w, h]` arrays or `.rect`, so a contract-shaped `rects` value renders as nothing.

`mesh` is not in `geometryRaster`'s `GeometryKind` union, nor in `Viewer.svelte`'s `GEOMETRY_KINDS`, so it has no preview path at all. Its `positions` are xyz triples with a hardcoded stride of 3 in `typePresentation`, so a 2D mesh is not expressible.

**There are two type vocabularies, and they have drifted.** `packages/contracts/src/values.ts` and `src/types/coreTypes.ts` both export `CORE_TYPES` with the same 25 members, and then diverge. The Studio copy has the doc comments, `GEOMETRY_TYPES`, `TYPE_COLORS`, `IMPLICIT_CONVERSIONS`, `canConnect`, and a `normalizeType` that folds `number` to `float`, `boolean` to `bool`, and `curves` to `polyline`. The contracts copy has none of that; `packages/runtime/src/runtime.ts` carries its own private `IMPLICIT_TYPES` and `canConnect` at line 1672, duplicating the Studio table. It also has its own mutable `Polyline` and `Mesh` interfaces at `coreTypes.ts:220`, near-identical to the contracts ones but with mutable fields and `number[][]` instead of `readonly Point[]`.

The practical consequence: **the `curves` alias exists only in Studio.** A `.cascade` document with a `curves` port connects in Studio and fails to connect in the neutral runtime, because `runtime.ts` compares raw strings and has never heard of `curves`.

**Nothing validates a geometry value.** `packages/contracts/src/validate.ts` has `defaultMatches`, which handles the four scalars and a length table for vectors, matrices and colour, and then returns `length === undefined || ...`. Every geometry type falls into that `undefined` branch, so **any JSON value at all passes as a valid `points` default.** There is no schema, no runtime shape check, and no diagnostic.

**Two facts about the runtime that decide the storage format.** Both are in `packages/runtime/src/runtime.ts` and neither is documented.

`cloneValue` (line 1587) is the deep clone behind `snapshot`. At line 1601 it reads the prototype, and if the value is not an array and its prototype is neither `Object.prototype` nor `null`, **it returns the value by reference, uncloned and unfrozen.** So a `Float32Array` already passes through the runtime untouched, while a nested array of `[x, y]` pairs is cloned element by element. The immutability guarantee that `ARCHITECTURE.md` and `DESIGN.md` both state ("inspection and output values are immutable snapshots") does not hold for typed arrays, and no test or comment says so.

Second, at line 799 every cooked output is emitted as `node:output` with `value: snapshot(value)`, computed eagerly as an argument regardless of whether anything is subscribed. So with plain nested arrays, a 7,000-point set costs 7,000 array allocations per output per cook, for an event that may have no listener. With typed arrays it costs nothing.

Taken together: **the storage format that is cheapest to pass through Cascade today is the one built on typed arrays**, and it is cheap by accident rather than by design. The plan makes it deliberate.

**Smaller things found on the way**, worth fixing whether or not the rest of this is agreed:

`Point` is `[number, number] | [number, number, number]` per point, so one point set can legally mix 2D and 3D points and nothing checks.

`Rect.tag?: string` and `Polyline.weight?: number` are the only per-element user data anywhere in the type set. One string on rectangles, one number on chains, no way to add a third. That is an attribute system with one slot per type, and it is the clearest evidence that the four-level model below is the thing actually being asked for.

`ControlFor<T>` in `packages/contracts/src/definition.ts` falls through to `"select"` for anything it does not name, so a geometry-typed prop is typed as a dropdown with an options list.

`schema.ts` matches a namespaced type against `^[a-z][a-z0-9-]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$` while `values.ts` types it as `` `${string}.${string}` ``. The type admits names the schema rejects.

`cascade.core.Merge` collects its variadic inputs into an `array`, not into a merged value. A geometry merge is a different node and cannot reuse it.

## What the reference workloads actually carry

Three projects in `~/Documents/Cascade` use these types in earnest: `cloud-plots` (twenty dynamic nodes, a Python bridge, a plotter and print output), `cloud-posters`, and `cascade-logo`. They are the only evidence that exists about what the format has to survive, and they change two of the decisions below.

**The scale, measured rather than guessed.** From `cloud-plots/.cascade-cache`, one real cook:

| Stage | Payload |
| --- | --- |
| `stipple-points` | 7,000 points, `float64`, shape `(7000, 2)`, 112 KB as `.npy` |
| `stipple-render` | 32,600 dash marks as flat `[x0, y0, x1, y1]`, 2.6 MB of JSON |
| `hatch-curves` | 6,228 chains, 130,112 vertices, 5.2 MB of JSON |
| `layer-group` | the same geometry again, grouped, 5.8 MB of JSON |
| `mark-color-assign` | 4 rectangles |
| a signal field, for contrast | 341 MB, `float32`, and already out of band as `.npy` |

So a cook moves roughly 170,000 vertices across 39,000 primitives, and it moves them as five to six megabytes of JSON decoded into nested two-element arrays. `hatch-curves` alone becomes 130,112 array objects, and then `snapshot` deep-clones every one of them on each `node:output` emit. As a single `Float64Array` that is one allocation of 2 MB which `cloneValue` passes through by reference. The typed-array decision was argued from the runtime's clone path; this is the number it saves.

The other half of the answer: geometry here is tens of thousands of elements, not millions. Fields are the big data and they already live out of band. Nothing in this workload needs a format tuned for a million points, and a format that is awkward at 170,000 is disqualified.

**`P` is two components, and the third slot is already taken.** The stipple `.npy` is shape `(7000, 2)`. In `cloud-plots`, `stipple-render` emits dots as `(cx, cy, r)`, where the third component is a **radius**. In `cascade-logo`, `dot-scatter` emits dots as `(x, y)`. Same declared type, `points`, three different element widths across two projects, and one project already using the third slot to mean something that is not z.

That kills the fixed `size: 3` position proposed below, and it is corrected there. It also means the fold from a legacy `points` value cannot be automatic: a three-component entry means `(x, y, radius)` in one project and would mean `(x, y, z)` under a 3D reading, and no code can tell which. The migration has to be told.

**`rects` in practice is not the contract's `rects`.** Every producer and consumer in `cloud-plots` uses:

```python
{"rect": [x, y, w, h], "tag": "FORM_04", "color": "#3a7f5c", "opacity": 0.62}
```

with `color` and `opacity` optional. The contract's `{x, y, width, height, tag}` appears nowhere. `tag` values are `FORM_04`, `LOBE_11`, `FORM_18`, which repeat across a set, so the string-table storage in `StringAttribute` below is the right shape rather than a guess.

**And this is per-primitive attributes, hand-rolled, with a fallback rule already invented.** `svgio.py` reads `color = r.get("color", mark_color)` and `opacity = float(r.get("opacity", 1.0))`, falling back to the render node's own `mark_color` prop when the attribute is absent. Its comment says so explicitly: *"rects can now carry their own `color` ... falls back to the single global `mark_color` when absent."* That is exactly Houdini's convention, that a node reads the attribute if it is there and its parameter if it is not, arrived at independently. It answers the open question about where stroke style lives, and that question is struck below.

**Two live bugs in that project, both the same bug.** Neither is a geometry-library bug; both are what happens without one.

`svgio.scale_primitives` rebuilds each rect as `{"rect": ..., "tag": ..., **({"color": ...} if "color" in r else {})}`. It carries `color` and **drops `opacity`**, so retargeting a render to a physical mm-at-dpi size silently loses every value that `random_opacity` mode assigned.

`node_cli.stage_mark_color_assign` opens with `rects = [{"rect": tuple(r["rect"]), "tag": r["tag"]} for r in a["rects"]]`, which **discards any `color` or `opacity` already on the input**. Chaining two of these nodes throws away the first one's work.

Both are the failure a generic attribute table prevents by construction: an operation that has never heard of an attribute copies it rather than dropping it, because it copies the whole attribute set. Every hand-rolled attribute has to be remembered by name in every operation that touches the geometry, and eventually one is not. This is the strongest argument in this plan and it comes from working code rather than from Houdini.

**`cascade-logo` has already built the one-type geometry, and hit three walls.** Written 2026-09-04, `cascade-logo/lib/geometry.ts` declares a namespaced `project.geometry`:

```ts
export interface Geometry { lines: Line[]; dots: Point[]; size: [number, number] }
```

with `bounds`, `transform`, `length` and `resample` beside it, and every node in that project is `project.geometry` in, `project.geometry` out. It abandoned all five core geometry types to get there. That is the plan's first decision, taken independently, by someone with a deadline.

The proposed types express it directly: `lines` are open `poly` primitives, `dots` are points no primitive references, and `size` is a detail attribute. Nothing in it contradicts the design. What it lacks is the rest of the model, and the lack shows in three places.

It has no attribute level, so `svg-export` has one global `weight` prop and cannot vary stroke width per line, which is the thing `cloud-plots` needed and hand-rolled.

It has no groups, so there is no `layer-group` equivalent at all.

And `dot-scatter` carries a **second output**, `dots`, typed `points`, alongside its real `project.geometry` output, for no reason but that Studio cannot preview a project type. A node emitting a duplicate of its own data so the viewer will draw something is the clearest possible argument that geometry has to be a core type with a core renderer rather than a project convention.

**`layer-group` is groups, at the cost of a full copy.** It outputs `type: 'array'` of `{id, curves, dash_marks, dots}`, one entry per mark region, each becoming a `<g id="...">` in the exported SVG so that, in its own words, the file can be *"selected/edited/reassigned-per-pen layer by layer in vector or plotter software, rather than one flat blob of paths."* There is no way to say "this subset of primitives" in the type system, so it duplicates the geometry per layer, which is the 5.8 MB above. A named `Uint8Array` mask over one geometry is the same information for 39 KB, and per-pen SVG groups are a real requirement rather than a nice-to-have, so `SvgExport` emitting one `<g>` per primitive group belongs in the slice.

**`render-preview` reassembles by hand what the type system should have handed it.** It takes four separately typed wires and builds `primitives = { curves, dash_marks, dots, rects }` before doing anything. The terminal node of the real pipeline reconstructs a unified geometry from four types, every cook. That is the conversion tax the single-type decision avoids, being paid today.

**Points already cross as a path, on a `points`-typed port.** `stage_stipple_points` returns `{"points": _write_field(points, a["out"])}`, which is a **string** ending in `.npy`, and `stage_stipple_render` reads it back with `_read_field`. Meanwhile `hatch-curves` returns `{"curves": [c.tolist() ...]}`, real JSON. So one declared type carries an object in one node and a file path in another, which is why `geometryRaster` has a string branch. The geometry-file reference form is not speculative; it is in production and undeclared.

**Precision, answered.** The stipple `.npy` is `float64`. The JSON coordinates are full-precision doubles (`880.8163934260064`). The signal fields, by contrast, are explicitly `.astype(np.float32)` at every stage. So the existing convention is already f32 for raster data and f64 for geometry, and at 170,000 vertices f64 costs 2.7 MB against f32's 1.4 MB. Choosing f32 would save 1.4 MB and introduce a lossy narrowing at a Python boundary that is currently lossless. That settles it.

## What Houdini's model actually is

Worth stating precisely, because the borrowable part is not the SOP list. It is one data structure with four addressing levels, and the fact that almost every SOP takes that structure and returns that structure.

A Houdini geometry, the thing on a SOP's output, holds:

**Points.** A point is a position in space and nothing else structurally. Its position lives in a point attribute conventionally named `P`. Points exist independently of any primitive; a geometry can be nothing but points, which is what `Scatter` and `Add` produce.

**Vertices.** A vertex belongs to exactly one primitive and references exactly one point. This is the level that most people skip and it is the one doing the work. Two polygons meeting at a corner share one *point* but have two *vertices*, so a discontinuity across the seam (a different colour on each side, a UV cut) is a vertex attribute, while the shared position is a point attribute. Without a vertex level you cannot have both.

**Primitives.** A primitive is an ordered run of vertices plus a kind: polygon (open or closed), curve of some basis, volume, packed reference, and others. "Primitive" is the level a per-shape property belongs to: which stroke this is, how thick it is, whether it is closed.

**Detail.** Exactly one, per geometry. Where global facts live: a bounding box, a seed, a page size, a name.

Attributes live at all four levels. Each is a name plus a type (float, int, string, vector2/3/4, matrix, array) and a size, stored as a parallel array indexed by point number, vertex number, primitive number, or nothing. Groups are named subsets at each level. Some attributes are conventional rather than special: `P` position, `N` normal, `Cd` colour, `pscale` size, `orient`, `width`. Houdini also exposes read-only intrinsics that are derived rather than stored.

**Why the four-level split is the composable part.** Because every SOP has the same signature. `Scatter` returns geometry. `Transform` takes geometry and returns geometry. `Copy to Points` takes two geometries and returns geometry. There is no conversion node between "points" and "curves" because there is no distinction to convert: a point cloud is a geometry whose primitive count is zero, and a set of strokes is a geometry whose point count happens to be covered by primitives. That is why the node set feels infinite: with N nodes you get N-squared useful pairings, because every output fits every input.

The second half of the same idea is that **attributes carry the semantics, not the types.** `Scatter` does not need to know it is scattering onto a logo; it reads `P` and writes `P`. `Copy to Points` reads `pscale` and `N` and `orient` if they are there and ignores them if they are not. So a node written once composes with nodes written later that invent new attributes, and this is exactly what Cascade's current `Rect.tag` and `Polyline.weight` cannot do.

Two things I am less sure of and will not assert: the precise default rules Houdini uses when promoting an attribute between levels (whether the default for point-to-primitive is mean or first is a per-node setting, and I do not remember its default), and the exact set of curve bases in current versions. Neither affects the design below.

The part explicitly not worth borrowing: Houdini's geometry is 3D-first, its attribute defaults assume it, and its 2D story is a set of SOPs that operate in the XZ or XY plane by convention. Cascade should be 2D-first and 3D-capable, which is the inverse.

## The proposed type layer

**Decision: one type, not five.** `geometry` becomes a core type and the five existing names fold onto it.

The argument is Houdini's, plus two that are specific to Cascade. First, `runtime.ts`'s `canConnect` has no geometry entries and adding them would mean a conversion matrix: five types is twenty directed pairs, most of which are lossy, and each one either becomes an implicit conversion (which the type doc explicitly forbids for lossy cases) or a node the artist has to place. Second, the existing five cannot express what is already needed. There is no type for a bundle of chains, no way to attach a second attribute to anything, and no 2D mesh. Filling in the five interfaces means inventing a sixth for chain bundles and a per-type attribute slot for each, and then writing the conversion matrix. Replacing them with one type is less work and a better result.

The evidence agrees, unprompted: `cascade-logo` invented a single namespaced `project.geometry` and made every node take it and return it, abandoning all five core types to do so, and `render-preview` in `cloud-plots` reassembles four typed wires into one bundle before it can draw anything. One project routed around the five types and the other pays the conversion tax every cook.

`mesh` survives as a separate type, and only `mesh`. Its own doc comment in `coreTypes.ts` gives the reason: *"Flat arrays on purpose: this is what goes into a vertex buffer, and unpacking it into objects only to repack it would be the cost this type exists to avoid."* That is a render-handoff descriptor, not authored geometry. So the split is `geometry` for the thing nodes edit and `mesh` for the thing a GPU consumes, with one `Triangulate` node between them. This is the same distinction the type set already draws between `image` (durable, portable) and `texture` (live, session-bound), and it is the only one of the five that earns its own name.

`points`, `lines`, `polyline` and `rects` become legacy aliases folded by `normalizeType`, exactly as `curves` already folds onto `polyline`. That precedent is already in the file, with its reason attached: *"two names for one concept is how mask/field/plane/image turned into four things that all meant the same."* Four names for one concept is the same mistake one step further along.

### The structure

Contracts owns the types. Nothing here needs a dependency; typed arrays are ES built-ins.

```ts
/** How an attribute's values are stored. `f64` is the default for positions,
 *  because the existing Python bridge already writes points as float64 `.npy`
 *  and emits full-precision doubles in JSON, while it explicitly casts raster
 *  fields to float32. Narrowing positions to f32 would save 1.4 MB on a
 *  170,000-vertex cook and add a lossy step to a boundary that is lossless
 *  today. Offsetting and clipping accumulating error is the second reason,
 *  not the first. */
export type AttributeStorage = "f32" | "f64" | "i32" | "u8";

/** One attribute: a name, a component count, and a flat parallel array.
 *  Struct-of-arrays rather than array-of-structs, because the runtime's own
 *  clone path copies nested plain arrays element by element and passes typed
 *  arrays through by reference. The cheap shape is the flat one. */
export interface Attribute {
  readonly storage: AttributeStorage;
  /** Components per element. `P` is 3, `Cd` is 3, `width` is 1. */
  readonly size: number;
  /** Length is size * elementCount for the attribute's level. */
  readonly data: Float64Array | Float32Array | Int32Array | Uint8Array;
}

/** String attributes are a separate shape because a typed array cannot hold
 *  them, and because Houdini's string attributes are indices into a table
 *  rather than per-element strings. Same trick: the table is usually tiny. */
export interface StringAttribute {
  readonly storage: "string";
  readonly size: 1;
  readonly table: readonly string[];
  readonly data: Int32Array;
}

export type AnyAttribute = Attribute | StringAttribute;
export type AttributeSet = Readonly<Record<string, AnyAttribute>>;

/** Primitive kinds. `poly` is the only one v1 produces or consumes. The others
 *  are declared now so that adding them later is a new case in the switch
 *  rather than a change to the document format. */
export type PrimitiveKind = "poly" | "curve" | "mesh" | "packed";

/**
 * Primitive topology, CSR-style: `vertexPoints` is the flat vertex-to-point
 * table, and `offsets` slices it per primitive. Vertex v of primitive i is
 * vertexPoints[offsets[i] + v], and offsets has primitiveCount + 1 entries so
 * the last primitive's extent needs no special case.
 *
 * This is Houdini's model without the pointers. Keeping vertices as their own
 * addressable level is what makes a per-corner value possible at all, which is
 * the thing `Polyline.weight` was reaching for and could not express.
 */
export interface Topology {
  readonly vertexPoints: Int32Array;
  readonly offsets: Int32Array;
  readonly kinds: Uint8Array;
  /** 1 when the primitive's last vertex connects back to its first. Separate
   *  from `kinds` because open and closed polygons are the same kind of thing
   *  and every 2D node cares about the difference. */
  readonly closed: Uint8Array;
}

/** A named subset at one level. Stored as a bitmask rather than an index list
 *  because group membership is tested far more often than it is enumerated. */
export type Groups = Readonly<Record<string, Uint8Array>>;

export interface Geometry {
  readonly kind: "geometry";
  readonly pointCount: number;
  readonly vertexCount: number;
  readonly primitiveCount: number;
  readonly topology: Topology;
  readonly point: AttributeSet;
  readonly vertex: AttributeSet;
  readonly primitive: AttributeSet;
  /** One value per name, not an array. Houdini's detail level. */
  readonly detail: Readonly<Record<string, number | string | readonly number[]>>;
  readonly pointGroups: Groups;
  readonly primitiveGroups: Groups;
}
```

`point.P` is required. Positions are just another attribute rather than a dedicated `positions: Float64Array` field, and **`P.size` is 2 or 3, declared per geometry, defaulting to 2.**

That second half is a correction. The first draft of this plan fixed `P.size` at 3 with z zeroed in 2D work, on the argument that a wasted component is a cheap way to leave the 3D door open and that a size flag is a branch every consumer pays. The reference workloads say otherwise, twice. The stipple `.npy` is shape `(7000, 2)`, so the real data is two-component and a fixed three would widen it on load for nothing. And `cloud-plots` already emits dots as `(cx, cy, r)`, where the third component is a **radius**, so "the third slot is z" is not a convention that can be inherited. Fixing the size at 3 would have meant a 50% widening on the dominant case in order to reserve a slot that one project has already spent on something else.

Declaring the size costs one `P.size` read at the top of each operation, which is less than it sounded: the operations that transform positions need a `mat3` or `mat4` branch regardless, and the rest are per-component loops that read the count anyway. And the 3D door is better for it. It is now the declared component count rather than a permanently wasted third of every position, which means opening it is setting a number rather than reinterpreting a field that already means something else.

The corollary is that **the fold from a legacy `points` value cannot be automatic.** A two-component entry is unambiguous. A three-component entry means `(x, y, radius)` in `cloud-plots` and would mean `(x, y, z)` under a 3D reading, and nothing in the value distinguishes them. The migration needs a per-project answer, and the radius case wants mapping to a `pscale` point attribute rather than to a third position component.

Radius is in fact the first real evidence for the attribute model at point level: `cloud-plots` needs a per-point size, `cascade-logo` does not, and both currently express that by choosing an element width. A named `pscale` attribute that is present or absent says the same thing without overloading the position.

**Decision: immutable, with copy-on-write at attribute granularity.** A `Geometry` is frozen; every operation returns a new one; the typed arrays it does not touch are shared by reference with its input. So `AttributeCreate` allocates one array and shares the rest, and `Transform` allocates one array and shares the topology. This is what makes a fifteen-node chain over 100,000 points affordable, and it is the reason the format is struct-of-arrays: with array-of-structs there is no granularity to share at.

The hazard is the one found above: `cloneValue` passes typed arrays through by reference and does not freeze them, so the language cannot enforce this. Two mitigations, both cheap. Node code never touches a raw array: it goes through `GeometryBuilder` and the read helpers, which is also better ergonomics. And `cascade check` gains an `architecture/*` diagnostic for a deterministic node that writes into an input attribute's `data`, which is a pattern a syntactic check can catch in the common cases. The rule is stated in the file next to the type, because a convention nobody wrote down is a bug waiting for its first author.

**Decision: a JSON interchange form, separate from the in-memory form.** `PropDefinition.default` and `DataInputDefinition.default` are typed `SerializableValueForType<T>`, and a typed array is not a `JsonValue`. `texture` solves this by mapping to `never`, which is right for a live GPU handle and wrong here, because a small geometry literal in a `.cascade` document is genuinely useful and because the Python and server boundaries need a wire format.

So there are two shapes with a codec between them:

```ts
/** The wire and document form. Plain arrays, JSON-safe, lossless. Verbose by
 *  design: a `.cascade` literal is authored by hand or by a small generator,
 *  and human-readable beats compact at that size. Bulk geometry does not
 *  belong here (see below). */
export interface GeometryJson {
  readonly kind: "geometry";
  readonly point?: Readonly<Record<string, { size: number; storage: string; data: readonly number[] } | { storage: "string"; data: readonly string[] }>>;
  readonly vertex?: /* same */ unknown;
  readonly primitive?: /* same */ unknown;
  readonly detail?: Readonly<Record<string, JsonValue>>;
  readonly topology?: { readonly vertexPoints: readonly number[]; readonly offsets: readonly number[]; readonly kinds?: readonly number[]; readonly closed?: readonly number[] };
  readonly pointGroups?: Readonly<Record<string, readonly number[]>>;
  readonly primitiveGroups?: Readonly<Record<string, readonly number[]>>;
}
```

and `SerializableValueForType<"geometry"> = GeometryJson`, with `ValueForType<"geometry"> = Geometry`. This is a new pattern in the type set: every other type has one shape for both. The reason to accept it is that the alternatives are worse, since a JSON-only geometry pays the clone cost on every cook and a typed-array-only geometry cannot be written in a document or crossed over the Python boundary.

For bulk geometry the precedent is already in the repository, at `geometryRaster.ts`: *"a stipple pass writes a `.npy` and passes its path, because seven thousand coordinate pairs through JSON on every cook is a cost with nothing to show for it."* So the third form is a **geometry file**, referenced the way `ImageRef` references pixels. That is a follow-on, not part of the slice, but the JSON form should not be designed as though it will carry a million points.

### Where the code lives

`packages/contracts/src/geometry.ts` holds the types above, the `GeometryJson` form, and nothing else. No functions with logic, no builders, no dependencies. `values.ts` gains `geometry` to `CORE_TYPES` and the two `ValueForType` / `SerializableValueForType` arms.

`packages/runtime/src/geometry/` holds everything that computes: `GeometryBuilder`, the attribute read and write helpers, the JSON codec, bounds, and the operations the nodes call. Nothing platform-specific, so no `fs`, no DOM, no `Canvas`. `ARCHITECTURE.md` already puts runtime-owned algorithms here and says compatibility nodes may adapt them but must not fork their semantics, which is the rule that keeps the Studio preview code from growing a third interpretation of what `lines` means.

The nodes are built-ins under `packages/runtime/src/builtins/geo/`, registered in a reserved `cascade.geo.*` namespace alongside `cascade.core.*`. **This is an expansion of the reserved surface and Marcus should rule on it.** The case for it: these nodes need the runtime's geometry operations, they are meant to be universal rather than per-project, and `ARCHITECTURE.md`'s rule that *"Unknown identifiers in Cascade's reserved `cascade.*` namespace fail explicitly"* means a project cannot shadow them by accident. The case against: `cascade.core.*` has so far been kept to structural and routing primitives, and a geometry library is a much larger thing to declare reserved and therefore permanent.

Every node is `runsOn: 'portable'` with no declared capabilities, which they can be because all of this is arithmetic. Two exceptions are named in the node set below, and they are exceptions for real reasons rather than convenience.

## The node set, in build order

Houdini equivalents named where there is one. Difficulty is stated honestly, because three of these are genuinely hard and the plan is worthless if it pretends otherwise.

**Stage 1, the spine.** Nothing works without these and none of them is hard.

`Merge` (Houdini: Merge SOP). Concatenates N geometries, renumbering points and offsets. Variadic input; `DataInputDefinition` already supports `variadic: true` and types it as `readonly ValueForType<T>[]`. Note that `cascade.core.Merge` cannot be reused, since it collects into an `array` rather than merging. Trivial, and it is the node that proves the format composes.

`Transform` (Transform SOP). Applies a `mat3` to `P`. Trivial. Uses the existing `mat3` type, which is already documented as column-major.

`Null` for geometry is not needed: `cascade.core.Null` is typed `any` and already passes anything through.

`AttributeCreate` (Attribute Create SOP). Adds a named attribute at a chosen level with a constant value. Trivial, and it is the node that makes the four-level model visible to the artist rather than an implementation detail.

**Stage 2, generators.** All trivial. Each emits one primitive, or a set of them, with `P` and `closed` set.

`Rectangle`, `Circle`, `Arc`, `Line`, `Grid` (Houdini: Grid, Circle, Line SOPs; Houdini has no Rectangle, its Grid with two rows does the job, but a Rectangle node is worth the name). `Circle` and `Arc` take a segment count, because v1 has no curve primitive; see the open decision on that.

`Text` (Font SOP) is the one generator that is not trivial and not portable. Turning a glyph into an outline needs the font file and a font parser. It is honest to say this is either a server node with the `files` capability plus a font library, or a browser node going through Canvas and a path extraction, and that it is out of the slice either way. Houdini's Font SOP is a wrapper around exactly that machinery.

**Stage 3, point operations.** All trivial, and all of them are why the Houdini node set feels productive.

`AddPoint` (Add SOP). Appends a point at a position, or converts a point set into one polyline in order, which is Add SOP's second and less obvious job.

`Scatter` (Scatter SOP). Distributes points inside closed primitives. Needs point-in-polygon and area-weighted primitive selection, both textbook. Must take its seed as an explicit input, since `ARCHITECTURE.md` is unambiguous that *"Randomness is a pure function of an authored seed, never ambient process state"* and `cascade.core.Random` sets the pattern with explicit `seed` and `sample` inputs.

`Jitter` (Jitter SOP). Offsets `P` by seeded noise. Trivial, same seed rule.

`Sort` (Sort SOP). Reorders points or primitives by an axis, by an attribute, by proximity, or by a seeded shuffle. Trivial, and more useful than it sounds: for plotter output the primitive order is the pen path, so sorting is a performance node.

`CopyToPoints` (Copy to Points SOP). Instances one geometry onto every point of another, reading `pscale`, `N` and `orient` if present. Easy to write and the single highest-value node in the set, because it is where a generative composition actually comes from. This is also the node that justifies attributes rather than fixed fields: it composes with any attribute a later node invents.

`Delete` / `Blast` (Delete and Blast SOPs). Removes points or primitives by group or by an attribute predicate. Easy, and needed almost immediately.

**Stage 4, curve operations.** Here the difficulty stops being uniform.

`Resample` (Resample SOP). Rewrites each primitive at a uniform arc-length spacing or a target count. Straightforward, and it is a prerequisite for most of the rest. Build it early.

`Smooth` (Smooth SOP). Chaikin or a Gaussian pass along each chain, with an iteration count. Easy.

`Trim` / `Carve` (Carve SOP). Cuts a primitive at parametric or arc-length positions. Easy once `Resample` exists, since both need the same arc-length table.

`Join` (Join and Fuse SOPs). Welds endpoints within a tolerance and merges the chains that meet. Moderate: the welding is a spatial hash and a union-find, and the fiddly part is deciding orientation when two chains meet head to head.

`Offset` (Houdini: PolyExpand2D SOP, which is the honest equivalent; Peak SOP is the 3D-normal version and is not the same operation). **This is hard.** Offsetting a polyline correctly means handling self-intersection of the offset curve, cusps at concave corners, join styles, and the fact that a single input curve can produce several disjoint output curves or none. Doing it properly is a straight-skeleton or a Voronoi-based construction, or a Minkowski sum reduced to a polygon boolean. Doing it badly, by displacing each vertex along its angle bisector, works on convex shapes and produces garbage on anything else, and the garbage looks correct until it does not. It should not be in the slice, and when it is built it should be built on top of the boolean kernel rather than beside it.

**Stage 5, booleans and clipping.**

`Clip` (Clip SOP). Cutting geometry against a half-plane is genuinely easy for open polylines and easy enough for closed ones (Sutherland-Hodgman). Worth having early, and it is not the same problem as a general boolean.

`Boolean` (Boolean SOP, and Cookie SOP before it). **This is the hard one, and it is hard in a way that is not obvious.** The algorithm (Greiner-Hormann, or Vatti, or Martinez) is a few hundred lines. The difficulty is entirely numerical: coincident edges, vertices lying exactly on edges, near-degenerate segments, and the fact that a floating-point intersection point is not exactly on either input edge, so the topology decided at one intersection contradicts the topology decided at the next. Robust implementations use exact or adaptive-precision predicates, and the ones that do not are the reason Houdini shipped Boolean SOP to replace Cookie SOP after years of complaints about exactly this. It should not be written from scratch, and it should not be in the slice. When it comes, the two honest options are a dependency (Clipper2 is the reference implementation and has a WASM build) or a server capability, and `AGENTS.md` says not to add dependencies without a concrete need, so this is a decision to bring to Marcus with the boolean node rather than in advance of it. Note also that a WASM dependency inside `packages/runtime` sits awkwardly with the environment-neutral rule.

**Stage 6, attributes.**

`AttributePromote` (Attribute Promote SOP). Moves an attribute between levels with a stated reduction: point to primitive by mean or first or min or max, primitive to point by copy. Easy. The reduction must be an explicit prop rather than a default, since I do not trust my memory of Houdini's default and a silent one would be the wrong thing to inherit anyway.

`AttributeCopy` (Attribute Copy SOP). Copies an attribute from one geometry to another by index or by nearest point. Easy by index, moderate by proximity (another spatial hash).

`Group` / `GroupExpression` (Group SOP). Creates a named subset by bounding box, by attribute predicate, or by primitive kind. Easy, and it is what makes every node above able to act on part of a geometry, which is the other half of why Houdini's node set composes. It is also a direct replacement for `cloud-plots`'s `layer-group`, which groups curves, dashes and dots by which mark rectangle contains them: that is grouping by bounding box, and it is the one case that is already in production.

A `Wrangle`-equivalent, running a small expression per element, is deliberately not here. It is the single most powerful node in Houdini and it is a language, not a node.

**Stage 7, the output end.**

`SvgExport`. Emits an SVG document from geometry. Reads `width`, `Cd` and `opacity` from primitive attributes where they are present and falls back to a prop for each where they are not, which is the rule `svgio.py` already runs. Reads closed-ness from topology. **Emits one `<g id="...">` per primitive group**, which is not a refinement: `cloud-plots` has a whole `layer-group` node and a `layers` code path through the Python writer for exactly this, so that plotter and vector software can reassign pens layer by layer, and it duplicates the geometry per layer to get it. Easy, and it is the node that makes the whole library provably useful, because it produces a file Marcus can print or plot. Its output should be a `string` for the small case and an `asset` written through the `assets` capability for the real case; `assets` is available to a portable node, which `CapabilityForEnvironment<'portable'>` confirms is `"assets" | "media"`.

`Rasterize`. Geometry to an `image`, so a geometry stage can feed the existing image chain. Straightforward, and it retires `src/utils/geometryRaster.ts`, which is currently the only geometry renderer and interprets three shapes that no longer exist.

`Triangulate`. Geometry to `mesh`, for the GPU handoff. Ear clipping for simple polygons is easy; constrained Delaunay with holes is moderate. Only needed when there is something to render in 3D.

**And one Studio change that is not a node.** The geometry viewer and the Inspector summary currently branch four ways in `typePresentation.ts` and `geometryRaster.ts` over shapes that this plan deletes. Both collapse to one renderer over one type, which is a net reduction in Studio code and removes the three-way disagreement documented above. `DESIGN.md`'s core type presentation table needs its geometry rows rewritten to one row.

## The vertical slice

The smallest set that makes the library provably real, and useful for 2D vector work on the same day it lands.

**Types:** `Geometry`, `Attribute`, `StringAttribute`, `Topology` and `GeometryJson` in `packages/contracts/src/geometry.ts`; `geometry` added to `CORE_TYPES`; `GeometryBuilder`, attribute accessors, the JSON codec and bounds in `packages/runtime/src/geometry/`. The four legacy names folded in `normalizeType`, and `normalizeType` moved into contracts so the runtime and Studio stop keeping separate copies. A geometry case in `validate.ts`'s `defaultMatches`, because "any JSON value is a valid default" is not a thing to leave in place while adding a sixth geometry type.

**Nodes, ten of them:** `Rectangle`, `Circle`, `Grid`, `Merge`, `Transform`, `Resample`, `Scatter`, `CopyToPoints`, `AttributeCreate`, `SvgExport` (with per-group `<g>` output).

`AttributeCreate` moved into the slice on the evidence. It was one place outside it on the argument that the four-level model could be demonstrated without it, and that is wrong: the two live bugs in `cloud-plots` are both attributes being dropped by an operation that had not heard of them, and the thing that fixes them is a generic attribute an operation can carry without knowing its name. A slice that cannot create an attribute cannot show that.

**Studio:** one `geometry` renderer replacing the four-way branch, in Inspector summary and Viewer preview.

Why this set. It is a complete loop with an artefact at the end: a grid or a scattered point set, an instanced shape on every point, a transform, and an SVG on disk. That is a generative 2D composition, and it is the shape of work Marcus is actually doing. It exercises all four attribute levels rather than asserting they are useful: `P` at point level, `closed` and `width` at primitive level, the copy's source index at vertex level, and the document bounds at detail level. It contains `Merge` and `CopyToPoints`, which are the two nodes that fail loudly if the format does not compose, so a format mistake surfaces inside the slice rather than after twenty nodes are written against it. And `SvgExport` means the slice is judged by looking at the output rather than by reading a summary string, which is the failure mode the geometry viewer was written to fix in the first place.

The slice also has a real first customer. `cascade-logo` is eight nodes of `project.geometry` in and out, with `bounds`, `transform`, `length` and `resample` reimplemented in `lib/geometry.ts` because the core has none. Six of the ten slice nodes replace something that project wrote by hand last week, and its `dot-scatter` can drop the duplicate `points` output it only carries so Studio will draw something.

What is deliberately just outside it, in order: `Group`, `Sort`, `Delete`, `Jitter`, `Clip`, `Smooth`, `Rasterize`.

One more thing earns its place in the slice on the evidence, and it is not a node. **The `.npy` and geometry-file path form has to be in the codec from the start**, not deferred. `stipple-points` already returns a path string on a `points`-typed port and `stipple-render` reads it back, so a codec that only speaks JSON cannot round-trip the pipeline that exists. It is a small addition next to `ImageRef`, whose pattern it copies, and leaving it out means the first real graph cannot be ported.

## What I would not build

**A boolean kernel written here.** Covered above. It is a numerical-robustness problem, not an algorithm problem, and the honest choices are a vetted dependency or a server capability. Writing one produces something that works on the test cases and fails on real input.

**Curve offsetting before booleans.** The correct construction wants the same machinery. Building the naive bisector version first is worse than not having it, because it is right often enough to be trusted.

**A curve primitive in v1.** Beziers and NURBS as first-class primitives mean every node either handles two representations or refuses one, and Houdini's own answer is usually to convert to polygons. The `kinds` byte reserves the room. This is an open question below, because it has a real cost.

**Anything 3D.** No extrude, no revolve, no normals machinery, no UVs, no surfaces. `Mesh` stays as the render-handoff type and `Triangulate` is the one node that reaches it. The 3D door is left open by `P.size` being a declared number that may be 3 and by `PrimitiveKind` having unused cases, and that is all the 3D work worth doing now. `DESIGN.md` already lists "full 3D DCC tooling" as a non-goal.

**Volumes, VDB, packed primitives, and a spatial-index type.** Spatial acceleration is needed inside three or four nodes and should live inside them, not as a public type that then has to be kept immutable and serializable.

**A wrangle node.** It is an expression language with a per-element execution model, and Cascade already has an expression engine stranded in `src/engine` that `doc/PLAN node-authoring.md` says has no story on the neutral runtime. Building a second expression surface before that one is resolved would make the problem worse.

**A geometry editor in the Inspector.** `DESIGN.md` already decided this: *"geometry editors favor transparent structured editing and previews over specialized CAD interactions in this pass."* One caveat, in the open questions: a read-only attribute table is a different thing from an editor, and it is the Houdini panel that would be missed most.

**Filling in the existing five interfaces.** The reason is the whole of the first section. They have no producers, no consumers that agree, no validation, and no room for attributes. Filling them in means writing a twenty-pair conversion matrix and inventing a sixth type for chain bundles, to arrive somewhere worse than one type.

## Questions Marcus needs to rule on

**1. Curves — decided 2026-09-04 by Marcus: both.** *"No, we want curves + polylines; very similar but different interpolations."*

And that framing is the implementation. Not a second type, not two representations carried side by side in every node: **the primitive `kinds` field already in the CSR topology selects the interpolation over the same point list.** A poly primitive interpolates linearly between its points; a bezier primitive treats them as control points. Same attribute table, same topology, same ops, one field saying how to read a run of vertices — which is Houdini's own model, where a primitive is a polygon or a Bézier or a NURBS curve rather than living in a different container.

What follows from it:

`Circle` emits a curve by default, four control points rather than a 64-segment polygon, with a `segments` parameter to get a poly when a poly is what is wanted. That removes the one visible cost the 2D-first design was going to pay.

`SvgExport` writes `C` for curve kinds and `L` for poly. A curve that exports as a polyline has gained nothing, and both the plotter and the print pipeline want the curve.

`Resample` becomes the explicit *make this a polyline* operation rather than something that happens by accident, and it must flatten a curve correctly or refuse — treating control points as vertices produces a subtly wrong shape rather than an error, which is worse.

And the test that the design is right: **anything that only reads positions keeps working untouched.** A node that does not care about interpolation never learns there is a second kind.

**2. `cascade.geo.*` — decided 2026-09-04 by Marcus: reserved.** *"`.geo` is clear, all good."* So the geometry set is a runtime built-in namespace beside `cascade.core.*`, and the reserved surface grows from eight structural nodes to eight plus the geometry library.

That is a deliberate widening rather than a slip, and it draws a line worth stating: `cascade.core.*` is the structure of a graph — subnets, nulls, routing — while `cascade.geo.*` is a *medium*. A third namespace should have to argue for itself the way this one did, because the reserved surface is a promise about names that projects can never take back.

**3. Fold the legacy names — decided 2026-09-04 by Marcus: a hard cutover.** *"The project is still in its infancy — cut over hard into the new types and update all sketches in Cascade."*

So this is not a deprecation with an alias layer to carry. `points`, `lines`, `polyline` and `rects` are **removed** from `CORE_TYPES`, and the fold in `normalizeType` exists to keep saved documents loading during the migration and is **deleted when the last sketch is migrated**. A compatibility shim that outlives its migration is how a young codebase acquires an old one's weight, and the whole argument for cutting over now is that there are three sketches rather than three hundred.

That makes the migration part of the work rather than a follow-up, and it sets the order: the types and the ops, then enough nodes to prove the format composes, then the three sketches in `~/Documents/Cascade`, then the deletions.

Folding the type *name* is safe and automatic: a saved graph with a `points` port keeps loading, and every port that previously declared one of the four now declares `geometry`.

⚑ **Folding a legacy *value* is not automatic, and this is where the migration has to be done by hand rather than by a codec.** A 3-tuple in a `points` value means `(x, y, radius)` in `cloud-plots` and `(x, y, z)` under a 3D reading, and nothing in the value distinguishes them — so the reader cannot guess. Each project's values are mapped once, deliberately: `cloud-plots`' dots become `P` with `size: 2` plus a `pscale` point attribute, which is Houdini's own name for exactly that quantity and is what `stipple-render` is already reading the third slot as. The same applies to the +Y-down authoring noted in question 4: one flip, at the source, once.

**`mesh` is the one exception and stays a separate type.** Its own doc comment argues for the role — a handle to GPU-resident data, not a value to be operated on — and folding it would make `geometry` mean both an attribute table and a texture-side resource. If that is wrong, it is a small change later; making it wrong now would be the kind of type that has to mean two things.

### The cutover, in order

1. **`packages/contracts/src/geometry.ts`** — the types, the JSON form, the codec. Dependency-free.
2. **`packages/runtime/src/geometry/`** — builders and ops. Environment-neutral, no DOM, no Node.
3. **Six nodes that prove composition**: `Rectangle`, `Circle`, `Transform`, `Merge`, `CopyToPoints`, `SvgExport`. `Merge` and `CopyToPoints` are the pair that fails loudly if the attribute model does not compose, and `SvgExport` makes the result a file rather than an assertion.
4. **The rest of the slice**: `Grid`, `Resample`, `Scatter`, `AttributeCreate`, plus the Studio renderer that replaces the four-way preview branch.
5. **The three sketches**, in this order, because each teaches the next: `cascade-logo` (smallest, and its own `lib/geometry.ts` is the design already taken), `cloud-posters`, then `cloud-plots` (twenty nodes, the `pscale` mapping, the +Y flip, and the three attribute-dropping bugs).
6. **The deletions**: the four legacy type names, the `normalizeType` fold, `src/types/coreTypes.ts`'s duplicate vocabulary, and `runtime.ts`'s third private copy.

Step 6 is the one that is easy to skip and is the point of the exercise. A cutover that leaves the old names in place is not a cutover.

The consequence to sequence rather than discover: **the twenty `cloud-plots` nodes are the migration.** Their definition-v1 port is already queued and already blocked behind expressions ([[PLAN node-authoring]]), and this makes that port bigger and better — `render-preview` loses three of its four inputs, `layer-group` becomes `Group`, `mark-color-assign` becomes `AttributeCreate` plus a seeded random, and the three attribute-dropping bugs found in that project stop being possible.

**4. Axis direction — decided 2026-09-04 by Marcus: +Y up.** *"Plus-Y up is more natural to me."* So geometry is Houdini-handed, and every node in the set reads that way: a `Circle` at `+1` sits above the origin, `Scatter` inside a rectangle scatters in the same frame a `Transform` rotates in.

The consequence is a flip, and the point of deciding it once is that there is exactly one. SVG, Canvas and `geometryRaster.ts` are all +Y down, so **the flip belongs in the export and render nodes** — `SvgExport` writes a `transform="translate(0,H) scale(1,-1)"` on its root group, or negates Y as it emits, and the rasterizer does the same. Nothing upstream of the boundary knows about it. A flip applied per node instead is the version that produces a drawing that is right until you rotate it.

⚑ One thing this makes visible rather than causes: `cascade-logo` and `cloud-plots` both author geometry in +Y down today, because both were written against the rasterizer. Their coordinates are not wrong, they are expressed in the render frame — so a port of either has to flip once at the source, and the y values in a saved `.cascade` file cannot be reinterpreted silently.

**Units are still open**, and separable: whether a 2D geometry lives in abstract units or in a declared document space with millimetres for plate and plotter work. Print wants the second, and the detail level is where the declaration goes. It does not block the slice, since a `Transform` and an export size cover the same ground until it is answered.

**5. Where does stroke style live?** *Answered by `svgio.py`, and struck.* The rule is already invented and running: a per-primitive attribute when present, the render node's prop as the fallback. `color = r.get("color", mark_color)` and `opacity = float(r.get("opacity", 1.0))`, with the file's own comment saying it *"falls back to the single global `mark_color` when absent."* That is Houdini's convention arrived at independently, so `SvgExport` reads `width`, `Cd` and `opacity` from primitive attributes and takes a default for each as a prop. It does not need a decision, it needs writing down, which the node set now does.

**6. f64 or f32 for `P`?** *Answered by the cache, and struck.* The stipple `.npy` is `float64` and the JSON carries full-precision doubles, while the signal fields are explicitly cast to `float32`. The convention is already f32 for rasters and f64 for geometry. At 170,000 vertices f64 costs 2.7 MB against f32's 1.4 MB, so narrowing would save 1.4 MB and add a lossy step at a boundary that is currently lossless. f64 for `P`, and the plan no longer rests on my guess about the workload.

**7. What are the real reference workloads?** *Answered, and struck.* `cloud-plots`, `cloud-posters` and `cascade-logo` in `~/Documents/Cascade`, read for this draft. They are now the evidence section above, and they changed two things and confirmed a third. `P.size` went from a fixed 3 to a declared 2 or 3, because the real data is `(N, 2)` and one project already means radius by the third component. `SvgExport` gained per-group `<g>` output, because `layer-group` exists, duplicates 5.8 MB of geometry per cook to fake it, and its purpose is per-pen plotter layers. And the one-type decision was confirmed the hard way, by `cascade-logo` having already made that exact call under a deadline.

One new question falls out of them, which replaces the old seventh. **What happens to the twenty `cloud-plots` nodes?** They are dynamic legacy modules using `node.in`/`node.param`/`node.out`, not `definition`-v1, and `doc/PLAN node-authoring.md` has their definition-v1 port already queued and blocked behind expressions moving to the neutral runtime. Landing `geometry` gives that port a second reason to happen and a much larger diff: `render-preview` loses three of its four geometry inputs, `layer-group` becomes a `Group` node, `mark-color-assign` becomes `AttributeCreate` plus a seeded random, and the Python bridge's hand-rolled rect dictionaries become the JSON codec. That is a good outcome and it is not a small change, so it should be sequenced deliberately rather than discovered.

**8. A read-only geometry attribute table in Studio?** `DESIGN.md`'s non-goals list "spreadsheet-scale data editing", which rules out an editor and does not obviously rule out a viewer. Houdini's geometry spreadsheet is how anyone debugs an attribute problem, and without it the four-level model is invisible when it goes wrong.
