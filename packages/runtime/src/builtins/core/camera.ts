import { CAMERA_DEFAULTS, type Camera, type NodeDefinition, type NodeExecutionContext, type Vec3 } from "@cascade/contracts";

import { lookAtRotation } from "../../camera/index.js";
import type { DefinitionNodeRegistration } from "../../types.js";

/**
 * `cascade.core.Camera` — Houdini's `/obj/cam`, as a node.
 *
 * Marcus, 2026-09-08: *"I think it just requires a camera. camera should be a
 * core node."* So a renderer takes a camera on a port rather than carrying its
 * own copy of the same eight parameters, which is what `volume-render` was
 * doing.
 *
 * The split between inputs and props is the usual one and it matters here:
 * **what a camera move animates is an input** — position, orientation, the
 * look-at target, the lens — and **what defines the frame is a prop**, because
 * clipping planes, resolution and projection are set once and left. `focal` is
 * an input for exactly this reason: a focus pull is a camera move.
 */
export const cameraDefinition = {
  apiVersion: 1,
  label: "Camera",
  description: "A camera, following Houdini's /obj/cam.",
  icon: "Video",
  runsOn: "portable",
  inputs: {
    translate: {
      kind: "data",
      type: "vec3",
      default: [0, 0, 5],
      description: "World position.",
    },
    rotate: {
      kind: "data",
      type: "vec3",
      default: [0, 0, 0],
      description: "Degrees, XYZ order. The camera looks down its own -Z.",
    },
    focal: {
      kind: "data",
      type: "float",
      default: 50,
      min: 1,
      max: 300,
      description: "Focal length in millimetres.",
    },
    lookat: {
      kind: "data",
      type: "vec3",
      default: [0, 0, 0],
      description: "Point to aim at. Used only when Look At is on, and it replaces Rotate.",
    },
    up: {
      kind: "data",
      type: "vec3",
      default: [0, 1, 0],
      description: "Up vector for Look At.",
    },
    spin: {
      kind: "data",
      type: "float",
      default: 0,
      description: "Degrees added to the Y rotation, after Look At. For turntables.",
    },
  },
  outputs: {
    camera: { kind: "data", type: "camera" },
  },
  props: {
    lookAt: {
      type: "bool",
      default: false,
      label: "Look At",
      description: "Aim at the Look At point instead of using Rotate.",
    },
    aperture: {
      type: "float",
      default: 41.4214,
      min: 1,
      max: 200,
      label: "Aperture",
      description: "Horizontal aperture in millimetres. With the default focal length this is a 45 degree view.",
    },
    resolution: {
      type: "vec2i",
      default: [1280, 720],
      label: "Resolution",
      description: "Frame size in pixels. The vertical field of view is derived from this.",
    },
    aspect: {
      type: "float",
      default: 1,
      min: 0.1,
      max: 10,
      label: "Pixel Aspect",
      description: "The aspect of one pixel, not of the frame.",
    },
    projection: {
      type: "string",
      default: "perspective",
      label: "Projection",
      control: "select",
      options: [
        { value: "perspective", label: "Perspective" },
        { value: "orthographic", label: "Orthographic" },
      ],
    },
    orthowidth: {
      type: "float",
      default: 2,
      min: 0.01,
      label: "Ortho Width",
      description: "Width of the orthographic frame in world units.",
    },
    near: { type: "float", default: 0.001, min: 0, label: "Near Clip" },
    far: { type: "float", default: 10000, min: 0, label: "Far Clip" },
  },
} as const satisfies NodeDefinition;

export function executeCamera(
  context: NodeExecutionContext<typeof cameraDefinition>,
): void {
  const { translate, rotate, focal, lookat, up, spin } = context.inputs;
  const props = context.props;

  const aimed = props.lookAt
    ? lookAtRotation(translate as Vec3, lookat as Vec3, up as Vec3)
    : (rotate as Vec3);

  // Spin is applied after look-at rather than folded into it, so a turntable
  // keeps pointing at its subject while it goes round. Degrees, because
  // `rotate` is degrees and adding a different unit to it would be a trap.
  const oriented: Vec3 = spin === 0
    ? aimed
    : [aimed[0], aimed[1] + spin, aimed[2]];

  const camera: Camera = {
    ...CAMERA_DEFAULTS,
    translate: translate as Vec3,
    rotate: oriented,
    focal,
    aperture: props.aperture,
    resolution: props.resolution,
    aspect: props.aspect,
    projection: props.projection === "orthographic" ? "orthographic" : "perspective",
    orthowidth: props.orthowidth,
    near: props.near,
    far: props.far,
  };

  context.outputs.camera.set(camera);
}

export const cameraRegistration = {
  kind: "definition-v1",
  moduleId: "cascade.core.Camera",
  definition: cameraDefinition,
  loadExecute: async () => executeCamera,
} satisfies DefinitionNodeRegistration<typeof cameraDefinition>;
