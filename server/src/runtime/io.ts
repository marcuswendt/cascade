/** Shared `cascade/io` helpers. Studio uses project HTTP routes; other hosts
 * install a bridge. Image ports carry paths rather than ambient pixel buffers. */

export interface MediaOptions {
  /** Ask for a resized copy. Never upscales past the file's own resolution. */
  width?: number;
  /** 'webp' | 'png' | 'jpeg' | 'avif'. Defaults to WebP, which is what you want
   *  for anything being looked at rather than processed. */
  format?: string;
  /** The original bytes, unresized and unconverted. Use this when the pixels
   *  matter — reading a render back for further processing, not previewing it. */
  raw?: boolean;
  quality?: number;
}

/** Build the URL that serves a project file to the page. */
export function mediaUrl(path: string, options: MediaOptions = {}): string {
  if (/^(https?:|data:|blob:)/.test(path)) return path;
  const bridge = localIo();
  if (bridge?.url) return bridge.url(path, options);
  const clean = path.replace(/^\.?\//, '');
  const encoded = clean.split('/').map(encodeURIComponent).join('/');
  const params = new URLSearchParams();
  if (options.raw) params.set('raw', '1');
  else {
    if (options.width) params.set('w', String(options.width));
    if (options.format) params.set('fmt', options.format);
    if (options.quality) params.set('q', String(options.quality));
  }
  const query = params.toString();
  return `/api/media/${encoded}${query ? `?${query}` : ''}`;
}

/**
 * The transport a host installs so `cascade/io` can reach project files.
 *
 * Same shape of decision as `cascade/stage`: the page posts to the server,
 * because that is the only door a browser has, and a headless host installs a
 * local transport before it runs the graph. Without one, every read here is a
 * `fetch('/api/media/...')` against a relative URL with no origin to resolve it
 * — which is exactly how a Canvas 2D node came to render in Studio and fail
 * under `cascade run`.
 *
 * Paths stay project-relative on both sides. The bridge, not the node, decides
 * what that resolves to.
 */
export interface IoBridge {
  /** Read a project file's bytes. */
  read(path: string, options?: MediaOptions): Promise<Uint8Array>;
  /** Write bytes into the project cache. Returns the stored project-relative path. */
  write(path: string, data: Uint8Array): Promise<string>;
  /** Host-owned display URL, valid until the host releases its stored asset. */
  url?(path: string, options?: MediaOptions): string;
}

const IO_BRIDGE_KEY = '__cascadeIoBridge';

/** Install the local transport. Returns a disposer, so a test can take it down. */
export function installIoBridge(bridge: IoBridge | null): () => void {
  const globals = globalThis as Record<string, unknown>;
  const previous = globals[IO_BRIDGE_KEY];
  globals[IO_BRIDGE_KEY] = bridge ?? undefined;
  return () => {
    globals[IO_BRIDGE_KEY] = previous;
  };
}

function localIo(): IoBridge | null {
  const bridge = (globalThis as Record<string, unknown>)[IO_BRIDGE_KEY] as IoBridge | undefined;
  return bridge && typeof bridge.read === 'function' && typeof bridge.write === 'function' ? bridge : null;
}

/**
 * A project file's bytes, over whichever transport this host has. Every read in
 * this module goes through here so the two hosts differ in one place only.
 */
export async function loadBytes(path: string, options: MediaOptions = { raw: true }): Promise<ArrayBuffer> {
  const bridge = localIo();
  if (bridge) {
    const bytes = await bridge.read(path, options);
    // A Buffer is usually a view into a larger pool, and `loadFloats` builds a
    // typed-array VIEW onto whatever comes back — so hand on the exact bytes.
    const exact = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      ? bytes.buffer
      : bytes.slice().buffer;
    return exact as ArrayBuffer;
  }
  const response = await fetch(mediaUrl(path, options));
  if (!response.ok) throw new Error(`cascade/io: cannot load ${path} (${response.status})`);
  return await response.arrayBuffer();
}

/**
 * Load a project image as an <img>. Defaults to `raw` — a node is processing
 * these pixels, not showing them, so a re-encoded copy would be the wrong thing
 * to hand it. Pass a width explicitly to work at a smaller size on purpose.
 */
export async function loadImage(path: string, options: MediaOptions = { raw: true }): Promise<HTMLImageElement> {
  const image = new Image();
  const bridge = localIo();
  let temporaryUrl: string | undefined;
  try {
    if (bridge?.url) {
      image.crossOrigin = 'anonymous';
      image.src = bridge.url(path, options);
    } else if (bridge) {
      const bytes = await loadBytes(path, options);
      if (typeof document === 'undefined') {
        // The Node canvas Image decoder accepts bytes, not browser Blob URLs.
        (image as unknown as { src: unknown }).src = new Uint8Array(bytes);
      } else {
        temporaryUrl = URL.createObjectURL(new Blob([bytes]));
        image.src = temporaryUrl;
      }
    } else {
      image.crossOrigin = 'anonymous';
      image.src = mediaUrl(path, options);
    }
    await image.decode();
    return image;
  } finally {
    if (temporaryUrl) URL.revokeObjectURL(temporaryUrl);
  }
}

/** Same, as an ImageBitmap — the right input for `texImage2D`. */
export async function loadBitmap(path: string, options: MediaOptions = { raw: true }): Promise<ImageBitmap> {
  const bridge = localIo();
  if (bridge?.url) return createImageBitmap(await loadImage(path, options));
  if (bridge) return createImageBitmap(new Blob([await loadBytes(path, options)]));
  const response = await fetch(mediaUrl(path, options));
  if (!response.ok) throw new Error(`cascade/io: cannot load ${path} (${response.status})`);
  return createImageBitmap(await response.blob());
}

/**
 * A .npy field (a mask, a signal, a height or density field) rendered to
 * greyscale, ready to upload as a texture. The numeric array itself stays on
 * the server side for now; this is the visual form of it.
 */
export async function loadFieldBitmap(path: string, options: MediaOptions = {}): Promise<ImageBitmap> {
  return loadBitmap(path, { ...options, raw: false });
}

export interface SaveOptions {
  /** 'png' (default), 'webp' or 'jpeg'. PNG is the default because the usual
   *  consumer of a node's output is another node, and a lossy intermediate
   *  compounds down a pipeline. Choose webp when the output is a preview. */
  format?: 'png' | 'webp' | 'jpeg';
  quality?: number;
}

/**
 * Anything that can produce encoded pixels. The two browser canvases are the
 * usual case; a headless host's canvas offers Skia's own encoder instead, and
 * `saveImage` takes whichever it is handed rather than making a node care.
 */
export interface ImageSource {
  convertToBlob?(options?: { type?: string; quality?: number }): Promise<Blob>;
  encode?(format: string, quality?: number): Promise<Uint8Array>;
  toBuffer?(mime: string): Uint8Array;
}

/**
 * Write pixels into the project and get back the path to hand downstream.
 * Confined to the cache directory, like every other node output.
 *
 *   const out = await saveImage(canvas, cachePath(node.id, '.png'));
 *   node.out('path').setValue(out);
 */
export async function saveImage(
  source: HTMLCanvasElement | OffscreenCanvas | Blob | ImageSource,
  path: string,
  options: SaveOptions = {}
): Promise<string> {
  const format = options.format ?? 'png';
  const type = `image/${format}`;
  let blob: Blob;

  if (source instanceof Blob) {
    blob = source;
  } else if (typeof (source as OffscreenCanvas).convertToBlob === 'function') {
    blob = await (source as OffscreenCanvas).convertToBlob({ type, quality: options.quality });
  } else if (typeof (source as ImageSource).encode === 'function') {
    // A headless canvas that was handed over unwrapped — Skia's own encoder,
    // rather than a browser API it does not have.
    blob = new Blob([(await (source as ImageSource).encode!(format, options.quality)) as BlobPart], { type });
  } else if (typeof (source as ImageSource).toBuffer === 'function') {
    blob = new Blob([(source as ImageSource).toBuffer!(type) as BlobPart], { type });
  } else {
    blob = await new Promise<Blob>((resolve, reject) => {
      (source as HTMLCanvasElement).toBlob(
        (result) => (result ? resolve(result) : reject(new Error('cascade/io: canvas produced no data'))),
        type,
        options.quality
      );
    });
  }

  return saveBytes(blob, path);
}

/** Write any bytes into the project cache and return the path. */
export async function saveBytes(data: Blob | ArrayBuffer | Uint8Array, path: string): Promise<string> {
  const clean = path.replace(/^\.?\//, '');
  const bridge = localIo();
  if (bridge) {
    const bytes = data instanceof Uint8Array
      ? data
      : new Uint8Array(data instanceof Blob ? await data.arrayBuffer() : data);
    return await bridge.write(clean, bytes);
  }
  const response = await fetch(`/api/media/${clean.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: data as BodyInit,
  });
  if (!response.ok) {
    throw new Error(`cascade/io: cannot write ${path} — ${await response.text()}`);
  }
  const result = await response.json();
  return result.path as string;
}

/**
 * The output path convention, shared with the Python side: scoped by node id so
 * one node's scratch file never lands on a sibling's. The server puts the cache
 * key into the filename when it writes, so different inputs keep separate files.
 */
export function cachePath(nodeId: string, suffix: string): string {
  const safe = nodeId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `.cascade-cache/${safe}${suffix}`;
}

// ---------------------------------------------------------------- float data

/**
 * Float pixel data, shared between Python and JavaScript with no conversion.
 *
 * This works because a `.npy` file holding little-endian float32 in C order IS
 * a Float32Array with a header in front of it. numpy pads that header so the
 * data begins on a 64-byte boundary — measured on this project's own files, it
 * starts at byte 128 every time — which means a typed array can be constructed
 * as a VIEW onto the fetched buffer rather than a copy of it. A 10 MB density
 * field costs one fetch and no marshalling.
 *
 * From there it goes straight where you need it: into `texImage2D` as an R32F
 * or RGBA32F texture, into a compute pass, or through `toImageData` for
 * Canvas2D. And `saveFloats` writes the same layout back, so `np.load` on the
 * Python side reads it as an ordinary array.
 */
export interface FloatImage {
  data: Float32Array;
  /** [width, height] */
  size: [number, number];
  /** 1 for a mask or signal, 3 for RGB, 4 for RGBA. */
  channels: number;
}

interface NpyHeader {
  dtype: string;
  shape: number[];
  dataOffset: number;
  fortran: boolean;
}

function parseNpyHeader(buffer: ArrayBuffer): NpyHeader {
  const bytes = new Uint8Array(buffer);
  const magic = String.fromCharCode(...bytes.subarray(0, 6));
  if (magic !== '\x93NUMPY') throw new Error('cascade/io: not a .npy file');

  const view = new DataView(buffer);
  const major = bytes[6];
  const headerLength = major >= 2 ? view.getUint32(8, true) : view.getUint16(8, true);
  const headerStart = major >= 2 ? 12 : 10;
  const header = String.fromCharCode(...bytes.subarray(headerStart, headerStart + headerLength));

  const dtype = header.match(/'descr':\s*'([^']+)'/)?.[1];
  if (!dtype) throw new Error('cascade/io: .npy header has no dtype');

  const shape = (header.match(/'shape':\s*\(([^)]*)\)/)?.[1] ?? '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .map(Number);

  return {
    dtype,
    shape,
    dataOffset: headerStart + headerLength,
    fortran: /'fortran_order':\s*True/.test(header),
  };
}

/**
 * Read a float image as a zero-copy Float32Array view. Non-float and
 * non-native-endian arrays are converted rather than refused, so a uint8 mask
 * still loads — it just costs a pass.
 */
export async function loadFloats(path: string): Promise<FloatImage> {
  const buffer = await loadBytes(path, { raw: true });
  const header = parseNpyHeader(buffer);

  if (header.fortran) throw new Error('cascade/io: Fortran-ordered .npy is not supported');
  if (header.shape.length < 2) throw new Error(`cascade/io: expected an image-shaped array, got ${header.shape.length}D`);

  const [height, width] = header.shape;
  const channels = header.shape.length > 2 ? header.shape.slice(2).reduce((a, b) => a * b, 1) : 1;
  const count = width * height * channels;

  let data: Float32Array;
  if (header.dtype === '<f4' || header.dtype === '=f4') {
    // The whole point: a view, not a copy.
    data = new Float32Array(buffer, header.dataOffset, count);
  } else {
    const source = readAs(buffer, header.dataOffset, header.dtype, count);
    data = source instanceof Float32Array ? source : Float32Array.from(source);
  }

  return { data, size: [width, height], channels };
}

function readAs(buffer: ArrayBuffer, offset: number, dtype: string, count: number): ArrayLike<number> {
  switch (dtype) {
    case '<f8': case '=f8': return new Float64Array(buffer, offset, count);
    case '|u1': case '<u1': case '=u1': case '|b1': return new Uint8Array(buffer, offset, count);
    case '|i1': return new Int8Array(buffer, offset, count);
    case '<i2': return new Int16Array(buffer, offset, count);
    case '<u2': return new Uint16Array(buffer, offset, count);
    case '<i4': return new Int32Array(buffer, offset, count);
    case '<u4': return new Uint32Array(buffer, offset, count);
    default: throw new Error(`cascade/io: .npy dtype ${dtype} is not supported`);
  }
}

/** Build the .npy container around raw float32 bytes, laid out exactly as
 *  numpy expects so `np.load` reads it with no special handling. */
function encodeNpy(data: Float32Array, shape: number[]): Uint8Array {
  const dict = `{'descr': '<f4', 'fortran_order': False, 'shape': (${shape.join(', ')}${shape.length === 1 ? ',' : ''}), }`;
  // numpy pads so magic + version + length + header is a multiple of 64, which
  // is what keeps the data 4-byte aligned for a zero-copy read on the way back.
  const unpadded = 10 + dict.length + 1;
  const padding = (64 - (unpadded % 64)) % 64;
  const header = dict + ' '.repeat(padding) + '\n';

  const out = new Uint8Array(10 + header.length + data.byteLength);
  const view = new DataView(out.buffer);
  out.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0], 0);   // \x93NUMPY v1.0
  view.setUint16(8, header.length, true);
  for (let i = 0; i < header.length; i++) out[10 + i] = header.charCodeAt(i);
  out.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), 10 + header.length);
  return out;
}

/** Write float pixels back into the project. Python reads the result with a
 *  plain `np.load`. Returns the stored path. */
export async function saveFloats(image: FloatImage, path: string): Promise<string> {
  const [width, height] = image.size;
  const shape = image.channels > 1 ? [height, width, image.channels] : [height, width];
  return saveBytes(encodeNpy(image.data, shape), path);
}

/**
 * Float pixels -> ImageData for Canvas2D. Values are assumed to be 0..1 unless
 * a range is given; pass the field's actual range to see it the way the viewer
 * does rather than clipped.
 */
export function toImageData(image: FloatImage, range: [number, number] = [0, 1]): ImageData {
  const [width, height] = image.size;
  const [low, high] = range;
  const span = high - low || 1;
  const out = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < width * height; i++) {
    const base = i * image.channels;
    const r = ((image.data[base] - low) / span) * 255;
    const g = image.channels > 1 ? ((image.data[base + 1] - low) / span) * 255 : r;
    const b = image.channels > 2 ? ((image.data[base + 2] - low) / span) * 255 : r;
    const a = image.channels > 3 ? image.data[base + 3] * 255 : 255;
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = a;
  }
  return new ImageData(out, width, height);
}

/**
 * Upload float pixels as a GPU texture, no conversion on the way. Needs the
 * EXT_color_buffer_float extension to render INTO one; sampling works without.
 */
export function uploadFloatTexture(gl: WebGL2RenderingContext, image: FloatImage): WebGLTexture {
  const [width, height] = image.size;
  const formats: Record<number, [number, number]> = {
    1: [gl.R32F, gl.RED],
    2: [gl.RG32F, gl.RG],
    3: [gl.RGB32F, gl.RGB],
    4: [gl.RGBA32F, gl.RGBA],
  };
  const pair = formats[image.channels];
  if (!pair) throw new Error(`cascade/io: ${image.channels} channels has no texture format`);
  const [internalFormat, format] = pair;

  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, gl.FLOAT, image.data);
  return texture;
}

// ------------------------------------------------------------------ textures

/**
 * A live GPU texture, passed between browser nodes.
 *
 * Separate from `image` on purpose, and the distinction is about cost rather
 * than taste. An `image` is file-backed: durable, portable, readable by Python,
 * and it costs a write and a read every time it is handed on. A `texture` never
 * leaves the page — a chain of WebGL nodes passes one along with no round trip
 * at all, which is what makes an interactive shader chain feel immediate.
 *
 * Because it is session-bound it cannot be cached, cannot be inspected after a
 * reload, and cannot be read by a Python stage. So the conversions are explicit:
 * `toImage` is a GPU readback and a file write, and it should be visible in the
 * graph rather than happening silently on a connection.
 */
export interface TextureRef {
  gl: WebGL2RenderingContext;
  texture: WebGLTexture;
  /** [width, height] */
  size: [number, number];
  channels: number;
  /** True when the texture holds float data rather than 8-bit. */
  float: boolean;
}

/** Upload an image file to the GPU. The integer path for `uploadFloatTexture`. */
export async function textureFromImage(
  gl: WebGL2RenderingContext,
  image: string | { path: string },
  options: MediaOptions = { raw: true }
): Promise<TextureRef> {
  const path = typeof image === 'string' ? image : image.path;

  if (path.endsWith('.npy')) {
    const floats = await loadFloats(path);
    return {
      gl,
      texture: uploadFloatTexture(gl, floats),
      size: floats.size,
      channels: floats.channels,
      float: true,
    };
  }

  const bitmap = await loadBitmap(path, options);
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
  const size: [number, number] = [bitmap.width, bitmap.height];
  bitmap.close();
  return { gl, texture, size, channels: 4, float: false };
}

/** Allocate an empty texture to render into. */
export function createTexture(
  gl: WebGL2RenderingContext,
  size: [number, number],
  options: { float?: boolean; channels?: number } = {}
): TextureRef {
  const [width, height] = size;
  const float = options.float ?? false;
  const channels = options.channels ?? 4;
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texStorage2D(gl.TEXTURE_2D, 1, float ? gl.RGBA32F : gl.RGBA8, width, height);
  return { gl, texture, size, channels, float };
}

/**
 * Read a texture back off the GPU and write it into the project as an image.
 * The one place a texture becomes durable — deliberately a named step, because
 * a readback stalls the pipeline and a write costs a file.
 */
export async function textureToImage(
  ref: TextureRef,
  path: string,
  options: { format?: 'png' | 'webp'; space?: 'srgb' | 'linear' } = {}
): Promise<ImageRef> {
  const { gl, size } = ref;
  const [width, height] = size;

  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, ref.texture, 0);

  try {
    if (ref.float) {
      const pixels = new Float32Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, pixels);
      const stored = await saveFloats({ data: pixels, size, channels: 4 }, path.replace(/\.[^.]+$/, '') + '.npy');
      return { path: stored, size, channels: 'rgba', depth: 'f32', space: options.space ?? 'linear' };
    }

    const pixels = new Uint8ClampedArray(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext('2d')!.putImageData(new ImageData(pixels, width, height), 0, 0);
    const format = options.format ?? 'png';
    const stored = await saveImage(canvas, path, { format });
    return { path: stored, size, channels: 'rgba', depth: 'u8', space: options.space ?? 'srgb' };
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(framebuffer);
  }
}

/** The value on an `image` port. Mirrors Cascade's core ImageRef. */
export interface ImageRef {
  path: string;
  size: [number, number];
  channels: 'r' | 'a' | 'rg' | 'rgb' | 'rgba';
  depth: 'u8' | 'u16' | 'f16' | 'f32';
  space: 'srgb' | 'linear';
}
