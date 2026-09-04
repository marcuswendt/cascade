import {
  POSITION_ATTRIBUTE,
  type Geometry,
  type Mat3,
  type Mat4,
} from "@cascade/contracts";

import {
  attributeSet,
  copyAttributeArray,
  geometryError,
  positionAttribute,
  withAttributeSet,
} from "./attributes.js";

/**
 * Transform `P`. Matrices are column-major, as the `mat3` and `mat4` types are
 * already documented to be, so a `mat3`'s third column carries the 2D
 * translation.
 *
 * Geometry is authored +Y up. The flip into SVG's and Canvas's +Y-down frame
 * belongs in the export and render operations, once, and never here: a flip
 * applied per operation is the version that produces a drawing which is right
 * until something rotates.
 *
 * A `mat3` moves x and y and leaves a third position component alone, which is
 * what 2D work wants on a 3-component `P`. A `mat4` moves all three, treating a
 * 2-component `P` as z = 0 and discarding the resulting z, because widening `P`
 * is a declaration and not a side effect of a transform.
 */
export function transformGeometry(
  geometry: Geometry,
  matrix: Mat3 | Mat4,
): Geometry {
  if (matrix.length !== 9 && matrix.length !== 16)
    geometryError("matrix", "transform needs a mat3 or a mat4");
  if (!matrix.every(Number.isFinite))
    geometryError("matrix", "transform matrix values must be finite");
  if (geometry.pointCount === 0) return geometry;
  const position = positionAttribute(geometry);
  const size = position.size;
  const data = copyAttributeArray(position);
  if (matrix.length === 9) {
    const m = matrix as Mat3;
    for (let point = 0; point < geometry.pointCount; point += 1) {
      const base = point * size;
      const x = data[base];
      const y = data[base + 1];
      data[base] = m[0] * x + m[3] * y + m[6];
      data[base + 1] = m[1] * x + m[4] * y + m[7];
    }
  } else {
    const m = matrix as Mat4;
    for (let point = 0; point < geometry.pointCount; point += 1) {
      const base = point * size;
      const x = data[base];
      const y = data[base + 1];
      const z = size === 3 ? data[base + 2] : 0;
      data[base] = m[0] * x + m[4] * y + m[8] * z + m[12];
      data[base + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      if (size === 3)
        data[base + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    }
  }
  return withAttributeSet(geometry, "point", {
    ...attributeSet(geometry, "point"),
    [POSITION_ATTRIBUTE]: { storage: position.storage, size, data },
  });
}
