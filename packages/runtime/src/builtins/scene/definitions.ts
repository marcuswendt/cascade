import {
  type Camera,
  type Geometry,
  type Light,
  LIGHT_DEFAULTS,
  type NodeExecutionContext,
  type Scene,
  isCamera,
  isLight,
  isScene,
} from "@cascade/contracts";

import type { DefinitionNodeRegistration } from "../../types.js";

/**
 * The one place the scene built-in namespace is written down.
 *
 * `cascade.scene.*` rather than `cascade.geo.*`, and that is a real distinction
 * rather than tidiness: `cascade.geo` is a *medium* — points, primitives,
 * attributes, operations that take geometry and return geometry. A scene is not
 * geometry. It is an assembly of geometry with a viewpoint and lights, and it is
 * the thing you look at rather than the thing you make.
 *
 * The counter-argument, and it is the one this codebase has already accepted
 * once: a namespace with two nodes in it is a promise rather than a structure.
 * `PLAN viewport` says exactly that about `cascade.render.*`, and prefers
 * `cascade.geo.Render` for the render node on those grounds. The difference is
 * that this namespace has a **type** behind it — `scene`, in the core type list
 * — and a type is the thing a namespace is allowed to be named after.
 */
export const SCENE_NAMESPACE = "cascade.scene";

export function sceneModuleId(name: string): string {
  return `${SCENE_NAMESPACE}.${name}`;
}

/**
 * `cascade.scene.Scene` — geometry, a camera and lights, assembled.
 *
 * Marcus's design, 2026-09-09: *"a 'scene' root node with a variadic input …
 * a 'scene' node with a camera, lights and geometry attached becomes a '3d
 * scene'."*
 *
 * ## Why one variadic `any` input rather than three typed ones
 *
 * Three inputs — a variadic `geometry`, a single `camera`, a variadic `light` —
 * would be better typed, and the connection rules would then refuse a wrong
 * wire before the node ever ran. That is a real loss and it is taken
 * deliberately, because the gesture Marcus described is *attach things to it*,
 * and a single port is the difference between dropping a camera on the node and
 * hunting for which of three stacked ports accepts it. Houdini's own `/obj`
 * network works the same way: everything in it is in the scene by being there,
 * not by being wired to the right socket.
 *
 * What that costs is paid back at execute time rather than ignored. Every input
 * is classified, and **anything unclassifiable throws** naming the port and the
 * value's shape — the alternative is a scene that silently omits what you
 * attached, which is the failure mode this codebase keeps writing rules about.
 * Two cameras throw for the same reason: picking one is a guess, and a guess
 * about which way the camera is pointing is not recoverable by looking at the
 * result.
 *
 * A nested scene is flattened. That makes `Scene` associative — assembling two
 * sub-scenes gives the same result as assembling their contents — and it is
 * what lets a big graph build a scene in parts.
 */
export const sceneDefinition = {
  apiVersion: 1,
  label: "Scene",
  description:
    "Geometry, a camera and lights, assembled into a scene. Attach anything to the input.",
  icon: "Box",
  runsOn: "portable",
  inputs: {
    inputs: {
      kind: "data",
      type: "any",
      variadic: true,
      description:
        "Geometry, one camera, and lights, in any order. Scenes are flattened.",
    },
  },
  outputs: {
    scene: { kind: "data", type: "scene" },
  },
  props: {},
} as const;

export function executeScene(
  context: NodeExecutionContext<typeof sceneDefinition>,
): void {
  const geometry: Geometry[] = [];
  const lights: Light[] = [];
  let camera: Camera | null = null;
  let cameraFrom = -1;

  context.inputs.inputs.forEach((value, index) => {
    if (value === undefined || value === null) return;
    if (isScene(value)) {
      geometry.push(...value.geometry);
      lights.push(...value.lights);
      if (value.camera !== null) {
        if (camera !== null)
          throw new Error(
            `cascade.scene.Scene has two cameras, on inputs ${cameraFrom} and ${index}. A scene has one viewpoint; remove one or use a Switch to choose between them.`,
          );
        camera = value.camera;
        cameraFrom = index;
      }
      return;
    }
    if (isCamera(value)) {
      if (camera !== null)
        throw new Error(
          `cascade.scene.Scene has two cameras, on inputs ${cameraFrom} and ${index}. A scene has one viewpoint; remove one or use a Switch to choose between them.`,
        );
      camera = value;
      cameraFrom = index;
      return;
    }
    if (isLight(value)) {
      lights.push(value);
      return;
    }
    if (typeof value === "object" && (value as Geometry).kind === "geometry") {
      geometry.push(value as Geometry);
      return;
    }
    throw new Error(
      `cascade.scene.Scene input ${index} is not geometry, a camera, a light or a scene (received ${describe(value)}). A scene can only hold those.`,
    );
  });

  context.outputs.scene.set({ geometry, camera, lights });
}

