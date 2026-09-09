import {
  CAMERA_DEFAULTS,
  isScene,
  sceneFromGeometry,
  type AssetRef,
  type Camera,
  type CascadeDocument,
  type Geometry,
  type ImageRef,
  type Scene,
} from '../../packages/contracts/src/index.js';
import { createBrowserRuntimeHost } from '../../packages/runtime/src/browser.js';
import { renderScene, type DrawingSurface } from '../../packages/runtime/src/geometry/render.js';
import { createRuntime, PREFLIGHT_WARNING_CODES } from '../../packages/runtime/src/runtime.js';
import { sceneBounds } from '../../packages/runtime/src/scene/index.js';
import type {
  DefinitionNodeRegistration,
  LoadedCascadeGraph,
  RunResult,
} from '../../packages/runtime/src/types.js';
import { installIoBridge } from '../../server/src/runtime/io.js';
import { createBrowserGpuHost } from '../browser/gpu.js';
import { PlayerAssetStore, mediaTypeForName, throwCollectedErrors } from './assets.js';
import type {
  PlayerController,
  PlayerEvent,
  PlayerListener,
  PlayerOutputSelection,
} from './types.js';

export type { PlayerController, PlayerEvent, PlayerListener, PlayerOutputSelection } from './types.js';

export interface StartPlayerOptions {
  readonly document: CascadeDocument;
  readonly registrations: readonly DefinitionNodeRegistration[];
  readonly assets: Readonly<Record<string, string>>;
  readonly root?: HTMLElement;
}

interface InitialState {
  readonly frame: number;
  readonly fps: number;
  readonly autoplay: boolean;
  readonly output?: PlayerOutputSelection;
}

/** Start the standalone app inside its own document/iframe realm. */
export async function startPlayer(options: StartPlayerOptions): Promise<PlayerController> {
  const cascadeDocument = options.document;
  const hostDocument = options.root?.ownerDocument ?? globalThis.document;
  const root = options.root ?? hostDocument.body;
  if (!root) throw new Error('Cascade player needs a document body or explicit root');

  const view = hostDocument.defaultView;
  const initial = readInitialState(view?.location.href);
  const ui = createUi(hostDocument, root);
  let assets: PlayerAssetStore | undefined;
  let disposeIo: (() => void) | undefined;
  let gpu: ReturnType<typeof createBrowserGpuHost>;
  let runtime: ReturnType<typeof createRuntime> | undefined;
  let graph: LoadedCascadeGraph | undefined;
  try {
    assets = new PlayerAssetStore(options.assets);
    disposeIo = installIoBridge(assets);
    gpu = createBrowserGpuHost();
    const registrations = new Map(options.registrations.map((item) => [item.moduleId, item]));
    runtime = createRuntime({
      host: createBrowserRuntimeHost({
        modules: { resolve: async (moduleId) => registrations.get(moduleId) ?? null },
        assets,
        ...(gpu ? { gpu } : {}),
        report: (diagnostic) => {
          if (diagnostic.phase === 'run') ui.error.textContent = diagnostic.message;
        },
      }),
      nodes: options.registrations,
    });
    graph = await runtime.load(cascadeDocument);
    const preflight = graph.preflight();
    const blocking = preflight.find((diagnostic) => !PREFLIGHT_WARNING_CODES.has(diagnostic.code));
    if (blocking) throw new Error(blocking.message);
    const controller = new BrowserPlayer({
      graph,
      runtime,
      gpu,
      assets,
      disposeIo,
      root,
      ui,
      document: cascadeDocument,
      initial,
    });
    await controller.start();
    return controller;
  } catch (cause) {
    const error = asError(cause);
    ui.error.textContent = error.message;
    ui.error.hidden = false;
    try {
      await cleanupAll([
        () => graph?.dispose(),
        () => runtime?.dispose(),
        () => gpu?.dispose(),
        () => disposeIo?.(),
        () => assets?.dispose(),
      ]);
    } catch (cleanupError) {
      Object.assign(error, { cleanupError });
    }
    throw error;
  }
}

class BrowserPlayer implements PlayerController {
  private readonly listeners = new Set<PlayerListener>();
  private readonly controllerRoots = new Map<string, unknown>();
  private settledRoots: unknown[] = [];
  private selected?: PlayerOutputSelection;
  private displayRelease?: () => void | Promise<void>;
  private displayedElement?: HTMLElement;
  private commandTail: Promise<void> = Promise.resolve();
  private pendingPlaybackFrame?: number;
  private playbackCook?: Promise<void>;
  private animationFrame?: number;
  private playing = false;
  private playbackAnchor = { frame: 1, time: 0 };
  private disposed = false;
  private width: number;
  private height: number;
  private readonly frameWindow: Window | null;

