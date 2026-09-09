<script lang="ts">
  /**
   * The Viewer's 3D mode — Cascade's Scene View.
   *
   * Marcus's correction, 2026-09-09: *"I want any node that produces geometry
   * (or svg as a variant of that) to display as a 3D viewport in the viewer
   * panel. My reference is the standard Houdini 3D viewport, with it's XYZ
   * axis, zx plane grid, optional camera toggle, etc."*
   *
   * So this is a **mode of the Viewer**, not a panel beside it. There is no
   * scene in Cascade to look at independently — there is the output of the
   * selected node, and when that output is geometry the right way to look at it
   * is in three dimensions. The Viewer already switches between five modes by
   * output type; this is the sixth.
   *
   * ## What it draws with, and why that is the same code as the render node
   *
   * `renderScene` from `@cascade/runtime/render` — the same function
   * `cascade.geo.Render` calls, given this canvas as its surface instead of an
   * `OffscreenCanvas`. Not a similar drawing routine: the same one. That is
   * what makes it impossible for the viewport and the PNG to frame a graph two
   * ways, which was the most likely thing to ship wrong here.
   *
   * The grid goes through it too, as geometry, so a grid line and a geometry
   * line at one world position land on one pixel.
   *
   * ## It must never cook
   *
   * The camera moving is not an invalidation. This session has already been
   * bitten by a viewport loop that cooked: `CookStatus.pass` exists because a
   * livelock read identically to a slow cook, and the Viewer's own pump was
   * re-running a failing node ten times a second. So this draws whatever the
   * last cook produced, redraws on camera change, and asks for nothing.
   */
  import { onMount, onDestroy } from 'svelte';

  import type { Geometry, Scene } from '@cascade/contracts';
  import { asScene } from '@cascade/contracts';
  import { renderScene } from '@cascade/runtime/render';
  import { sceneBounds, sceneDimensionality } from '@cascade/runtime/scene';

  import { DEFAULT_GRID_COLOURS, gridGeometry, gridPlaneFor } from './grid';
  import {
    type StandardView,
    type ViewState,
    defaultView,
    dolly,
    frameBounds,
    standardView,
    toggleProjection,
    track,
    tumble,
    viewCameraFor,
    worldPerPixel,
    zoomLens,
  } from './viewCamera';
  import { loadView, saveView, viewKey } from './viewMemory';

  /** The value on the selected port: a scene, or a geometry to be promoted. */
  export let value: unknown = null;
  /** Advances on every cook of the displayed node. The redraw trigger. */
  export let version = 0;
  export let projectId: string | null = null;
  export let nodeId: string | null = null;
  export let portId: string | null = null;
  /** Off for a headless or GPU-less host; the Viewer falls back to the raster. */
  export let showGrid = true;

  let canvas: HTMLCanvasElement;
  let host: HTMLDivElement;
  let view: ViewState = defaultView(true);
  let scene: Scene = asScene(null);
  let pixelSize: [number, number] = [1, 1];
  let statusLine = '';
  let itemNote = '';

  /**
   * The cap, and it is said out loud rather than silently obeyed.
   *
   * `PLAN viewport` names this as the risk that will bite: the existing raster
   * path truncates at 100,000 items without saying so, and `particle-type`
   * already emits about 2,500 polylines with a dense piece well past the cap.
   * A viewport that quietly draws less is worse than a slow one, so the count
   * that was dropped is reported in the corner.
   */
  const ITEM_CAP = 100_000;

  let currentKey: string | null = null;

  /**
   * Load-or-detect, in that order, and only when the node or port changes.
   *
   * The order is the whole mechanism. A remembered view wins, so a camera you
   * placed survives every recook, tab switch and reselect. Only a node with no
   * remembered view is measured, and `sceneDimensionality` therefore runs once
   * per node rather than once per cook — which is what stops a simulation that
   * gains depth at frame 20 from flipping the viewport underneath you.
   */
  function adoptView(next: Scene): void {
    const key = viewKey(projectId, nodeId, portId);
    if (key === currentKey) return;
    currentKey = key;
    const remembered = loadView(key);
    if (remembered) {
      view = remembered;
      return;
    }
    const { is2d } = sceneDimensionality(next);
    view = frameBounds(defaultView(is2d), boundsOf(next), pixelSize, { rotate: true });
  }

  function boundsOf(next: Scene) {
    const bounds = sceneBounds(next);
    if (!bounds) return undefined;
    return {
      min: [bounds.min[0] ?? 0, bounds.min[1] ?? 0, bounds.min[2] ?? 0] as const,
      max: [bounds.max[0] ?? 0, bounds.max[1] ?? 0, bounds.max[2] ?? 0] as const,
    };
  }

  $: {
    scene = asScene(value);
    // `version` is read so the dependency is a real one: a cook is the evidence
    // the value may have changed, and an object identity check is not enough
    // when a node mutates a cached geometry in place.
    void version;
    adoptView(scene);
    queueDraw();
  }

  /**
   * A wired camera locks the view, which is Houdini's behaviour and Marcus's
   * choice — *"yes to copying the Houdini camera"*.
   *
   * Unwired, you fly around freely. Wire a `cascade.core.Camera` into the scene
   * and the viewport shows exactly what that camera sees, because otherwise the
   * two cameras in play disagree and the viewport is lying about the render.
   * Navigation writing back into the camera's parameters is the next step and
   * is not here yet, so while locked the gestures are refused rather than
   * silently ignored — the corner says which.
   */
  $: locked = scene.camera !== null;

  let frame = 0;
  function queueDraw(): void {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      draw();
    });
  }

  function measure(): void {
    if (!host || !canvas) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(host.clientWidth * ratio));
    const height = Math.max(1, Math.round(host.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    pixelSize = [width, height];
  }

  function draw(): void {
    if (!canvas) return;
    measure();
    const camera = locked && scene.camera ? { ...scene.camera, resolution: pixelSize } : viewCameraFor(view, pixelSize);
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);

    let items = 0;
    for (const geometry of scene.geometry) items += geometry.primitiveCount;
    const drawn: Geometry[] = [];
    let dropped = 0;
    let budget = ITEM_CAP;
    for (const geometry of scene.geometry) {
      if (budget <= 0) {
        dropped += geometry.primitiveCount;
        continue;
      }
      drawn.push(geometry);
      budget -= geometry.primitiveCount;
    }

    const perPixel = worldPerPixel(view, pixelSize);
    const layers = showGrid
      ? [gridGeometry(view, perPixel, DEFAULT_GRID_COLOURS), ...drawn]
      : drawn;

    // The existing canvas as the surface. `renderScene` only ever asks the
    // factory for one, so handing back the same element is the whole
    // integration — no second renderer, no second projection.
    renderScene(layers, {
      camera,
      size: pixelSize,
      stroke: [0.85, 0.87, 0.9, 1],
      strokeWidth: 1,
      opacity: 1,
      pointRadius: 1.5,
      drawPoints: true,
      surface: (() => canvas as unknown as never) as never,
    });

    drawGnomon(context, camera);

    const plane = gridPlaneFor(view).toUpperCase();
    statusLine = locked
      ? `camera · ${camera.focal.toFixed(0)}mm`
      : `${view.ortho ? 'ortho' : 'persp'} · ${plane} grid · ${formatSpacing(perPixel)}`;
    itemNote =
      dropped > 0
        ? `${(items - dropped).toLocaleString()} of ${items.toLocaleString()} primitives — ${dropped.toLocaleString()} not drawn`
        : `${items.toLocaleString()} primitives`;
  }

  function formatSpacing(perPixel: number): string {
    const spacing = 10 ** Math.round(Math.log10(perPixel * 40));
    return spacing >= 1 ? `${spacing} / square` : `${spacing.toPrecision(1)} / square`;
  }

  /**
   * The floating gnomon, bottom-left, the way Houdini draws one.
   *
   * Screen space rather than world space, so it never scales or leaves the
   * frame. It is also the answer to the one real risk of an orthographic
   * default: a flat view hides Z, and the gnomon is what tells you the axis is
   * there before you tumble and discover it.
   */
  function drawGnomon(context: CanvasRenderingContext2D, camera: any): void {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const size = 26 * ratio;
    const x = 18 * ratio + size;
    const y = canvas.height - 18 * ratio - size;
    const axes: [readonly [number, number, number], string, string][] = [
      [[1, 0, 0], 'rgba(217,77,77,0.95)', 'X'],
      [[0, 1, 0], 'rgba(89,204,102,0.95)', 'Y'],
      [[0, 0, 1], 'rgba(89,128,230,0.95)', 'Z'],
    ];
    // Direction only: the axis is projected as a difference of two points so
    // the gnomon shows orientation without inheriting the scene's scale.
    const yaw = ((camera.rotate?.[1] ?? 0) * Math.PI) / 180;
    const pitch = ((camera.rotate?.[0] ?? 0) * Math.PI) / 180;
    context.save();
    context.lineWidth = 1.5 * ratio;
    context.font = `${10 * ratio}px ui-sans-serif, system-ui, sans-serif`;
    for (const [axis, colour, label] of axes) {
      // The same basis the projection uses, reduced to two dimensions: right
      // and up dotted with the axis.
      const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
      const up = [
        Math.sin(yaw) * Math.sin(pitch),
        Math.cos(pitch),
        Math.cos(yaw) * Math.sin(pitch),
      ];
      const sx = axis[0] * right[0] + axis[1] * right[1] + axis[2] * right[2];
      const sy = axis[0] * up[0] + axis[1] * up[1] + axis[2] * up[2];
      context.strokeStyle = colour;
      context.fillStyle = colour;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + sx * size, y - sy * size);
      context.stroke();
      context.fillText(label, x + sx * (size + 6 * ratio) - 3 * ratio, y - sy * (size + 6 * ratio) + 3 * ratio);
    }
    context.restore();
  }

  // ------------------------------------------------------------- interaction

  /**
   * Houdini's own bindings, with one addition.
   *
   * Hold `Space` and drag: LMB tumbles, MMB tracks, RMB dollies. The wheel
   * dollies with no modifier, because a wheel that does nothing in a 3D view is
   * the first thing anybody tries. `Alt` is accepted alongside `Space` — a
   * Houdini preference (*Allow Alt as View Key*) that is on by default, and what
   * Maya and Blender users reach for.
   *
   * The addition: **with no modifier, LMB tracks and drag-tumbles only in 3D.**
   * Houdini's unmodified LMB is selection, and there is nothing to select here
   * yet, so leaving it inert would make a viewport that appears broken to
   * anybody who has not read this.
   */
  let spaceHeld = false;
  let dragging: 'tumble' | 'track' | 'dolly' | 'zoom' | null = null;
  let last: [number, number] = [0, 0];

  function viewKeyHeld(event: MouseEvent | WheelEvent): boolean {
    return spaceHeld || event.altKey;
  }

  function onPointerDown(event: PointerEvent): void {
    if (locked) return;
    const held = viewKeyHeld(event);
    if (held && event.ctrlKey) dragging = event.button === 2 ? 'zoom' : 'tumble';
    else if (held) dragging = event.button === 1 ? 'track' : event.button === 2 ? 'dolly' : 'tumble';
    else dragging = event.button === 1 || event.shiftKey ? 'track' : view.ortho ? 'track' : 'tumble';
    last = [event.clientX, event.clientY];
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function onPointerMove(event: PointerEvent): void {
    if (!dragging) return;
    const dx = event.clientX - last[0];
    const dy = event.clientY - last[1];
    last = [event.clientX, event.clientY];
    // Houdini's precision modifier. Shift is also the no-modifier track
    // shortcut above, which is why it is read per-gesture rather than at start.
    const scale = event.shiftKey && dragging !== 'track' ? 0.25 : 1;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    if (dragging === 'tumble') view = tumble(view, dx * scale, dy * scale);
    else if (dragging === 'track') view = track(view, dx * ratio, dy * ratio, pixelSize);
    else if (dragging === 'dolly') view = dolly(view, dy * 0.15 * scale);
    else view = zoomLens(view, -dy * 0.15 * scale);
    queueDraw();
  }

  function onPointerUp(event: PointerEvent): void {
    if (!dragging) return;
    dragging = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    saveView(currentKey, view);
  }

  function onWheel(event: WheelEvent): void {
    if (locked) return;
    event.preventDefault();
    // A trackpad reports fractional deltas in the tens; a wheel reports around
    // 100 a notch. Normalising to notches keeps one gesture speed for both.
    const notches = -event.deltaY / 100;
    view = viewKeyHeld(event) && event.ctrlKey ? zoomLens(view, notches) : dolly(view, notches);
    queueDraw();
    saveView(currentKey, view);
  }

  /**
   * Framing and view keys.
   *
   * `Space`+`F` frames without rotating and `Space`+`G` is allowed to rotate —
   * Houdini's own split, and worth copying because it is the difference between
   * *"show me this"* and *"show me this from the usual place"*. `Home` and
   * `Space`+`H` reset. `Space`+`1`…`4` are the standard views, `Space`+`O`
   * toggles orthographic.
   *
   * The keys are handled on the element rather than the window: a viewport that
   * swallows `1` while you are typing in a parameter field is worse than one
   * with no shortcuts.
   */
  function onKeyDown(event: KeyboardEvent): void {
    if (event.code === 'Space') {
      spaceHeld = true;
      event.preventDefault();
      return;
    }
    if (locked) return;
    const key = event.key.toLowerCase();
    const views: Record<string, StandardView> = {
      '1': 'perspective',
      '2': 'top',
      '3': 'front',
      '4': 'side',
    };
    if (views[key]) view = standardView(view, views[key]);
    else if (key === 'o') view = toggleProjection(view);
    else if (key === 'f') view = frameBounds(view, boundsOf(scene), pixelSize);
    else if (key === 'g') view = frameBounds(view, boundsOf(scene), pixelSize, { rotate: true });
    else if (key === 'h' || event.key === 'Home')
      view = frameBounds(defaultView(view.ortho), boundsOf(scene), pixelSize, { rotate: true });
    else if (key === 'd') showGrid = !showGrid;
    else return;
    event.preventDefault();
    queueDraw();
    saveView(currentKey, view);
  }

  function onKeyUp(event: KeyboardEvent): void {
    if (event.code === 'Space') spaceHeld = false;
  }

  let observer: ResizeObserver | undefined;
  onMount(() => {
    measure();
    observer = new ResizeObserver(() => queueDraw());
    observer.observe(host);
    queueDraw();
  });
  onDestroy(() => {
    observer?.disconnect();
    if (frame) cancelAnimationFrame(frame);
    saveView(currentKey, view);
  });
</script>

<div
  class="viewport"
  bind:this={host}
  role="application"
  aria-label="3D scene view"
  tabindex="0"
  on:keydown={onKeyDown}
  on:keyup={onKeyUp}
>
  <canvas
    bind:this={canvas}
    on:pointerdown={onPointerDown}
    on:pointermove={onPointerMove}
    on:pointerup={onPointerUp}
    on:pointercancel={onPointerUp}
    on:wheel={onWheel}
    on:contextmenu|preventDefault
  ></canvas>
  <div class="hud">
    <span>{statusLine}</span>
    <span class="items">{itemNote}</span>
  </div>
  {#if locked}
    <div class="locked">camera locked — unwire the Camera to navigate</div>
  {/if}
</div>

<style>
  .viewport {
    position: relative;
    width: 100%;
    height: 100%;
    outline: none;
    background: var(--bg-canvas, #16181c);
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
    cursor: grab;
  }
  .hud {
    position: absolute;
    left: 8px;
    top: 8px;
    display: flex;
    gap: 10px;
    font-size: 11px;
    color: var(--text-tertiary);
    background: var(--shade-strong, rgba(0, 0, 0, 0.45));
    padding: 3px 8px;
    border-radius: 4px;
    pointer-events: none;
  }
  .items {
    opacity: 0.75;
  }
  .locked {
    position: absolute;
    right: 8px;
    top: 8px;
    font-size: 11px;
    color: var(--text-tertiary);
    background: var(--shade-strong, rgba(0, 0, 0, 0.45));
    padding: 3px 8px;
    border-radius: 4px;
    pointer-events: none;
  }
</style>