function describe(value: unknown): string {
  if (Array.isArray(value)) return `an array of ${value.length}`;
  if (typeof value === "object" && value !== null) {
    const kind = (value as { kind?: unknown }).kind;
    return typeof kind === "string" ? `an object of kind "${kind}"` : "an object";
  }
  return `a ${typeof value}`;
}

/**
 * `cascade.scene.Light` — Houdini's `/obj/hlight`, as a node.
 *
 * **Nothing shades with these yet**, and that is stated in the description so
 * that a light which appears to do nothing is understood rather than reported
 * as broken. Every piece in the vault today is lines — `cloud-volumes` is a
 * volume, `particle-type` is trails, `cloud-plots` is marks — so there is no
 * surface to light, and inventing a shading model before something needs one is
 * how you get a shading model nobody wants.
 *
 * It exists now because `Scene` accepts lights now. A type that gains a field
 * later invalidates every serialized scene and every node that builds one; the
 * node is the cheap half of a decision already taken in the type.
 */
export const lightDefinition = {
  apiVersion: 1,
  label: "Light",
  description:
    "A light, following Houdini's /obj/hlight. Nothing shades with lights yet — the viewport draws wireframe and points.",
  icon: "Lightbulb",
  runsOn: "portable",
  inputs: {
    translate: {
      kind: "data",
      type: "vec3",
      default: [0, 0, 5],
      description: "World position. Ignored for a distant or ambient light.",
    },
    direction: {
      kind: "data",
      type: "vec3",
      default: [0, 0, -1],
      description: "Direction the light points. Used by distant and spot.",
    },
    color: {
      kind: "data",
      type: "color",
      default: [1, 1, 1, 1],
      description: "Houdini light_color.",
    },
    intensity: {
      kind: "data",
      type: "float",
      default: 1,
      min: 0,
      description: "Houdini light_intensity.",
    },
  },
  outputs: {
    light: { kind: "data", type: "light" },
  },
  props: {
    type: {
      type: "string",
      default: "point",
      label: "Light Type",
      control: "select",
      options: [
        { value: "point", label: "Point" },
        { value: "distant", label: "Distant - directional" },
        { value: "ambient", label: "Ambient" },
        { value: "spot", label: "Spot" },
      ],
      description: "Houdini light_type. Distant is what other renderers call directional.",
    },
    coneangle: {
      type: "float",
      default: 45,
      min: 0,
      max: 180,
      label: "Cone Angle",
      description: "Degrees. Spot only.",
    },
  },
} as const;

export function executeLight(
  context: NodeExecutionContext<typeof lightDefinition>,
): void {
  const type = context.props.type;
  context.outputs.light.set({
    type:
      type === "distant" || type === "ambient" || type === "spot"
        ? type
        : LIGHT_DEFAULTS.type,
    translate: context.inputs.translate ?? LIGHT_DEFAULTS.translate,
    direction: context.inputs.direction ?? LIGHT_DEFAULTS.direction,
    color: context.inputs.color ?? LIGHT_DEFAULTS.color,
    intensity: context.inputs.intensity ?? LIGHT_DEFAULTS.intensity,
    coneangle: context.props.coneangle,
  });
}

export const sceneRegistration = {
  kind: "definition-v1",
  moduleId: sceneModuleId("Scene"),
  definition: sceneDefinition,
  loadExecute: async () => executeScene,
} satisfies DefinitionNodeRegistration<typeof sceneDefinition>;

export const lightRegistration = {
  kind: "definition-v1",
  moduleId: sceneModuleId("Light"),
  definition: lightDefinition,
  loadExecute: async () => executeLight,
} satisfies DefinitionNodeRegistration<typeof lightDefinition>;

export const sceneNodeRegistrations: readonly DefinitionNodeRegistration[] =
  Object.freeze([sceneRegistration, lightRegistration]);

/** `[moduleId, definition]` pairs, for a host building a node palette. The same
 *  shape `geoNodeDefinitions` and `popNodeDefinitions` have. */
export const sceneNodeDefinitions = Object.freeze([
  [sceneModuleId("Scene"), sceneDefinition],
  [sceneModuleId("Light"), lightDefinition],
] as const);

export type { Scene };
