import {
  emptyGeometry,
  isStringAttribute,
  POSITION_ATTRIBUTE,
  type AnyAttribute,
  type Geometry,
} from "@cascade/contracts";

import {
  createAttribute,
  createStringAttribute,
  geometryError,
  getPosition,
  positionSize,
  readComponent,
  readElement,
  readString,
  setAttribute,
} from "./attributes.js";
import { groupIndices, groupMask } from "./groups.js";
import { transformMatrix } from "./matrix.js";
import { mergeGeometries } from "./merge.js";
import { transformGeometry } from "./transform.js";

/**
 * Copy to Points: one geometry instanced onto every point of another.
 *
 * This is the node a generative composition actually comes from, and it is the
 * second half of the argument for a generic attribute table. It is written
 * entirely as transform-then-merge over the existing operations, which is the
 * point: it invents no attribute handling of its own, so it composes with any
 * attribute a later node invents and cannot drop one it has never heard of.
 * Because a cubic Bézier is affine-invariant, it is also exactly right on a
 * curve without knowing that a curve is what it is copying.
 *
 * Houdini's conventions, followed rather than reinvented: `pscale` scales each
 * copy, `N` orients it, and the copies carry a `copynum` primitive attribute
 * recording which target point they came from.
 */
export interface CopyToPointsOptions {
  /** Restrict to a target point group. Houdini's "Target Group". */
  readonly targetGroup?: string;
  /**
   * Read `pscale` and `N` from the target points. Houdini's "Transform Using
   * Target Point Orientations", and the reason `N` is a direction rather than
   * an angle: it is the attribute a Scatter or a Resample already writes.
   */
  readonly useTargetOrientations?: boolean;
  /**
   * Carry the target's point attributes onto the points of each copy, where the
   * source does not already carry a name of its own. Source wins on a
   * collision, because the copy's own values describe the copy.
   */
  readonly transferTargetAttributes?: boolean;
  /** Primitive attribute recording the target point index; "" disables it. */
  readonly copyNumberAttribute?: string;
}

export function copyToPoints(
  source: Geometry,
  target: Geometry,
  options: CopyToPointsOptions = {},
): Geometry {
  const width = positionSize(source) === 3 ? 3 : 2;
  const selection =
    options.targetGroup === undefined || options.targetGroup === ""
      ? undefined
      : (groupMask(target, "point", options.targetGroup) ??
        geometryError(
          "missing-group",
          `point group ${options.targetGroup} is not present on the target`,
        ));
  const indices =
    selection === undefined
      ? range(target.pointCount)
      : groupIndices(selection);
  if (indices.length === 0 || source.pointCount === 0)
    return emptyGeometry(width);

  const orient = options.useTargetOrientations ?? true;
  const pscale = orient ? numeric(target, "pscale") : undefined;
  const normal = orient ? numeric(target, "N") : undefined;
  const copyNumber = options.copyNumberAttribute ?? "copynum";
  const transfer =
    (options.transferTargetAttributes ?? true)
      ? Object.keys(target.point).filter(
          (name) =>
            name !== POSITION_ATTRIBUTE &&
            !Object.prototype.hasOwnProperty.call(source.point, name),
        )
      : [];

  const copies: Geometry[] = [];
  for (const index of indices) {
    const position = getPosition(target, index);
    const scale = pscale === undefined ? 1 : readComponent(pscale, index);
    const rotate =
      normal === undefined
        ? 0
        : (Math.atan2(
            readComponent(normal, index, 1),
            readComponent(normal, index, 0),
          ) *
            180) /
          Math.PI;
    let copy = transformGeometry(
      source,
      transformMatrix({
        translate: [position[0], position[1]],
        rotate,
        scale: [scale, scale],
      }),
    );
    if (copyNumber !== "")
      copy = setAttribute(copy, "primitive", copyNumber, {
        storage: "i32",
        size: 1,
        data: new Int32Array(copy.primitiveCount).fill(index),
      });
    for (const name of transfer)
      copy = setAttribute(
        copy,
        "point",
        name,
        spread(target.point[name]!, index, copy.pointCount),
      );
    copies.push(copy);
  }
  return mergeGeometries(copies);
}

function range(count: number): number[] {
  const indices = new Array<number>(count);
  for (let index = 0; index < count; index += 1) indices[index] = index;
  return indices;
}

function numeric(geometry: Geometry, name: string) {
  const attribute = geometry.point[name];
  if (attribute === undefined || isStringAttribute(attribute)) return undefined;
  return attribute;
}

/** One element of a target attribute, repeated across a copy's points. */
function spread(
  attribute: AnyAttribute,
  index: number,
  count: number,
): AnyAttribute {
  if (isStringAttribute(attribute))
    return createStringAttribute(
      new Array<string>(count).fill(readString(attribute, index)),
    );
  return createAttribute(
    count,
    attribute.size,
    attribute.storage,
    readElement(attribute, index),
  );
}
