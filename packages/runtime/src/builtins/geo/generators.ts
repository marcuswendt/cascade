import type { NodeDefinition, NodeExecutionContext } from "@cascade/contracts";

import { circleGeometry, rectangleGeometry } from "../../geometry/generate.js";
import type { DefinitionNodeRegistration } from "../../types.js";
import { geoModuleId } from "./namespace.js";

/**
 * The two generators. Houdini has no Rectangle and its Grid with two rows does
 * the job, so `size` and `center` are Grid's parameter names; `Circle` takes
 * Houdini's Circle parameters, including its "Primitive Type", which is what
 * selects a Bézier circle over a polygonal one.
 *
 * Numeric parameters are data inputs rather than props, so a graph can drive
 * them, which is the Cascade equivalent of a Houdini parameter being animatable.
 * The enumerated choice is a prop, as `Remap`'s `clamp` is.
 */
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
  outputs: {
    geometry: { kind: "data", type: "geometry" },
  },
} as const satisfies NodeDefinition;

export function executeRectangle(
  context: NodeExecutionContext<typeof rectangleDefinition>,
): void {
  context.outputs.geometry.set(
    rectangleGeometry({
      size: context.inputs.size,
      center: context.inputs.center,
    }),
  );
}

export const rectangleRegistration = {
  kind: "definition-v1",
  moduleId: geoModuleId("Rectangle"),
  definition: rectangleDefinition,
  loadExecute: async () => executeRectangle,
} satisfies DefinitionNodeRegistration<typeof rectangleDefinition>;

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
  outputs: {
    geometry: { kind: "data", type: "geometry" },
  },
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

export function executeCircle(
  context: NodeExecutionContext<typeof circleDefinition>,
): void {
  context.outputs.geometry.set(
    circleGeometry({
      center: context.inputs.center,
      radius: context.inputs.radius,
      divisions: context.inputs.divisions,
      type: context.props.type === "poly" ? "poly" : "bezier",
    }),
  );
}

export const circleRegistration = {
  kind: "definition-v1",
  moduleId: geoModuleId("Circle"),
  definition: circleDefinition,
  loadExecute: async () => executeCircle,
} satisfies DefinitionNodeRegistration<typeof circleDefinition>;
