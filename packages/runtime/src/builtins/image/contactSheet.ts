import type { NodeExecutionContext } from "@cascade/contracts";

import type { contactSheetDefinition } from "./definitions.js";

/**
 * `cascade.image.ContactSheet` — several images as one labelled grid.
 *
 * The selection loop is a ladder of three to five options and a pick, and the
 * pick is made by looking at them side by side. So the sheet is a node rather
 * than a script beside the graph: a graph can end in one, and `cascade ladder`
 * lays out its variants with the same layout and drawing code below.
 *
 * `portable` with `assets`, like `cascade.geo.Render`: it reads each image
 * through the asset capability, decodes it with `createImageBitmap` and draws
 * on an `OffscreenCanvas`, which both hosts supply (the headless one through
 * @napi-rs/canvas). Its declaration is in `definitions.ts` with the rest of
 * the library, so Studio's first paint carries the literal and not this body.
 */

export interface ContactSheetOptions {
  readonly columns?: number;
  readonly gap?: number;
  readonly cellWidth?: number;
  readonly labels?: readonly string[];
  readonly labelSize?: number;
  /** RGBA, 0 to 1. */
  readonly background?: readonly number[];
  readonly labelColor?: readonly number[];
}

export interface SheetCell {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Top-left of the label line. */
  readonly labelX: number;
  readonly labelY: number;
}

export interface SheetLayout {
  readonly width: number;
  readonly height: number;
  readonly columns: number;
  readonly rows: number;
  readonly cell: readonly [number, number];
  readonly labelHeight: number;
  readonly cells: readonly SheetCell[];
}

/**
 * Where each image goes. By default every cell is as wide as the widest image
 * and as tall as the tallest, and images keep their size. With `cellWidth`,
 * cells are that wide and as tall as the tallest image needs at that width,
 * and each image is scaled to fit. Either way an image is centred in its cell
 * and never cropped, in whole pixels, so a sheet is the same bytes every run.
 */
export function contactSheetLayout(
  sizes: readonly (readonly [number, number])[],
  options: { columns?: number; gap?: number; cellWidth?: number; labelHeight?: number } = {},
): SheetLayout {
  const count = sizes.length;
  if (!count) throw new Error("cascade.image.ContactSheet needs at least one image");
  for (const [width, height] of sizes) {
    if (!(width > 0 && height > 0)) throw new Error(`cascade.image.ContactSheet: an image is ${width}x${height}`);
  }
  const gap = Math.max(0, Math.round(options.gap ?? 16));
  const columns = Math.min(count, options.columns && options.columns > 0 ? Math.round(options.columns) : Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / columns);
  const scaled = Boolean(options.cellWidth && options.cellWidth > 0);
  const cellWidth = scaled ? Math.round(options.cellWidth!) : Math.max(...sizes.map(([width]) => width));
  const cellHeight = scaled
    ? Math.max(...sizes.map(([width, height]) => Math.round((height * cellWidth) / width)))
    : Math.max(...sizes.map(([, height]) => height));
  const labelHeight = Math.max(0, Math.round(options.labelHeight ?? 0));
  const cells = sizes.map(([width, height], index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    // Native size unless a cell width was asked for; never cropped.
    const fit = Math.min(cellWidth / width, cellHeight / height);
    const scale = scaled ? fit : Math.min(1, fit);
    const drawnWidth = Math.max(1, Math.round(width * scale));
    const drawnHeight = Math.max(1, Math.round(height * scale));
    const left = gap + column * (cellWidth + gap);
    const top = gap + row * (cellHeight + labelHeight + gap);
    return {
      x: left + Math.floor((cellWidth - drawnWidth) / 2),
      y: top + Math.floor((cellHeight - drawnHeight) / 2),
      width: drawnWidth,
      height: drawnHeight,
      labelX: left,
      labelY: top + cellHeight,
    };
  });
  return {
    width: gap + columns * (cellWidth + gap),
    height: gap + rows * (cellHeight + labelHeight + gap),
    columns,
    rows,
    cell: [cellWidth, cellHeight],
    labelHeight,
    cells,
  };
}

interface Bitmap {
  readonly width: number;
  readonly height: number;
  close?(): void;
}

