import type { Geometry } from '@cascade/contracts';
import { GeometryBuilder } from '@cascade/runtime';

import type { ViewState } from './viewCamera';

/**
 * The reference plane and the origin axes, built as geometry.
 *
 * Built as geometry rather than drawn with canvas calls, and that is the point:
 * the grid then goes through the same projection as the scene, so a grid line
 * and a geometry line at the same world position land on the same pixel. Drawn
 * separately they would agree only as long as two pieces of maths agreed, which
 * is the class of bug this whole plan exists to remove.
 *
 * It also means the grid honours perspective for free — the lines converge
 * because they are in the world, not because anything here knows about a
 * horizon.
 *
 * ## What Houdini does, and where this differs
 *
 * Houdini's reference plane is *"the default infinite XZ grid shown in the
 * viewer"* with +Y up. **Cascade's lies in XY**, and `PLAN viewport` carries
 * the argument: this vault's work is flat drawings, and a drawing laid out in
 * XZ would make the second component of a 2D position the depth axis rather
 * than the vertical screen axis — breaking the agreement with SVG, the plotter,
 * and every sketch already written. The cost is a grid plane that differs from
 * Houdini's; the alternative cost is worse.
 *
 * Houdini's *Grid Ruler* — "draw every ‹n›th grid line thicker" — is the
 * `RULER` constant. SideFX does not document the numeric default anywhere, so
 * the observed 1-unit spacing and every-5th ruler line are used and marked as
 * observed rather than asserted as Houdini's.
 */
const RULER = 5;

/** Grid lines each way from the origin. 40 is 80 lines a direction, which is
 *  where a 2D canvas starts to cost more than the grid is worth. */
const HALF_LINES = 40;

export interface GridColours {
  readonly line: readonly [number, number, number, number];
  readonly ruler: readonly [number, number, number, number];
  readonly axisX: readonly [number, number, number, number];
  readonly axisY: readonly [number, number, number, number];
  readonly axisZ: readonly [number, number, number, number];
}

/**
 * Axis colours.
 *
 * **Not documented by SideFX**: the research pass found no page stating the
 * mapping, so these are the observed X red / Y green / Z blue — which is also
 * the near-universal convention, and the one a Houdini user will read without
 * being told. Recorded as observed in `Houdini Scene View reference`.
 */
export const DEFAULT_GRID_COLOURS: GridColours = {
  line: [0.5, 0.5, 0.5, 0.16],
  ruler: [0.5, 0.5, 0.5, 0.3],
  axisX: [0.85, 0.3, 0.3, 0.75],
  axisY: [0.35, 0.8, 0.4, 0.75],
  axisZ: [0.35, 0.5, 0.9, 0.75],
};

/**
 * The spacing that keeps the grid readable at any zoom.
 *
 * A fixed 1-unit grid is either invisible or solid grey the moment you leave
 * the scale it was chosen for, and Cascade's work spans both millimetre-scale
 * type outlines and thousand-unit plots. So the spacing snaps to the power of
 * ten that puts grid lines roughly 40 pixels apart, which is what makes the
 * grid a measuring instrument rather than decoration.
 */
export function gridSpacing(worldPerPixel: number): number {
  const target = worldPerPixel * 40;
  if (!Number.isFinite(target) || target <= 0) return 1;
  return 10 ** Math.round(Math.log10(target));
}

/**
 * The reference plane, in the plane the view is closest to looking at.
 *
 * A grid in XY is invisible from Houdini's Top view — you are looking along it,
 * and it draws as a single line. So the plane follows the view: XY from the
 * front, XZ from the top, ZY from the side. Houdini solves the same problem
 * with a construction plane you place; following the view is the version that
 * needs no gesture, and the axis colours say which plane you are on.
 */
export function gridPlaneFor(view: ViewState): 'xy' | 'xz' | 'zy' {
  const pitch = Math.abs(view.pitch % 180);
  if (pitch > 60 && pitch < 120) return 'xz';
  const yaw = Math.abs(((view.yaw % 180) + 180) % 180);
  if (yaw > 60 && yaw < 120) return 'zy';
  return 'xy';
}

/**
 * Grid plus origin axes as one geometry, ready to draw before the scene.
 *
 * Per-primitive `Cd` and `width` carry the colours, which is the same style
 * vocabulary `SvgExport` and `Render` read — so the renderer needs no special
 * case for the grid, and a grid line cannot be styled by a path that geometry
 * lines do not have.
 */
export function gridGeometry(
  view: ViewState,
  worldPerPixel: number,
  colours: GridColours = DEFAULT_GRID_COLOURS,
): Geometry {
  const spacing = gridSpacing(worldPerPixel);
  const plane = gridPlaneFor(view);
  const extent = spacing * HALF_LINES;
  const builder = new GeometryBuilder({ positionSize: 3 });
  const cd: number[] = [];
  const widths: number[] = [];

  /** Place a point in the grid's plane: `u` across, `v` along. */
  const at = (u: number, v: number): [number, number, number] =>
    plane === 'xy' ? [u, v, 0] : plane === 'xz' ? [u, 0, v] : [0, v, u];

  const line = (
    from: [number, number, number],
    to: [number, number, number],
    colour: readonly [number, number, number, number],
    width: number,
  ) => {
    const a = builder.addPoint(...from);
    const b = builder.addPoint(...to);
    builder.addPrimitive([a, b], { closed: false, kind: 'poly' });
    cd.push(colour[0], colour[1], colour[2], colour[3]);
    widths.push(width);
  };

  for (let index = -HALF_LINES; index <= HALF_LINES; index += 1) {
    if (index === 0) continue; // The origin lines are the axes, drawn below.
    const offset = index * spacing;
    const ruled = index % RULER === 0;
    const colour = ruled ? colours.ruler : colours.line;
    const width = ruled ? 1.25 : 1;
    line(at(offset, -extent), at(offset, extent), colour, width);
    line(at(-extent, offset), at(extent, offset), colour, width);
  }

  // The three world axes, always all three — the one that is not in the grid's
  // plane is what tells you the plane you are on, and hiding it is how an
  // orthographic view becomes a view with no depth cue at all.
  line([-extent, 0, 0], [extent, 0, 0], colours.axisX, 1.5);
  line([0, -extent, 0], [0, extent, 0], colours.axisY, 1.5);
  line([0, 0, -extent], [0, 0, extent], colours.axisZ, 1.5);

  builder.setNumericAttribute('primitive', 'Cd', new Float32Array(cd), 4, 'f32');
  builder.setNumericAttribute('primitive', 'width', new Float32Array(widths), 1, 'f32');
  return builder.build();
}
