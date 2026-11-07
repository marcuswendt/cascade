import type { NodeDefinition } from "@cascade/contracts";

/**
 * The image library's declarations: `cascade.image.*`, the eleven nodes that
 * were Studio classes until 2026-11-07, with the same module ids, ports and
 * prop names, so a saved graph loads unchanged.
 *
 * Literal and small on purpose: these sit in Studio's first-paint bundle with
 * the rest of the built-in list, and each node's body loads behind a dynamic
 * import the first time it cooks (`index.ts`).
 *
 * Every node is `portable` with `assets`: an image arrives as an `ImageRef`
 * and leaves as one, through the host's in-memory image contract (`io.ts`).
 */

export const contactSheetDefinition = {
  apiVersion: 1,
  label: "Contact Sheet",
  description: "Lay images out as one labelled grid.",
  icon: "LayoutGrid",
  runsOn: "portable",
  capabilities: ["assets"],
  inputs: {
    images: { kind: "data", type: "image", variadic: true },
    /** More images after the wired ones: image values or project-relative paths. */
    list: { kind: "data", type: "array" },
  },
  outputs: {
    image: { kind: "data", type: "image" },
    asset: { kind: "data", type: "asset" },
  },
  props: {
    columns: { type: "int", default: 0, min: 0, max: 64, description: "0: as square as the count allows." },
    gap: { type: "int", default: 16, min: 0, max: 512 },
    background: { type: "color", default: [1, 1, 1, 1], label: "Background" },
    cellWidth: { type: "int", default: 0, min: 0, max: 8192, description: "0: images at their own size. Otherwise each is scaled to fit this width." },
    labels: { type: "string", default: "", description: "One label per line, in image order." },
    labelSize: { type: "int", default: 14, min: 6, max: 128 },
    labelColor: { type: "color", default: [0.1, 0.1, 0.1, 1], label: "Label Colour" },
    filename: { type: "string", default: "contact-sheet.png", label: "Filename" },
  },
} as const satisfies NodeDefinition;

export const colorDefinition = {
  apiVersion: 1,
  label: "Color",
  description: "A solid colour.",
  icon: "Square",
  runsOn: "portable",
  capabilities: ["assets"],
  outputs: { image: { kind: "data", type: "image" } },
  props: {
    color: { type: "color", default: [1, 1, 1, 1], label: "Color" },
    resolution: { type: "vec2i", default: [512, 512], min: 1, max: 4096, label: "Resolution" },
  },
} as const satisfies NodeDefinition;

export const checkersDefinition = {
  apiVersion: 1,
  label: "Checkers",
  description: "A checkerboard.",
  icon: "Grid",
  runsOn: "portable",
  capabilities: ["assets"],
  outputs: { image: { kind: "data", type: "image" } },
  props: {
    color1: { type: "color", default: [1, 1, 1, 1], label: "Color 1" },
    color2: { type: "color", default: [0, 0, 0, 1], label: "Color 2" },
    mode: {
      type: "string", default: "size", label: "Mode", control: "select",
      options: [{ value: "size", label: "Size" }, { value: "divisions", label: "Divisions" }],
    },
    size: { type: "float", default: 32, min: 1, max: 512, step: 0.1, label: "Size", description: "Cell size in pixels (mode Size)." },
    divisions: { type: "int", default: 16, min: 1, max: 512, step: 1, label: "Divisions", description: "Cells across (mode Divisions)." },
    centered: { type: "bool", default: false, label: "Centered" },
    resolution: { type: "vec2i", default: [512, 512], min: 1, max: 4096, label: "Resolution" },
  },
} as const satisfies NodeDefinition;

export const noiseDefinition = {
  apiVersion: 1,
  label: "Noise",
  description: "Fractal simplex noise, grey.",
  icon: "Cloud",
  runsOn: "portable",
  capabilities: ["assets"],
  outputs: { image: { kind: "data", type: "image" } },
  props: {
    seed: { type: "int", default: 0, min: 0, max: 10000, step: 1, label: "Seed" },
    scale: { type: "float", default: 0.01, min: 0.001, max: 1, step: 0.001, label: "Scale" },
    iterations: { type: "int", default: 4, min: 1, max: 8, step: 1, label: "Iterations" },
    resolution: { type: "vec2i", default: [512, 512], min: 1, max: 4096, label: "Resolution" },
  },
} as const satisfies NodeDefinition;