  constructor(private readonly context: {
    readonly graph: LoadedCascadeGraph;
    readonly runtime: ReturnType<typeof createRuntime>;
    readonly gpu: ReturnType<typeof createBrowserGpuHost>;
    readonly assets: PlayerAssetStore;
    readonly disposeIo: () => void;
    readonly root: HTMLElement;
    readonly ui: PlayerUi;
    readonly document: CascadeDocument;
    readonly initial: InitialState;
  }) {
    this.selected = context.initial.output;
    this.width = Math.max(1, context.root.clientWidth || 1280);
    this.height = Math.max(1, context.root.clientHeight || 720);
    this.frameWindow = context.root.ownerDocument.defaultView;
    context.graph.setFrame(context.initial.frame);
    context.graph.setFps(context.initial.fps);
    context.ui.play.addEventListener('click', this.togglePlayback);
    context.ui.frame.addEventListener('change', this.commitFrame);
  }

  async start(): Promise<void> {
    await this.cook(this.context.initial.frame);
    if (this.context.initial.autoplay) this.play();
  }

  play(): void {
    this.assertActive();
    if (this.playing) return;
    this.playing = true;
    this.context.ui.play.textContent = 'Pause';
    this.emit({ type: 'playing', playing: true });
    this.playbackAnchor = { frame: this.context.graph.getFrame(), time: this.now() };
    const tick = (time: number) => {
      if (!this.playing || this.disposed) return;
      const elapsed = Math.max(0, time - this.playbackAnchor.time);
      const wanted = this.playbackAnchor.frame + (elapsed * this.context.graph.getFps()) / 1000;
      this.requestPlaybackFrame(wanted);
      this.animationFrame = this.requestAnimationFrame(tick);
    };
    this.animationFrame = this.requestAnimationFrame(tick);
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    this.pendingPlaybackFrame = undefined;
    if (this.animationFrame !== undefined) this.cancelAnimationFrame(this.animationFrame);
    this.animationFrame = undefined;
    this.context.ui.play.textContent = 'Play';
    this.emit({ type: 'playing', playing: false });
  }

  seek(frame: number): Promise<void> {
    requireFinite(frame, 'frame');
    return this.enqueue(async () => {
      await this.cook(frame);
      this.pendingPlaybackFrame = undefined;
      this.playbackAnchor = { frame: this.context.graph.getFrame(), time: this.now() };
    });
  }

  setInput(nodeId: string, name: string, value: unknown): Promise<void> {
    return this.enqueue(async () => {
      await this.context.graph.setInput(nodeId, name, value);
      this.controllerRoots.set(`input\u0000${nodeId}\u0000${name}`, value);
      await this.cook(this.context.graph.getFrame());
    });
  }

  setProp(nodeId: string, name: string, value: unknown): Promise<void> {
    return this.enqueue(async () => {
      await this.context.graph.setProp(nodeId, name, value);
      this.controllerRoots.set(`prop\u0000${nodeId}\u0000${name}`, value);
      await this.cook(this.context.graph.getFrame());
    });
  }

  getOutput(nodeId: string, port: string): unknown {
    this.assertActive();
    return this.context.graph.getOutput(nodeId, port);
  }

  selectOutput(nodeId: string, port: string): Promise<void> {
    return this.enqueue(async () => {
      if (!this.context.graph.getOutputs(nodeId).has(port))
        throw new Error(`Player output not found: ${nodeId}.${port}`);
      const previous = this.selected;
      this.selected = { nodeId, port };
      try { await this.display(this.context.graph.getOutput(nodeId, port)); }
      catch (cause) {
        this.selected = previous;
        const error = asError(cause);
        this.fail(error);
        throw error;
      }
      this.collect();
    });
  }

