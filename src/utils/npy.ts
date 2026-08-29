/**
 * Minimal .npy reader for the editor.
 *
 * The pipeline passes anything large by file rather than through JSON — a
 * density field, a set of stipple points — and `.npy` is the container, because
 * it is what numpy writes and reads with no conversion at either end. The
 * editor needs to read those too, to draw a preview of what a stage produced.
 *
 * Format: magic `\x93NUMPY`, a version, a header length, then a Python-dict
 * header giving dtype, order and shape. numpy pads that header so the data
 * begins on a 64-byte boundary, which is what allows a typed array to be a VIEW
 * onto the buffer rather than a copy of it.
 */
export interface NpyArray {
  /** Flattened, in C order. */
  data: Float64Array | Float32Array;
  shape: number[];
  dtype: string;
}

export function readNpy(buffer: ArrayBuffer): NpyArray {
  const bytes = new Uint8Array(buffer);
  const magic = String.fromCharCode(...bytes.subarray(0, 6));
  if (magic !== '\x93NUMPY') throw new Error('not a .npy file');

  const view = new DataView(buffer);
  const major = bytes[6];
  const headerLength = major >= 2 ? view.getUint32(8, true) : view.getUint16(8, true);
  const headerStart = major >= 2 ? 12 : 10;
  const header = String.fromCharCode(...bytes.subarray(headerStart, headerStart + headerLength));

  const dtype = header.match(/'descr':\s*'([^']+)'/)?.[1];
  if (!dtype) throw new Error('.npy header has no dtype');
  if (/'fortran_order':\s*True/.test(header)) throw new Error('Fortran-ordered .npy is not supported');

  const shape = (header.match(/'shape':\s*\(([^)]*)\)/)?.[1] ?? '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .map(Number);

  const offset = headerStart + headerLength;
  const count = shape.reduce((a, b) => a * b, 1);

  // float32 is the common case and needs no copy at all.
  if (dtype === '<f4' || dtype === '=f4') {
    return { data: new Float32Array(buffer, offset, count), shape, dtype };
  }

  const source = ((): ArrayLike<number> => {
    switch (dtype) {
      case '<f8': case '=f8': return new Float64Array(buffer, offset, count);
      case '|u1': case '<u1': case '=u1': case '|b1': return new Uint8Array(buffer, offset, count);
      case '|i1': return new Int8Array(buffer, offset, count);
      case '<i2': return new Int16Array(buffer, offset, count);
      case '<u2': return new Uint16Array(buffer, offset, count);
      case '<i4': return new Int32Array(buffer, offset, count);
      case '<u4': return new Uint32Array(buffer, offset, count);
      default: throw new Error(`.npy dtype ${dtype} is not supported`);
    }
  })();

  return { data: source instanceof Float64Array ? source : Float64Array.from(source), shape, dtype };
}