export const rampDefinition = {
  apiVersion: 1,
  label: "Ramp",
  description: "A colour ramp: horizontal, vertical, radial or concentric.",
  icon: "Gradient",
  runsOn: "portable",
  capabilities: ["assets"],
  outputs: { image: { kind: "data", type: "image" } },
  props: {
    type: {
      type: "string", default: "horizontal", label: "Type", control: "select",
      options: [
        { value: "horizontal", label: "Horizontal" },
        { value: "vertical", label: "Vertical" },
        { value: "radial", label: "Radial" },
        { value: "concentric", label: "Concentric" },
      ],
    },
    points: {
      type: "array",
      label: "Ramp",
      description: "{ position, color, interpolation: linear | smooth | constant } stops.",
      default: [
        { position: 0, color: { r: 0, g: 0, b: 0 }, interpolation: "linear" },
        { position: 1, color: { r: 1, g: 1, b: 1 }, interpolation: "linear" },
      ],
    },
    resolution: { type: "vec2i", default: [512, 512], min: 1, max: 4096, label: "Resolution" },
  },
} as const satisfies NodeDefinition;

export const textDefinition = {
  apiVersion: 1,
  label: "Text",
  description: "Text drawn with a CSS font family, or a font file from the project.",
  icon: "Type",
  runsOn: "portable",
  capabilities: ["assets"],
  outputs: { image: { kind: "data", type: "image" } },
  props: {
    text: { type: "string", default: "Hello, World!", label: "Text", control: "textarea" },
    font: {
      type: "string", default: "Inter, system-ui, sans-serif", label: "Font",
      description: "A CSS font family list, or a project font file (.otf, .ttf, .woff, .woff2); a file that is not there falls back to sans-serif.",
    },
    fontSize: { type: "float", default: 48, min: 1, max: 500, step: 1, label: "Font Size", control: "slider" },
    fontWeight: {
      type: "string", default: "normal", label: "Font Weight", control: "select",
      options: [
        { value: "normal", label: "Normal" },
        { value: "bold", label: "Bold" },
        { value: "100", label: "Thin (100)" },
        { value: "200", label: "Extra Light (200)" },
        { value: "300", label: "Light (300)" },
        { value: "500", label: "Medium (500)" },
        { value: "600", label: "Semi Bold (600)" },
        { value: "700", label: "Bold (700)" },
        { value: "800", label: "Extra Bold (800)" },
        { value: "900", label: "Black (900)" },
      ],
    },
    fontStyle: {
      type: "string", default: "normal", label: "Font Style", control: "select",
      options: [{ value: "normal", label: "Normal" }, { value: "italic", label: "Italic" }, { value: "oblique", label: "Oblique" }],
    },
    alignH: {
      type: "string", default: "center", label: "Horizontal Align", control: "select",
      options: [{ value: "left", label: "Left" }, { value: "center", label: "Center" }, { value: "right", label: "Right" }],
    },
    alignV: {
      type: "string", default: "middle", label: "Vertical Align", control: "select",
      options: [{ value: "top", label: "Top" }, { value: "middle", label: "Middle" }, { value: "bottom", label: "Bottom" }],
    },
    color: { type: "color", default: [1, 1, 1, 1], label: "Color" },
    backgroundColor: { type: "color", default: [0, 0, 0, 0], label: "Background" },
    resolution: { type: "vec2i", default: [512, 512], min: 1, max: 4096, label: "Resolution" },
    offset: { type: "vec2", default: [0, 0], min: -2048, max: 2048, step: 1, label: "Offset" },
    rotation: { type: "float", default: 0, min: -180, max: 180, step: 0.1, label: "Rotation", control: "slider" },
    letterSpacing: { type: "float", default: 0, min: -50, max: 100, step: 0.5, label: "Letter Spacing", control: "slider" },
    lineHeight: { type: "float", default: 1.2, min: 0.5, max: 3, step: 0.05, label: "Line Height", control: "slider" },
    opacity: { type: "float", default: 1, min: 0, max: 1, step: 0.01, label: "Opacity", control: "slider" },
  },
} as const satisfies NodeDefinition;