  async downloadOutput(): Promise<Blob> {
    this.assertActive();
    const value = this.currentOutput();
    if (value instanceof Blob) return value;
    if (isAssetRef(value)) {
      const bytes = await this.context.assets.read(value, { signal: new AbortController().signal });
      const mediaType = 'mediaType' in value ? value.mediaType : undefined;
      return new Blob([bytes.slice().buffer], { type: mediaType ?? mediaTypeForName(value.path) ?? 'application/octet-stream' });
    }
    if (typeof value === 'string') {
      return new Blob([value], {
        type: value.trimStart().startsWith('<svg') ? 'image/svg+xml' : 'text/plain;charset=utf-8',
      });
    }
    if ((isGeometry(value) || isScene(value)) && this.displayedElement instanceof HTMLCanvasElement)
      return canvasBlob(this.displayedElement);
    if (value instanceof HTMLCanvasElement) return canvasBlob(value);
    return new Blob([JSON.stringify(value, jsonReplacer, 2)], { type: 'application/json' });
  }

  resize(width: number, height: number): void {
    requireFinite(width, 'width');
    requireFinite(height, 'height');
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    void this.enqueue(async () => this.display(this.currentOutput())).catch((error) => this.fail(asError(error)));
  }

  subscribe(listener: PlayerListener): () => void {
    this.assertActive();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.pause();
    this.context.graph.cancel('Player disposed');
    await this.commandTail.catch(() => {});
    await this.playbackCook?.catch(() => {});
    this.context.ui.play.removeEventListener('click', this.togglePlayback);
    this.context.ui.frame.removeEventListener('change', this.commitFrame);
    this.listeners.clear();
    try {
      await cleanupAll([
        () => this.releaseDisplay(),
        () => this.context.graph.dispose(),
        () => this.context.runtime.dispose(),
        () => this.context.gpu?.dispose(),
        () => this.context.disposeIo(),
        () => this.context.assets.dispose(),
      ]);
    } finally {
      this.context.root.replaceChildren();
    }
  }

  private readonly togglePlayback = (): void => {
    if (this.playing) this.pause();
    else this.play();
  };

  private readonly commitFrame = (): void => {
    const frame = Number(this.context.ui.frame.value);
    if (Number.isFinite(frame)) void this.seek(frame).catch((error) => this.fail(asError(error)));
  };

  private enqueue(operation: () => Promise<void>): Promise<void> {
    this.assertActive();
    const scheduled = this.commandTail.then(operation);
    this.commandTail = scheduled.catch(() => {});
    return scheduled;
  }

  private requestPlaybackFrame(frame: number): void {
    this.pendingPlaybackFrame = frame;
    if (this.playbackCook) return;
    this.playbackCook = this.enqueue(async () => {
      const next = this.pendingPlaybackFrame;
      this.pendingPlaybackFrame = undefined;
      if (!this.disposed && this.playing && next !== undefined) await this.cook(next);
    })
      .catch(() => {})
      .finally(() => {
        this.playbackCook = undefined;
        if (this.playing && this.pendingPlaybackFrame !== undefined)
          this.requestPlaybackFrame(this.pendingPlaybackFrame);
      });
  }

  private async cook(frame: number): Promise<void> {
    this.assertActive();
    let result: RunResult;
    try {
      result = await this.context.graph.run({ frame, fps: this.context.graph.getFps() });
      this.settledRoots = outputValues(result);
      if (result.status !== 'completed') throw resultError(result);
      if (!this.selected) this.selected = preferredOutput(result);
      if (this.selected && !result.outputs.get(this.selected.nodeId)?.has(this.selected.port))
        throw new Error(`Player output not found: ${this.selected.nodeId}.${this.selected.port}`);
      await this.display(this.currentOutput());
      const effectiveFrame = this.context.graph.getFrame();
      this.context.ui.frame.value = String(effectiveFrame);
      this.context.ui.error.hidden = true;
      this.context.ui.error.textContent = '';
      this.emit({ type: 'frame', frame: effectiveFrame });
    } catch (cause) {
      const error = asError(cause);
      this.fail(error);
      this.collect();
      throw error;
    }
    this.collect();
  }

  private currentOutput(): unknown {
    return this.selected
      ? this.context.graph.getOutput(this.selected.nodeId, this.selected.port)
      : undefined;
  }

