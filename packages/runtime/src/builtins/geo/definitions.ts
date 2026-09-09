import type { NodeDefinition } from "@cascade/contracts";

export const rectangleDefinition = {
  apiVersion: 1,
  label: "Rectangle",
  description: "A closed four-point polygon, counter-clockwise from bottom-left.",
  icon: "Square",
  runsOn: "portable",
  inputs: {
    size: { kind: "data", type: "vec2", default: [1, 1] },
    center: { kind: "data", type: "vec2", default: [0, 0] },
  },
  outputs: { geometry: { kind: "data", type: "geometry" } },
} as const satisfies NodeDefinition;

export const circleDefinition = {
  apiVersion: 1,
  label: "Circle",
  description:
    "A closed circle, as one cubic Bezier chain or as a polygon of divisions segments.",
  icon: "Circle",
  runsOn: "portable",
  inputs: {
    center: { kind: "data", type: "vec2", default: [0, 0] },
    radius: { kind: "data", type: "vec2", default: [1, 1] },
    divisions: {
      kind: "data",
      type: "int",
      default: 32,
      min: 3,
      step: 1,
      description: "Segments of the polygonal form. Ignored by the Bezier form.",
    },
  },
  outputs: { geometry: { kind: "data", type: "geometry" } },
  props: {
    type: {
      type: "string",
      default: "bezier",
      label: "Primitive Type",
      control: "select",
      options: ["bezier", "poly"],
      description:
        "A Bezier circle is a circle; a polygon of any division count is visibly a polygon in print.",
    },
  },
} as const satisfies NodeDefinition;

export const transformDefinition = {
  apiVersion: 1,
  label: "Transform",
  description: "Translate, rotate and scale geometry about a pivot.",
  icon: "Move",
  runsOn: "portable",
  inputs: {
    geometry: { kind: "data", type: "geometry" },
    translate: { kind: "data", type: "vec2", default: [0, 0] },
    rotate: {
      kind: "data",
      type: "float",
      default: 0,
      description: "Degrees, counter-clockwise.",
    },
    scale: { kind: "data", type: "vec2", default: [1, 1] },
    pivot: { kind: "data", type: "vec2", default: [0, 0] },
  },
  outputs: { geometry: { kind: "data", type: "geometry" } },
} as const satisfies NodeDefinition;

export const mergeDefinition = {
  apiVersion: 1,
  label: "Merge",
  description: "Concatenate geometries, taking the union of their attributes.",
  icon: "GitMerge",
  runsOn: "portable",
  inputs: { inputs: { kind: "data", type: "geometry", variadic: true } },
  outputs: { geometry: { kind: "data", type: "geometry" } },
} as const satisfies NodeDefinition;

export const copyToPointsDefinition = {
  apiVersion: 1,
  label: "Copy to Points",
  description: "Instance one geometry onto every point of another.",
  icon: "Copy",
  runsOn: "portable",
  inputs: {
    source: { kind: "data", type: "geometry" },
    target: { kind: "data", type: "geometry" },
  },
  outputs: { geometry: { kind: "data", type: "geometry" } },
  props: {
    targetGroup: {
      type: "string",
      default: "",
      label: "Target Group",
      description: "Copy onto this point group only; empty means every point.",
    },
    useTargetOrientations: {
      type: "bool",
      default: true,
      label: "Transform Using Target Point Orientations",
      description: "Read pscale and N from the target points.",
    },
  },
} as const satisfies NodeDefinition;

