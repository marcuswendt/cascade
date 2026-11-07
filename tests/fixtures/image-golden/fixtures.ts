/**
 * Fixture graphs for the image-library golden test.
 *
 * Captured once on the class-based nodes (`src/nodes/image/nodes/*`, before
 * they were ported to definition-v1) and rendered again on the definition-v1
 * nodes in `packages/runtime/src/builtins/image/`; the two must agree pixel for
 * pixel. Each fixture is one node under test (`out`), fed only by the 8-bit
 * input PNGs beside this file through `cascade.image.Image`. A chain of class
 * nodes handed float buffers to each other where the ported nodes hand 8-bit
 * RGBA on, so a filter is only compared against an input both engines read the
 * same way: decoded from a PNG.
 *
 * `{{input}}` and `{{input2}}` stand for the input files; each harness puts its
 * own spelling of the path in (an absolute path for the class `Image` node,
 * the project-relative name for the runtime's `assets` capability).
 */
export interface GoldenFixture {
  readonly name: string;
  readonly nodes: readonly { id: string; module: string; props?: Record<string, unknown> }[];
  readonly connections?: readonly [string, string, string, string][];
}

export const INPUT_SIZE = [48, 36] as const;
export const INPUT2_SIZE = [32, 40] as const;

/** Deterministic input pixels: a colour field with a semi-transparent band. */
export function inputPixels(width: number, height: number, salt: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      data[index] = (x * 37 + y * 11 + salt * 53) % 256;
      data[index + 1] = (x * 5 + y * 29 + salt * 17) % 256;
      data[index + 2] = ((x ^ y) * 13 + salt * 101) % 256;
      data[index + 3] = salt === 2 ? Math.round(255 * (0.25 + 0.75 * (y / (height - 1)))) : 255;
    }
  }
  return data;
}

const image = (id: string, file: string, props: Record<string, unknown> = {}) => ({
  id,
  module: 'cascade.image.Image',
  props: { file, ...props },
});

const BLEND_MODES = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn',
  'hard-light', 'soft-light', 'difference', 'exclusion', 'add', 'subtract', 'divide', 'pin-light',
  'vivid-light', 'linear-dodge', 'linear-burn',
];

function composite(name: string, props: Record<string, unknown>): GoldenFixture {
  return {
    name,
    nodes: [
      image('a', '{{input}}'),
      image('b', '{{input2}}'),
      { id: 'out', module: 'cascade.image.Composite', props },
    ],
    connections: [['a', 'image', 'out', 'image1'], ['b', 'image', 'out', 'image2']],
  };
}

function filter(name: string, module: string, props: Record<string, unknown>, file = '{{input}}'): GoldenFixture {
  return {
    name,
    nodes: [image('a', file), { id: 'out', module, props }],
    connections: [['a', 'image', 'out', 'image']],
  };
}

function single(name: string, module: string, props: Record<string, unknown>): GoldenFixture {
  return { name, nodes: [{ id: 'out', module, props }] };
}