export const imageDefinition = {
  apiVersion: 1,
  label: "File",
  description: "An image file from the project, or an image input, optionally resized.",
  icon: "FileImage",
  runsOn: "portable",
  capabilities: ["assets"],
  inputs: { image: { kind: "data", type: "image", description: "Used instead of the file when wired." } },
  outputs: { image: { kind: "data", type: "image" } },
  props: {
    file: { type: "string", default: "", label: "File", description: "A project-relative image path." },
    resolutionMode: {
      type: "string", default: "original", label: "Resolution Mode", control: "select",
      options: [{ value: "original", label: "Original" }, { value: "max", label: "Max Resolution" }, { value: "fixed", label: "Fixed Resolution" }],
    },
    maxResolution: { type: "vec2i", default: [2048, 2048], min: 1, max: 4096, label: "Max Resolution" },
    fixedResolution: { type: "vec2i", default: [512, 512], min: 1, max: 4096, label: "Fixed Resolution" },
  },
} as const satisfies NodeDefinition;

export const blurDefinition = {
  apiVersion: 1,
  label: "Blur",
  description: "Box (three passes, fast) or true Gaussian blur.",
  icon: "Droplets",
  runsOn: "portable",
  capabilities: ["assets"],
  inputs: { image: { kind: "data", type: "image" } },
  outputs: { image: { kind: "data", type: "image" } },
  props: {
    method: {
      type: "string", default: "box", label: "Method", control: "select",
      options: [{ value: "box", label: "Box (Fast)" }, { value: "gaussian", label: "Gaussian (Accurate)" }],
    },
    radius: { type: "float", default: 5, min: 0, max: 100, step: 0.1, label: "Radius" },
    wrapEdges: { type: "bool", default: false, label: "Wrap Edges" },
  },
} as const satisfies NodeDefinition;

export const normalMapDefinition = {
  apiVersion: 1,
  label: "Normal Map",
  description: "A normal map from the red (or grey) channel as height.",
  icon: "Box",
  runsOn: "portable",
  capabilities: ["assets"],
  inputs: { image: { kind: "data", type: "image" } },
  outputs: { image: { kind: "data", type: "image" } },
  props: {
    scale: { type: "float", default: 1, min: 0, max: 10, step: 0.1, label: "Scale" },
    flipX: { type: "bool", default: false, label: "Flip X" },
    flipY: { type: "bool", default: false, label: "Flip Y" },
  },
} as const satisfies NodeDefinition;

export const resizeDefinition = {
  apiVersion: 1,
  label: "Resize",
  description: "Scale an image, or resize it to a fixed size, bilinear.",
  icon: "Maximize2",
  runsOn: "portable",
  capabilities: ["assets"],
  inputs: { image: { kind: "data", type: "image" } },
  outputs: { image: { kind: "data", type: "image" } },
  props: {
    mode: {
      type: "string", default: "scale", label: "Mode", control: "select",
      options: [{ value: "scale", label: "Scale" }, { value: "fixed", label: "Fixed" }],
    },
    scale: { type: "float", default: 1, min: 0.1, max: 10, step: 0.1, label: "Scale" },
    width: { type: "int", default: 512, min: 1, max: 4096, step: 1, label: "Width" },
    height: { type: "int", default: 512, min: 1, max: 4096, step: 1, label: "Height" },
  },
} as const satisfies NodeDefinition;