export const svgExportDefinition = {
  apiVersion: 1,
  label: "SVG Export",
  description: "Write geometry as an SVG document, one group element per group.",
  icon: "FileDown",
  runsOn: "portable",
  capabilities: ["assets"],
  inputs: { geometry: { kind: "data", type: "geometry" } },
  outputs: {
    svg: { kind: "data", type: "string" },
    asset: { kind: "data", type: "asset" },
  },
  props: {
    filename: { type: "string", default: "geometry.svg", label: "Filename" },
    width: {
      type: "float",
      default: 0,
      min: 0,
      label: "Width",
      description: "0 derives the width from the geometry bounds.",
    },
    height: { type: "float", default: 0, min: 0, label: "Height" },
    margin: { type: "float", default: 0, label: "Margin" },
    /**
     * An explicit world rectangle, `[minX, minY, maxX, maxY]`, instead of the
     * geometry's own bounds. All zero derives them as before.
     *
     * A frame sequence needs it: derived bounds give every frame its own
     * viewBox, so a growing drawing appears to zoom out over the animation.
     */
    bounds: { type: "vec4", default: [0, 0, 0, 0], label: "Bounds" },
    /** A ground behind the drawing. Fully transparent leaves the document
     *  transparent, which is what plotter work wants. */
    background: {
      type: "color",
      default: [0, 0, 0, 0],
      label: "Background",
      description: "A ground behind the drawing. Transparent by default, because a plotter wants paper.",
    },
    stroke: {
      type: "color",
      default: [0, 0, 0, 1],
      label: "Stroke",
      description: "Fallback for a primitive with no Cd attribute.",
    },
    strokeWidth: {
      type: "float",
      default: 1,
      min: 0,
      label: "Stroke Width",
      description: "Fallback for a primitive with no width attribute.",
    },
    opacity: {
      type: "float",
      default: 1,
      min: 0,
      max: 1,
      label: "Opacity",
      description: "Fallback for a primitive with no opacity attribute.",
    },
    fillMode: {
      type: "string",
      default: "none",
      label: "Fill Mode",
      control: "select",
      options: ["none", "solid"],
      description: "none leaves primitives unfilled, which is what plotter work wants.",
    },
    fill: {
      type: "color",
      default: [1, 1, 1, 1],
      label: "Fill",
      description: "Fill colour, used only when Fill Mode is solid.",
    },
    pointRadius: {
      type: "float",
      default: 0.5,
      min: 0,
      label: "Point Radius",
      description: "Fallback radius for a loose point with no pscale.",
    },
    precision: {
      type: "int",
      default: 3,
      min: 0,
      max: 15,
      step: 1,
      label: "Precision",
      description: "Decimal places on emitted coordinates.",
    },
  },
} as const satisfies NodeDefinition;

export const renderDefinition = {
  apiVersion: 1,
  label: "Render",
  description: "Draw a scene through a camera, as a raster.",
  icon: "Camera",
  runsOn: "portable",
  capabilities: ["assets"],
  inputs: {
    /**
     * A scene, or a geometry — `geometry` widens to `scene`, so wiring a
     * geometry straight in still works and arrives through `asScene`.
     *
     * Taking a scene rather than a geometry is what makes the viewport and this
     * node incapable of disagreeing about framing: both read the same object,
     * so the picture on screen and the picture in the PNG come from one camera
     * and one list of geometry rather than from two paths that have to be kept
     * in step by hand.
     */
    scene: { kind: "data", type: "scene" },
    /**
     * The camera, and required in the sense that matters: it may come from the
     * scene instead, but it may not be invented. A render with an implicit
     * camera is a render nobody can reproduce, and `cascade.core.Camera` is one
     * node away.
     *
     * Wired here it **overrides** the scene's own camera, which is what lets one
     * scene be rendered from several viewpoints without rebuilding it — and is
     * also why the viewport's navigated camera never reaches this node. A view
     * you dragged is not a document.
     */
    camera: { kind: "data", type: "camera" },
  },
  outputs: {
    image: { kind: "data", type: "image" },
    asset: { kind: "data", type: "asset" },
  },
  props: {
    /** Pixels. Separate from the camera's own `resolution`, which describes
     *  the frame the projection assumes — so a preview renders small and frames
     *  identically to the full-size render. */
    size: { type: "vec2i", default: [1280, 720], min: 16, max: 8192 },
    filename: { type: "string", default: "render.png", label: "Filename" },
    background: { type: "color", default: [0, 0, 0, 0], label: "Background" },
    /** Fallback for a primitive with no `Cd`, exactly as SvgExport's is. */
    stroke: { type: "color", default: [0, 0, 0, 1], label: "Stroke" },
    strokeWidth: { type: "float", default: 1, min: 0, max: 200, step: 0.05 },
    opacity: { type: "float", default: 1, min: 0, max: 1, step: 0.01 },
    /** Points no primitive claimed. Off by default: a trail system has
     *  thousands of vertices and a dot on every one buries the strokes. */
    drawPoints: { type: "bool", default: false, label: "Draw Loose Points" },
    pointRadius: { type: "float", default: 1.5, min: 0, max: 50, step: 0.1 },
  },
} as const satisfies NodeDefinition;

export const geoNodeDefinitions = Object.freeze([
  ["cascade.geo.Rectangle", rectangleDefinition],
  ["cascade.geo.Circle", circleDefinition],
  ["cascade.geo.Transform", transformDefinition],
  ["cascade.geo.Merge", mergeDefinition],
  ["cascade.geo.CopyToPoints", copyToPointsDefinition],
  ["cascade.geo.SvgExport", svgExportDefinition],
  ["cascade.geo.Render", renderDefinition],
] as const);