  private async display(value: unknown): Promise<void> {
    const output = this.context.ui.output;
    let next: HTMLElement;
    let nextRelease: (() => void | Promise<void>) | undefined;
    const asset = isAssetRef(value) ? value : undefined;
    if (asset || (typeof value === 'string' && value.trimStart().startsWith('<svg'))) {
      let url: string;
      if (asset) {
        const lease = await this.context.assets.resolveUrl(asset);
        url = lease.value;
        nextRelease = lease.release;
      } else {
        url = URL.createObjectURL(new Blob([value as string], { type: 'image/svg+xml' }));
        nextRelease = () => URL.revokeObjectURL(url);
      }
      try {
        if (!asset || isImageAsset(asset)) {
          const image = output.ownerDocument.createElement('img');
          image.src = url;
          image.alt = this.selected ? `${this.selected.nodeId}.${this.selected.port}` : asset ? 'Cascade output' : 'Cascade SVG output';
          await image.decode();
          next = image;
        } else {
          const link = output.ownerDocument.createElement('a');
          link.href = url;
          link.download = asset.path.split('/').pop() || 'asset';
          link.textContent = asset.path;
          next = link;
        }
      } catch (error) {
        await nextRelease();
        throw error;
      }
    } else if (isScene(value) || isGeometry(value)) {
      const scene = isScene(value) ? value : sceneFromGeometry(value);
      next = renderSceneCanvas(output.ownerDocument, scene, this.width, this.height);
    } else {
      const pre = output.ownerDocument.createElement('pre');
      pre.textContent = value === undefined ? 'No output' : JSON.stringify(value, jsonReplacer, 2);
      next = pre;
    }

    try {
      await this.releaseDisplay();
    } catch (error) {
      await nextRelease?.();
      throw error;
    }
    if (next.tagName === 'IMG' || next.tagName === 'CANVAS') {
      Object.assign(next.style, { display: 'block', maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', minWidth: '0', minHeight: '0' });
    }
    output.replaceChildren(next);
    this.displayedElement = next;
    this.displayRelease = nextRelease;
  }

  private async releaseDisplay(): Promise<void> {
    const release = this.displayRelease;
    this.displayRelease = undefined;
    this.displayedElement = undefined;
    await release?.();
  }

  private collect(): void {
    this.context.assets.collect([
      this.context.document,
      ...this.controllerRoots.values(),
      ...this.settledRoots,
    ]);
  }

  private fail(error: Error): void {
    this.pause();
    this.context.ui.error.hidden = false;
    this.context.ui.error.textContent = error.message;
    this.emit({ type: 'error', error });
  }

  private emit(event: PlayerEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch (error) {
        console.error('Cascade player listener failed', error);
      }
    }
  }

  private now(): number {
    return this.frameWindow?.performance.now() ?? performance.now();
  }

  private requestAnimationFrame(callback: FrameRequestCallback): number {
    if (this.frameWindow?.requestAnimationFrame)
      return this.frameWindow.requestAnimationFrame(callback);
    return globalThis.setTimeout(() => callback(this.now()), 16) as unknown as number;
  }

  private cancelAnimationFrame(handle: number): void {
    if (this.frameWindow?.cancelAnimationFrame) this.frameWindow.cancelAnimationFrame(handle);
    else globalThis.clearTimeout(handle);
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('Cascade player is disposed');
  }
}

interface PlayerUi {
  readonly play: HTMLButtonElement;
  readonly frame: HTMLInputElement;
  readonly error: HTMLElement;
  readonly output: HTMLElement;
}

function createUi(hostDocument: Document, root: HTMLElement): PlayerUi {
  root.replaceChildren();
  root.dataset.cascadePlayer = '';
  Object.assign(root.style, { display: 'flex', flexDirection: 'column', height: '100%', margin: '0', background: '#141414', color: '#eee', overflow: 'hidden' });
  const toolbar = hostDocument.createElement('div');
  toolbar.dataset.cascadeControls = '';
  Object.assign(toolbar.style, { display: 'flex', gap: '8px', padding: '8px', flex: 'none', alignItems: 'center' });
  const play = hostDocument.createElement('button');
  play.type = 'button';
  play.textContent = 'Play';
  const frame = hostDocument.createElement('input');
  frame.type = 'number';
  frame.step = 'any';
  frame.setAttribute('aria-label', 'Frame');
  frame.style.width = '100px';
  const error = hostDocument.createElement('div');
  error.dataset.cascadeError = '';
  error.setAttribute('role', 'alert');
  error.hidden = true;
  Object.assign(error.style, { padding: '8px', whiteSpace: 'pre-wrap', overflow: 'auto' });
  const output = hostDocument.createElement('div');
  output.dataset.cascadeOutput = '';
  Object.assign(output.style, { display: 'grid', placeItems: 'center', flex: '1', minHeight: '0', minWidth: '0', overflow: 'auto' });
  toolbar.append(play, frame);
  root.append(toolbar, error, output);
  return { play, frame, error, output };
}

function renderSceneCanvas(hostDocument: Document, scene: Scene, width: number, height: number): HTMLCanvasElement {
  let canvas: HTMLCanvasElement | undefined;
  const camera = scene.camera ?? fitCamera(scene, width, height);
  renderScene(scene.geometry, {
    camera,
    size: [width, height],
    stroke: [1, 1, 1, 1],
    strokeWidth: 1,
    opacity: 1,
    pointRadius: 1,
    drawPoints: true,
    surface: (surfaceWidth, surfaceHeight) => {
      canvas = hostDocument.createElement('canvas');
      canvas.width = surfaceWidth;
      canvas.height = surfaceHeight;
      return canvas as unknown as DrawingSurface;
    },
  });
  return canvas!;
}

function fitCamera(scene: Scene, width: number, height: number): Camera {
  const bounds = sceneBounds(scene);
  if (!bounds) return { ...CAMERA_DEFAULTS, projection: 'orthographic', resolution: [width, height] };
  const centerX = ((bounds.min[0] ?? 0) + (bounds.max[0] ?? 0)) / 2;
  const centerY = ((bounds.min[1] ?? 0) + (bounds.max[1] ?? 0)) / 2;
  const maxZ = bounds.max[2] ?? 0;
  const spanX = (bounds.max[0] ?? 0) - (bounds.min[0] ?? 0);
  const spanY = (bounds.max[1] ?? 0) - (bounds.min[1] ?? 0);
  const frameAspect = width / height;
  return {
    ...CAMERA_DEFAULTS,
    translate: [centerX, centerY, maxZ + Math.max(spanX, spanY, 1)],
    projection: 'orthographic',
    orthowidth: Math.max(spanX, spanY * frameAspect, 1) * 1.1,
    resolution: [width, height],
  };
}

function readInitialState(href: string | undefined): InitialState {
  const query = new URL(href ?? 'http://localhost/').searchParams;
  const frame = finiteQuery(query.get('frame'), 1);
  const fps = finiteQuery(query.get('fps'), 30);
  const nodeId = query.get('outputNode');
  const port = query.get('outputPort');
  return {
    frame,
    fps,
    autoplay: query.get('autoplay') === '1',
    ...(nodeId && port ? { output: { nodeId, port } } : {}),
  };
}

function finiteQuery(value: string | null, fallback: number): number {
  if (value === null || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function preferredOutput(result: RunResult): PlayerOutputSelection | undefined {
  let fallback: PlayerOutputSelection | undefined;
  let preferred: PlayerOutputSelection | undefined;
  for (const [nodeId, outputs] of result.outputs) {
    for (const [port, value] of outputs) {
      fallback = { nodeId, port };
      if (isAssetRef(value) || isScene(value) || isGeometry(value) ||
          (typeof value === 'string' && value.trimStart().startsWith('<svg')))
        preferred = { nodeId, port };
    }
  }
  return preferred ?? fallback;
}

function outputValues(result: RunResult): unknown[] {
  const values: unknown[] = [];
  for (const outputs of result.outputs.values())
    for (const value of outputs.values()) values.push(value);
  return values;
}

function resultError(result: RunResult): Error {
  const details = result.diagnostics.map((diagnostic) => diagnostic.message).filter(Boolean);
  return new Error(details.join('\n') || `Player cook ${result.status}`);
}

function isGeometry(value: unknown): value is Geometry {
  return typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'geometry';
}

function isAssetRef(value: unknown): value is AssetRef | ImageRef {
  return typeof value === 'object' && value !== null && typeof (value as { path?: unknown }).path === 'string';
}

function isImageAsset(value: AssetRef | ImageRef): boolean {
  if ('size' in value && Array.isArray(value.size)) return true;
  if ('mediaType' in value && value.mediaType?.startsWith('image/')) return true;
  return /\.(png|svg|jpe?g|webp|gif|avif)$/i.test(value.path);
}

function jsonReplacer(_key: string, value: unknown): unknown {
  return ArrayBuffer.isView(value) ? Array.from(value as unknown as ArrayLike<number>) : value;
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Canvas produced no image')), 'image/png');
  });
}

async function cleanupAll(actions: readonly (() => void | Promise<void> | undefined)[]): Promise<void> {
  const errors: unknown[] = [];
  for (const action of actions) {
    try { await action(); } catch (error) { errors.push(error); }
  }
  throwCollectedErrors(errors, 'Cascade player cleanup failed');
}

function requireFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