export const transformDefinition = {
  apiVersion: 1,
  label: "Transform",
  description: "Rotate, translate and scale an image about a pivot.",
  icon: "Move",
  runsOn: "portable",
  capabilities: ["assets"],
  inputs: { image: { kind: "data", type: "image" } },
  outputs: { image: { kind: "data", type: "image" } },
  props: {
    translate: { type: "vec2", default: [0, 0], min: -2048, max: 2048, step: 1, label: "Translate" },
    rotation: { type: "float", default: 0, min: -180, max: 180, step: 0.1, label: "Rotation" },
    scale: { type: "vec2", default: [1, 1], min: 0.01, max: 10, step: 0.01, label: "Scale" },
    uniformScale: { type: "bool", default: true, label: "Uniform Scale" },
    pivot: {
      type: "string", default: "center", label: "Pivot", control: "select",
      options: [
        { value: "center", label: "Center" },
        { value: "top-left", label: "Top Left" },
        { value: "top-right", label: "Top Right" },
        { value: "bottom-left", label: "Bottom Left" },
        { value: "bottom-right", label: "Bottom Right" },
        { value: "custom", label: "Custom" },
      ],
    },
    customPivot: { type: "vec2", default: [0.5, 0.5], min: 0, max: 1, step: 0.01, label: "Custom Pivot" },
    filter: {
      type: "string", default: "bilinear", label: "Filter", control: "select",
      options: [{ value: "nearest", label: "Nearest" }, { value: "bilinear", label: "Bilinear" }],
    },
    wrap: {
      type: "string", default: "clamp", label: "Wrap Mode", control: "select",
      options: [
        { value: "clamp", label: "Clamp" },
        { value: "repeat", label: "Repeat" },
        { value: "mirror", label: "Mirror" },
        { value: "transparent", label: "Transparent" },
      ],
    },
  },
} as const satisfies NodeDefinition;

export const compositeDefinition = {
  apiVersion: 1,
  label: "Composite",
  description: "Blend image2 over image1.",
  icon: "Layers",
  runsOn: "portable",
  capabilities: ["assets"],
  inputs: {
    image1: { kind: "data", type: "image" },
    image2: { kind: "data", type: "image" },
  },
  outputs: { image: { kind: "data", type: "image" } },
  props: {
    blendMode: {
      type: "string", default: "multiply", label: "Blend Mode", control: "select",
      options: [
        { value: "normal", label: "Normal" },
        { value: "multiply", label: "Multiply" },
        { value: "screen", label: "Screen" },
        { value: "overlay", label: "Overlay" },
        { value: "darken", label: "Darken" },
        { value: "lighten", label: "Lighten" },
        { value: "color-dodge", label: "Color Dodge" },
        { value: "color-burn", label: "Color Burn" },
        { value: "hard-light", label: "Hard Light" },
        { value: "soft-light", label: "Soft Light" },
        { value: "difference", label: "Difference" },
        { value: "exclusion", label: "Exclusion" },
        { value: "add", label: "Add" },
        { value: "subtract", label: "Subtract" },
        { value: "divide", label: "Divide" },
        { value: "pin-light", label: "Pin Light" },
        { value: "vivid-light", label: "Vivid Light" },
        { value: "linear-dodge", label: "Linear Dodge" },
        { value: "linear-burn", label: "Linear Burn" },
      ],
    },
    opacity: { type: "float", default: 1, min: 0, max: 1, step: 0.01, label: "Opacity" },
    outputResolution: {
      type: "string", default: "input1", label: "Output Resolution", control: "select",
      options: [
        { value: "input1", label: "Use Input 1" },
        { value: "input2", label: "Use Input 2" },
        { value: "largest", label: "Largest Input" },
        { value: "smallest", label: "Smallest Input" },
        { value: "custom", label: "Custom" },
      ],
    },
    customResolution: { type: "vec2i", default: [512, 512], min: 1, max: 4096, label: "Resolution" },
    fitMode: {
      type: "string", default: "fill", label: "Fit Mode", control: "select",
      options: [
        { value: "fill", label: "Fill (Crop)" },
        { value: "fit", label: "Fit (Letterbox)" },
        { value: "stretch", label: "Stretch" },
        { value: "native", label: "Native (No Scale)" },
      ],
    },
  },
} as const satisfies NodeDefinition;