export const fixtures: readonly GoldenFixture[] = [
  single('color', 'cascade.image.Color', { color: [0.9, 0.2, 0.1, 1], resolution: [40, 30] }),
  single('color-legacy-object', 'cascade.image.Color', { color: { r: 0.3, g: 0.6, b: 0.9 }, resolution: [12, 9] }),
  single('color-translucent', 'cascade.image.Color', { color: [0.5, 0.25, 0.75, 0.4], resolution: [8, 8] }),
  single('checkers-size', 'cascade.image.Checkers', {
    color1: [1, 0.8, 0.2, 1], color2: [0.1, 0.2, 0.6, 1], size: 7.5, centered: true, resolution: [50, 40],
  }),
  single('checkers-divisions', 'cascade.image.Checkers', { mode: 'divisions', divisions: 5, resolution: [45, 30] }),
  single('noise', 'cascade.image.Noise', { seed: 42, scale: 0.05, iterations: 3, resolution: [48, 32] }),
  single('noise-default', 'cascade.image.Noise', { resolution: [40, 24] }),
  single('ramp-horizontal', 'cascade.image.Ramp', { resolution: [64, 8] }),
  single('ramp-vertical', 'cascade.image.Ramp', {
    type: 'vertical',
    points: [
      { position: 0, color: [1, 0, 0, 1], interpolation: 'linear' },
      { position: 0.5, color: '#00ff80', interpolation: 'smooth' },
      { position: 1, color: { r: 0, g: 0, b: 255 }, interpolation: 'constant' },
    ],
    resolution: [6, 40],
  }),
  single('ramp-radial', 'cascade.image.Ramp', {
    type: 'radial',
    points: [
      { position: 0.1, color: { r: 0.2, g: 0.1, b: 0.9, a: 0.5 } },
      { position: 0.7, color: 'rgb(250, 200, 10)', interpolation: 'smooth' },
    ],
    resolution: [40, 40],
  }),
  single('ramp-concentric', 'cascade.image.Ramp', { type: 'concentric', resolution: [33, 27] }),
  single('text', 'cascade.image.Text', {
    text: 'Hi\nCascade', font: 'sans-serif', fontSize: 14, color: [0.1, 0.9, 0.4, 1], resolution: [80, 48],
  }),
  single('text-styled', 'cascade.image.Text', {
    text: 'Tracking', font: 'sans-serif', fontSize: 16, fontWeight: 'bold', alignH: 'left', alignV: 'top',
    backgroundColor: [0.1, 0.1, 0.2, 1], letterSpacing: 2, rotation: 12, offset: [4, 2], opacity: 0.8,
    resolution: [96, 40],
  }),
  single('text-right-bottom', 'cascade.image.Text', {
    text: 'R', font: 'sans-serif', fontSize: 20, alignH: 'right', alignV: 'bottom', lineHeight: 1.5,
    color: { r: 1, g: 1, b: 0 }, resolution: [30, 30],
  }),
  { name: 'image-original', nodes: [image('out', '{{input}}')] },
  { name: 'image-max', nodes: [image('out', '{{input}}', { resolutionMode: 'max', maxResolution: [30, 30] })] },
  { name: 'image-fixed', nodes: [image('out', '{{input2}}', { resolutionMode: 'fixed', fixedResolution: [20, 50] })] },
  filter('blur-box', 'cascade.image.Blur', { radius: 3 }),
  filter('blur-box-wrap', 'cascade.image.Blur', { radius: 1.5, wrapEdges: true }, '{{input2}}'),
  filter('blur-gaussian', 'cascade.image.Blur', { method: 'gaussian', radius: 2.5 }),
  filter('blur-gaussian-wrap', 'cascade.image.Blur', { method: 'gaussian', radius: 1.2, wrapEdges: true }),
  filter('blur-zero', 'cascade.image.Blur', { radius: 0 }),
  filter('normalmap', 'cascade.image.NormalMap', { scale: 4, flipY: true }),
  filter('normalmap-default', 'cascade.image.NormalMap', {}),
  filter('resize-scale', 'cascade.image.Resize', { scale: 0.5 }),
  filter('resize-fixed', 'cascade.image.Resize', { mode: 'fixed', width: 37, height: 23 }, '{{input2}}'),
  filter('transform-bilinear', 'cascade.image.Transform', { translate: [3, -2], rotation: 30, scale: [0.8, 0.8] }),
  filter('transform-nearest-repeat', 'cascade.image.Transform', {
    rotation: -15, scale: [1.5, 0.5], uniformScale: false, filter: 'nearest', wrap: 'repeat', pivot: 'top-left',
  }),
  filter('transform-mirror', 'cascade.image.Transform', { translate: [10, 5], wrap: 'mirror', pivot: 'bottom-right' }),
  filter('transform-transparent', 'cascade.image.Transform', {
    rotation: 45, wrap: 'transparent', pivot: 'custom', customPivot: [0.25, 0.75],
  }, '{{input2}}'),
  ...BLEND_MODES.map((blendMode) => composite(`composite-${blendMode}`, { blendMode, opacity: 0.7 })),
  composite('composite-largest-fit', { blendMode: 'screen', outputResolution: 'largest', fitMode: 'fit' }),
  composite('composite-smallest-stretch', { blendMode: 'overlay', outputResolution: 'smallest', fitMode: 'stretch' }),
  composite('composite-input2-native', { blendMode: 'normal', outputResolution: 'input2', fitMode: 'native', opacity: 0.5 }),
  composite('composite-custom-fill', { outputResolution: 'custom', customResolution: [30, 30] }),
];

/** A fixture as a `.cascade` document, with the input files spelled for one harness. */
export function fixtureDocument(fixture: GoldenFixture, files: { input: string; input2: string }) {
  const spell = (value: unknown) =>
    value === '{{input}}' ? files.input : value === '{{input2}}' ? files.input2 : value;
  return {
    version: '0.2',
    nodes: fixture.nodes.map((node, index) => ({
      id: node.id,
      module: node.module,
      position: [index * 200, 0],
      ...(node.props ? { props: Object.fromEntries(Object.entries(node.props).map(([key, value]) => [key, spell(value)])) } : {}),
    })),
    connections: (fixture.connections ?? []).map(([from, fromPort, to, toPort]) => [[from, 0, fromPort], [to, 0, toPort]]),
  };
}