interface SheetContext {
  fillStyle: string;
  font: string;
  textBaseline: string;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: string;
  fillRect(x: number, y: number, width: number, height: number): void;
  drawImage(image: Bitmap, x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
}

interface SheetSurface {
  readonly width: number;
  readonly height: number;
  getContext(kind: "2d"): SheetContext | null;
  convertToBlob(options?: { type?: string }): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
}

/** The host's canvas, read here and nowhere else (see `cascade.geo.Render`). */
function host(): {
  surface: (width: number, height: number) => SheetSurface;
  decode: (bytes: Uint8Array) => Promise<Bitmap>;
} {
  const globals = globalThis as {
    OffscreenCanvas?: new (width: number, height: number) => SheetSurface;
    createImageBitmap?: (source: unknown) => Promise<Bitmap>;
    Blob?: new (parts: unknown[]) => unknown;
  };
  const Canvas = globals.OffscreenCanvas;
  const createBitmap = globals.createImageBitmap;
  if (!Canvas || !createBitmap || !globals.Blob) {
    throw new Error("cascade.image.ContactSheet needs OffscreenCanvas and createImageBitmap, which this host does not provide");
  }
  const BlobType = globals.Blob;
  return {
    surface: (width, height) => new Canvas(width, height),
    decode: (bytes) => createBitmap(new BlobType([bytes])),
  };
}

function css(colour: readonly number[] | undefined, fallback: readonly number[]): string {
  const [r = 0, g = 0, b = 0, a = 1] = colour ?? fallback;
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
}

/** Encoded images (PNG, JPEG, WebP) in, one PNG sheet out. */
export async function composeContactSheet(
  images: readonly Uint8Array[],
  options: ContactSheetOptions = {},
): Promise<{ bytes: Uint8Array; layout: SheetLayout }> {
  const canvas = host();
  const bitmaps: Bitmap[] = [];
  try {
    for (const bytes of images) bitmaps.push(await canvas.decode(bytes));
    const labels = options.labels ?? [];
    const labelSize = Math.round(options.labelSize ?? 14);
    const labelled = labels.some((label) => label.trim().length > 0);
    const layout = contactSheetLayout(bitmaps.map((bitmap) => [bitmap.width, bitmap.height] as const), {
      columns: options.columns,
      gap: options.gap,
      cellWidth: options.cellWidth,
      labelHeight: labelled ? Math.round(labelSize * 1.8) : 0,
    });
    const surface = canvas.surface(layout.width, layout.height);
    const context = surface.getContext("2d");
    if (!context) throw new Error("cascade.image.ContactSheet: no 2D context");
    context.fillStyle = css(options.background, [1, 1, 1, 1]);
    context.fillRect(0, 0, layout.width, layout.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    layout.cells.forEach((cell, index) => context.drawImage(bitmaps[index]!, cell.x, cell.y, cell.width, cell.height));
    if (labelled) {
      context.fillStyle = css(options.labelColor, [0.1, 0.1, 0.1, 1]);
      context.font = `${labelSize}px sans-serif`;
      context.textBaseline = "top";
      layout.cells.forEach((cell, index) => {
        const label = labels[index];
        if (label) context.fillText(label, cell.labelX, cell.labelY + Math.round((layout.labelHeight - labelSize) / 2), layout.cell[0]);
      });
    }
    const blob = await surface.convertToBlob({ type: "image/png" });
    return { bytes: new Uint8Array(await blob.arrayBuffer()), layout };
  } finally {
    for (const bitmap of bitmaps) bitmap.close?.();
  }
}

/** An image value or a path, as the asset reference to read it by. */
function imageReference(value: unknown): { path: string } | undefined {
  if (typeof value === "string" && value) return { path: value };
  const candidate = (value as { path?: unknown } | null | undefined)?.path;
  return typeof candidate === "string" && candidate ? { path: candidate } : undefined;
}

export async function executeContactSheet(
  context: NodeExecutionContext<typeof contactSheetDefinition>,
): Promise<void> {
  const { props } = context;
  const references = [...context.inputs.images, ...(context.inputs.list ?? [])]
    .map(imageReference)
    .filter((reference): reference is { path: string } => reference !== undefined);
  const bytes: Uint8Array[] = [];
  for (const reference of references) {
    bytes.push(await context.capabilities.assets.read(reference, { signal: context.signal }));
  }
  const { bytes: sheet, layout } = await composeContactSheet(bytes, {
    columns: props.columns,
    gap: props.gap,
    cellWidth: props.cellWidth,
    labels: props.labels ? props.labels.split("\n") : [],
    labelSize: props.labelSize,
    background: props.background as unknown as readonly number[],
    labelColor: props.labelColor as unknown as readonly number[],
  });
  const asset = await context.capabilities.assets.write(
    sheet,
    { mediaType: "image/png", suggestedName: props.filename },
    { signal: context.signal },
  );
  context.outputs.asset.set(asset);
  context.outputs.image.set({
    path: asset.path ?? props.filename,
    size: [layout.width, layout.height],
    channels: "rgba",
    depth: "u8",
    space: "srgb",
  });
}
