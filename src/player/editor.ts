/**
 * The exported editor: a viewer and a parameter panel generated from a graph's
 * published parameters, with presets, scenes, exports and a read-only view of
 * every stage.
 *
 * It is the browser player's host with a different face, not a second engine:
 * the same runtime, asset store and IO bridge, cooking the graph `cascade
 * export` selected. Everything stays in the viewer's browser. Dropped files are
 * written to the in-memory asset store (and remembered in this browser's
 * IndexedDB when allowed); nothing is fetched except the site's own files.
 */
import {
  isScene,
  sceneFromGeometry,
  type CascadeDocument,
  type CascadeScene,
  type EditorDeclaration,
  type JsonValue,
  type PublishedOutput,
  type PublishedParameter,
  type SceneFile,
} from '../../packages/contracts/src/index.js';
import {
  controlOf,
  createScene,
  editorGraphVersion,
  fromBase64,
  isVisible,
  publishedValues,
  resolveScene,
  sceneFile,
} from '../../packages/runtime/src/editor/index.js';
import type { DefinitionNodeRegistration } from '../../packages/runtime/src/types.js';
import {
  asError,
  canvasBlob,
  isAssetRef,
  isGeometry,
  isImageAsset,
  isSvgText,
  jsonReplacer,
  renderSceneCanvas,
} from './app.js';
import { mediaTypeForName } from './assets.js';
import { createWorkerEngine, LocalEngine, type EditorEngine } from './editorEngine.js';
import { attachSheet, attachZoom, notch, shareFile, stepOf, stepValue, tick } from './editorTouch.js';

/** What a project panel receives. Framework-free, so a Svelte `mount` fits it directly. */
export interface EditorPanelApi {
  readonly editor: EditorDeclaration;
  get(id: string): unknown;
  set(id: string, value: unknown): Promise<void>;
  values(): Readonly<Record<string, unknown>>;
  subscribe(listener: (values: Readonly<Record<string, unknown>>) => void): () => void;
  output(id: string): Promise<unknown>;
}

export interface EditorPanelModule {
  mount(target: HTMLElement, api: EditorPanelApi): void | (() => void) | Promise<void | (() => void)>;
}

export interface StartEditorOptions {
  readonly document: CascadeDocument;
  /** The engine worker script. The graph cooks there, so the page never stalls. */
  readonly worker?: URL;
  /** Cook on the page instead (tests, embedding). Used when no worker is given. */
  readonly registrations?: readonly DefinitionNodeRegistration[];
  readonly assets: Readonly<Record<string, string>>;
  readonly panel?: EditorPanelModule;
  readonly root?: HTMLElement;
}

interface DroppedFile {
  readonly name: string;
  readonly mediaType?: string;
  readonly bytes: Uint8Array;
  scene?: SceneFile;
}

const STYLE = `
:root{--bg:#f4f4f2;--panel:#fff;--ink:#1c1c1c;--muted:#6b6b6b;--line:#dededa;--accent:#1c1c1c;--field:#f7f7f5;--warn:#8a5a00;--bad:#a1261b}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#151515;--panel:#1d1d1d;--ink:#ececec;--muted:#9a9a9a;--line:#2f2f2f;--accent:#ececec;--field:#232323;--warn:#e0b050;--bad:#ff8a7a}}
:root[data-theme="dark"]{--bg:#151515;--panel:#1d1d1d;--ink:#ececec;--muted:#9a9a9a;--line:#2f2f2f;--accent:#ececec;--field:#232323;--warn:#e0b050;--bad:#ff8a7a}
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{background:var(--bg);color:var(--ink);font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif}
.ce{display:grid;grid-template-rows:auto 1fr;height:100vh;height:100dvh}
.ce-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 16px;border-bottom:1px solid var(--line);background:var(--panel)}
.ce-bar h1{font-size:14px;font-weight:600;margin:0 8px 0 0}
.ce-bar .sp{flex:1}
.ce-status{color:var(--muted);font-variant-numeric:tabular-nums}
.ce-main{display:grid;grid-template-columns:1fr 340px;min-height:0}
.ce-view{position:relative;display:grid;place-items:center;overflow:auto;min-width:0;min-height:0;padding:16px}
.ce-view img,.ce-view canvas{max-width:100%;max-height:100%;display:block;box-shadow:0 0 0 1px var(--line)}
.ce-side{overflow:auto;border-left:1px solid var(--line);background:var(--panel)}
.ce-group{border-bottom:1px solid var(--line)}
.ce-group>summary{cursor:pointer;padding:10px 16px;font-weight:600;list-style:none}
.ce-group>summary::-webkit-details-marker{display:none}
.ce-group>div{padding:0 16px 12px;display:grid;gap:10px}
.ce-p{display:grid;gap:4px}
.ce-p label,.ce-p .lab{display:flex;justify-content:space-between;gap:8px;color:var(--muted)}
.ce-p .help{color:var(--muted);font-size:11px}
.ce-row{display:flex;gap:6px;align-items:center}
.ce-row input[type=range]{flex:1;min-width:0}
input,select,textarea,button{font:inherit;color:var(--ink)}
input[type=number],input[type=text],select,textarea{background:var(--field);border:1px solid var(--line);border-radius:4px;padding:4px 6px;min-width:0}
input[type=number]{width:84px}
textarea{width:100%;resize:vertical;min-height:52px}
button{background:var(--field);border:1px solid var(--line);border-radius:4px;padding:4px 10px;cursor:pointer}
button:hover{border-color:var(--muted)}
button.primary{background:var(--accent);color:var(--bg);border-color:var(--accent)}
.ce-drop{border:1px dashed var(--line);border-radius:4px;padding:8px;color:var(--muted);text-align:center;cursor:pointer}
.ce-drop.over{border-color:var(--ink);color:var(--ink)}
.ce-msg{padding:6px 16px;white-space:pre-wrap}
.ce-msg.warn{color:var(--warn)}.ce-msg.bad{color:var(--bad)}
.ce-inspect{position:absolute;inset:0;overflow:auto;background:var(--bg);padding:16px;display:none;gap:12px;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));align-content:start}
.ce-inspect.on{display:grid}
.ce-stage{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:8px;display:grid;gap:6px;min-width:0}
.ce-stage h3{margin:0;font-size:12px}.ce-stage .mod{color:var(--muted);font-size:11px}
.ce-stage .out{display:grid;gap:4px}.ce-stage .out>span{color:var(--muted);font-size:11px}
.ce-stage img,.ce-stage canvas{width:100%;height:140px;object-fit:contain;background:var(--field);display:block}
.ce-stage pre{margin:0;max-height:140px;overflow:auto;font-size:11px;background:var(--field);padding:6px}
.ce-indent{margin-left:12px}

/* Phones (.m, set from a media query): the preview on top, controls in a bottom sheet, one-row header. */
.ce-grip,.ce-more,.ce-menu,.ce-busy,.ce-step,.ce-toast{display:none}
.ce.m{overflow:hidden;padding:0 env(safe-area-inset-right) 0 env(safe-area-inset-left)}
.ce.m .ce-bar{flex-wrap:nowrap;gap:4px;min-height:52px;padding:calc(4px + env(safe-area-inset-top)) 4px 4px 16px}
.ce.m .ce-bar>*:not(h1):not(.ce-more):not(.ce-busy){display:none}
.ce.m .ce-bar h1{flex:1;min-width:0;font-size:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ce.m .ce-more{display:inline-grid;place-items:center;width:44px;height:44px;padding:0;border:0;background:transparent;font-size:24px;line-height:1;letter-spacing:1px}
.ce.m .ce-busy{display:block;flex:none;width:8px;height:8px;border-radius:50%;background:var(--muted);opacity:0;transition:opacity .2s}
.ce.m.busy .ce-busy{opacity:1;animation:ce-pulse 1s ease-in-out infinite}
@keyframes ce-pulse{50%{opacity:.2}}
.ce.m .ce-main{display:block;position:relative;min-height:0}
.ce.m .ce-view{position:absolute;inset:0 0 var(--ce-cut,45%) 0;display:block;padding:0;overflow:hidden}
.ce.m .ce-out{position:absolute;inset:8px 8px 12px;overflow:hidden;touch-action:none;-webkit-user-select:none;user-select:none}
.ce.m .ce-zoom{width:100%;height:100%;display:flex;align-items:center;justify-content:center;transform-origin:0 0}
.ce.m .ce-zoom>img,.ce.m .ce-zoom>canvas{max-width:100%;max-height:100%;-webkit-user-drag:none}
.ce.m .ce-inspect{grid-template-columns:1fr;padding:12px;touch-action:pan-y;z-index:1}
.ce.m .ce-stage img,.ce.m .ce-stage canvas{height:200px}
.ce.m .ce-side{position:fixed;left:0;right:0;bottom:0;z-index:5;height:var(--ce-sheet,45%);display:flex;flex-direction:column;overflow:hidden;border:0;border-top:1px solid var(--line);border-radius:14px 14px 0 0;box-shadow:0 -4px 24px rgba(0,0,0,.12);padding:0 env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}
.ce.m .ce-side.settle{transition:height .24s cubic-bezier(.2,.8,.2,1)}
.ce.m .ce-head{flex:none;touch-action:none;-webkit-user-select:none;user-select:none}
.ce.m .ce-head textarea,.ce.m .ce-head input{-webkit-user-select:text;user-select:text}
.ce.m .ce-grip{display:block;height:24px;cursor:grab}
.ce.m .ce-grip::before{content:"";display:block;width:40px;height:5px;border-radius:3px;background:var(--line);margin:10px auto 0}
.ce.m .ce-peek{display:grid;gap:10px;padding:0 16px 12px}
.ce.m .ce-peek:empty{display:none}
.ce.m .ce-peek .help{display:none}
.ce.m .ce-msg{max-height:25vh;overflow:auto;padding:4px 16px 8px}
.ce.m .ce-body{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;border-top:1px solid var(--line)}
.ce.m.land .ce-main{display:grid;grid-template-columns:1fr min(340px,46vw)}
.ce.m.land .ce-view{position:relative;inset:auto;height:100%}
.ce.m.land .ce-side{position:static;height:auto;min-height:0;box-shadow:none;border-radius:0;border-left:1px solid var(--line);border-top:0;padding:0 0 env(safe-area-inset-bottom)}
.ce.m.land .ce-grip{display:none}.ce.m.land .ce-head{touch-action:auto;padding-top:10px}
.ce.m input,.ce.m select,.ce.m textarea,.ce.m button{font-size:16px}
.ce.m button,.ce.m select,.ce.m input[type=number],.ce.m input[type=text]{min-height:44px}
.ce.m button{padding:0 14px;border-radius:8px}
.ce.m select,.ce.m input[type=number],.ce.m input[type=text],.ce.m textarea{border-radius:8px;padding:6px 10px}
.ce.m input[type=number]{width:76px}
.ce.m select{-webkit-appearance:none;appearance:none;height:44px;padding-right:32px;background-image:linear-gradient(45deg,transparent 50%,var(--muted) 50%),linear-gradient(135deg,var(--muted) 50%,transparent 50%);background-position:calc(100% - 19px) 52%,calc(100% - 14px) 52%;background-size:5px 5px;background-repeat:no-repeat}
.ce.m .ce-step{display:inline-grid;place-items:center;flex:none;width:44px;padding:0;font-size:22px;line-height:1}
.ce.m .ce-group>summary{display:flex;align-items:center;min-height:48px;font-size:15px}
.ce.m .ce-group>summary::after{content:"";margin-left:auto;width:8px;height:8px;border-right:2px solid var(--muted);border-bottom:2px solid var(--muted);transform:translateY(-2px) rotate(45deg);transition:transform .2s}
.ce.m .ce-group[open]>summary::after{transform:translateY(2px) rotate(-135deg)}
.ce.m .ce-group>div{gap:14px;padding-bottom:16px}
.ce.m .ce-p label,.ce.m .ce-p .lab{font-size:14px;align-items:center}
.ce.m .ce-row{gap:8px}
.ce.m input[type=range]{-webkit-appearance:none;appearance:none;height:44px;margin:0;background:transparent;touch-action:pan-y}
.ce.m input[type=range]::-webkit-slider-runnable-track{height:4px;border-radius:2px;background:var(--line)}
.ce.m input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:28px;height:28px;margin-top:-12px;border-radius:50%;background:var(--panel);border:1px solid var(--muted);box-shadow:0 1px 4px rgba(0,0,0,.25)}
.ce.m input[type=range]::-moz-range-track{height:4px;border-radius:2px;background:var(--line)}
.ce.m input[type=range]::-moz-range-thumb{width:28px;height:28px;border-radius:50%;background:var(--panel);border:1px solid var(--muted)}
.ce.m input[type=checkbox]{width:24px;height:24px;margin:0 6px 0 0}
.ce.m .ce-p>label:has(input[type=checkbox]){min-height:44px}
.ce.m input[type=color]{width:56px;height:44px;padding:2px;border:1px solid var(--line);border-radius:8px;background:var(--field)}
.ce.m .ce-drop{display:grid;place-items:center;min-height:56px;border-radius:8px}
.ce.m .ce-menu.on{display:grid;gap:2px;position:fixed;z-index:20;top:calc(52px + env(safe-area-inset-top));right:calc(8px + env(safe-area-inset-right));width:min(280px,calc(100vw - 16px));max-height:calc(100dvh - 72px - env(safe-area-inset-top));overflow:auto;padding:6px;background:var(--panel);border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.22)}
.ce-menu button{width:100%;text-align:left;border:0;background:transparent}
.ce-menu select{width:100%}
.ce-menu hr{border:0;border-top:1px solid var(--line);margin:4px 0;width:100%}
.ce-menu .meta{color:var(--muted);padding:8px 14px;font-size:13px;font-variant-numeric:tabular-nums}
.ce.m .ce-toast{display:flex;align-items:center;gap:8px;position:fixed;z-index:15;left:50%;bottom:calc(var(--ce-sheet,45%) + 12px);transform:translateX(-50%);max-width:calc(100vw - 32px);padding:8px 8px 8px 16px;border-radius:22px;background:var(--ink);color:var(--bg);font-size:14px;opacity:0;pointer-events:none;transition:opacity .2s}
.ce.m.land .ce-toast{bottom:calc(16px + env(safe-area-inset-bottom))}
.ce.m .ce-toast.on{opacity:1;pointer-events:auto}
.ce.m .ce-toast button{min-height:36px;color:var(--bg);background:transparent;border-color:var(--bg)}
.ce.m .ce-toast button[hidden]{display:none}
`;

/** Phone layout: narrow, or a coarse pointer on a short (landscape) screen. */
const PHONE = '(max-width: 760px), (pointer: coarse) and (max-height: 540px)';

/** Start the editor in its own document. Resolves once the first view is drawn. */
export async function startEditor(options: StartEditorOptions): Promise<EditorController> {
  const document = options.document;
  const editor = document.editor;
  if (!editor) throw new Error('This export has no editor declaration');
  const host = options.root?.ownerDocument ?? globalThis.document;
  const root = options.root ?? host.body;
  let engine: EditorEngine | undefined;
  try {
    engine = options.worker && typeof Worker !== 'undefined'
      ? await createWorkerEngine(options.worker, { document, assets: options.assets })
      : await LocalEngine.create({ document, assets: options.assets, registrations: options.registrations ?? [] });
    const controller = new EditorController(document, editor, engine, root);
    await controller.start(options.panel);
    return controller;
  } catch (error) {
    await engine?.dispose().catch(() => {});
    root.replaceChildren(message(host, asError(error).message, 'bad'));
    throw error;
  }
}

export class EditorController {
  private readonly parameters: readonly PublishedParameter[];
  private readonly byId: Map<string, PublishedParameter>;
  private readonly defaults: Record<string, JsonValue | undefined>;
  private values: Record<string, unknown> = {};
  private readonly files = new Map<string, DroppedFile>();
  private readonly listeners = new Set<(values: Readonly<Record<string, unknown>>) => void>();
  private readonly rows = new Map<string, { element: HTMLElement; refresh: () => void }>();
  private readonly view?: PublishedOutput;
  private readonly propTypes = new Map<string, string>();
  private ui!: ReturnType<EditorController['build']>;
  private tail: Promise<void> = Promise.resolve();
  private queued = false;
  private readonly pending = new Map<string, unknown>();
  private pendingCook?: Promise<void>;
  private inspecting = false;
  private viewRelease?: () => void;
  private readonly storageKey: string;
  private nodes: Awaited<ReturnType<EditorEngine['nodes']>> = [];
  /** Phone layout, and whether it is the landscape (side panel) form. */
  private mobile = false;
  private landscape = false;
  private sheetHeight = 0;
  private snapIndex = 0;
  private peekSlots = new Map<string, Comment>();
  private groupsFolded = false;
  /** The parameter being dragged while draft values cook, and whether they are written. */
  private drafting?: string;
  private draftWritten = false;
  private toastTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly document: CascadeDocument,
    private readonly editor: EditorDeclaration,
    private readonly engine: EditorEngine,
    private readonly root: HTMLElement,
  ) {
    this.parameters = [...(editor.parameters ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    this.byId = new Map(this.parameters.map((parameter) => [parameter.id, parameter]));
    this.defaults = publishedValues(document);
    this.values = { ...this.defaults };
    this.view = (editor.outputs ?? []).find((output) => output.view) ?? editor.outputs?.[0];
    this.storageKey = `cascade-editor:${editor.id}:${editorGraphVersion(document)}`;
  }

  async start(panel?: EditorPanelModule): Promise<void> {
    const inspected = new Map<string, unknown>();
    this.nodes = await this.engine.nodes();
    for (const node of this.nodes)
      for (const [name, prop] of Object.entries(node.props)) {
        this.propTypes.set(`${node.id}\u0000${name}`, prop.type);
        inspected.set(`${node.id}\u0000${name}`, prop.value);
      }
    // Props the document does not store take their definition defaults.
    for (const parameter of this.parameters)
      if (this.defaults[parameter.id] === undefined) {
        const value = inspected.get(`${parameter.node}\u0000${parameter.prop}`);
        if (value !== undefined) this.defaults[parameter.id] = JSON.parse(JSON.stringify(value)) as JsonValue;
      }
    this.values = { ...this.defaults };
    this.ui = this.build();
    const remembered = readLocal(this.storageKey);
    if (remembered) {
      const resolved = resolveScene(this.document, remembered);
      await this.assign(resolved.values);
      await this.restoreFiles(remembered.files ?? {}, false);
    }
    await this.restoreRememberedFiles();
    this.renderParameters();
    if (panel) await this.mountPanel(panel);
    this.ui.inspectToggle.hidden = this.editor.inspect === false;
    this.ui.menuInspect.hidden = this.editor.inspect === false;
    this.setupTouch();
    await this.cook();
  }

  private control(parameter: PublishedParameter): string {
    return controlOf(parameter, this.defaults[parameter.id], this.propTypes.get(`${parameter.node}\u0000${parameter.prop}`));
  }

  /** The panel API, also handy from the console. */
  api(): EditorPanelApi {
    return {
      editor: this.editor,
      get: (id) => this.values[id],
      set: (id, value) => this.set(id, value),
      values: () => ({ ...this.values }),
      subscribe: (listener) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      },
      output: async (id) => {
        const output = (this.editor.outputs ?? []).find((item) => item.id === id);
        if (!output) throw new Error(`Unknown output ${id}`);
        return this.exclusive(async () => {
          await this.runTarget(output);
          return this.engine.output(output.node, output.port);
        });
      },
    };
  }

  /**
   * Set a published value. The write waits for the graph to be idle: a graph
   * that is cooking refuses edits, and a slider dragged during a slow cook
   * would otherwise throw on every step. Resolves once the change is drawn.
   */
  set(id: string, value: unknown): Promise<void> {
    if (!this.byId.has(id)) return Promise.reject(new Error(`Unknown parameter ${id}`));
    this.values[id] = value;
    this.pending.set(id, value);
    return this.changed([id]);
  }

  async dispose(): Promise<void> {
    this.viewRelease?.();
    this.panelDispose?.();
    await this.engine.dispose();
  }

  // ---------------------------------------------------------------- layout

  private build() {
    const d = this.root.ownerDocument;
    const style = d.createElement('style');
    style.textContent = STYLE;
    d.head.append(style);
    d.title = this.editor.title ?? this.editor.id;
    const shell = el(d, 'div', 'ce');
    const bar = el(d, 'header', 'ce-bar');
    const title = el(d, 'h1');
    title.textContent = this.editor.title ?? this.editor.id;
    const presets = d.createElement('select');
    presets.setAttribute('aria-label', 'Preset');
    presets.append(option(d, '', 'Presets…'), option(d, '__defaults', 'Graph defaults'));
    for (const preset of this.editor.presets ?? []) presets.append(option(d, preset.id, preset.label));
    presets.addEventListener('change', () => {
      const id = presets.value;
      presets.value = '';
      if (id) void this.applyPreset(id).catch((error) => this.report(asError(error).message, 'bad'));
    });
    const open = button(d, 'Open scene…');
    const sceneInput = d.createElement('input');
    sceneInput.type = 'file';
    sceneInput.accept = '.json,application/json';
    sceneInput.hidden = true;
    open.addEventListener('click', () => sceneInput.click());
    sceneInput.addEventListener('change', () => {
      const file = sceneInput.files?.[0];
      sceneInput.value = '';
      if (file) void this.openScene(file).catch((error) => this.report(asError(error).message, 'bad'));
    });
    const save = button(d, 'Save scene');
    save.addEventListener('click', () => void this.saveScene().catch((error) => this.report(asError(error).message, 'bad')));
    const inspectToggle = el(d, 'label');
    const inspectBox = d.createElement('input');
    inspectBox.type = 'checkbox';
    inspectToggle.append(inspectBox, d.createTextNode(' Inspect stages'));
    inspectBox.addEventListener('change', () => {
      this.inspecting = inspectBox.checked;
      inspect.classList.toggle('on', this.inspecting);
      menuInspect.setAttribute('aria-checked', String(this.inspecting));
      menuInspect.textContent = this.inspecting ? 'Inspect stages \u2713' : 'Inspect stages';
      if (this.inspecting) void this.cook().catch(() => {});
    });
    const status = el(d, 'span', 'ce-status');
    const busy = el(d, 'span', 'ce-busy');
    busy.setAttribute('aria-hidden', 'true');
    const more = button(d, '\u22ef');
    more.className = 'ce-more';
    more.setAttribute('aria-label', 'Menu');
    more.setAttribute('aria-haspopup', 'menu');
    bar.append(title, presets, open, save, sceneInput, el(d, 'span', 'sp'), inspectToggle, status, busy, more);
    // The phone's one menu: what the desktop header shows in a row.
    const menu = el(d, 'div', 'ce-menu');
    menu.setAttribute('role', 'menu');
    const closeMenu = () => { menu.classList.remove('on'); more.setAttribute('aria-expanded', 'false'); };
    more.addEventListener('click', () => {
      const on = menu.classList.toggle('on');
      more.setAttribute('aria-expanded', String(on));
    });
    d.addEventListener('pointerdown', (event) => {
      const target = event.target as Node | null;
      if (menu.classList.contains('on') && target && !menu.contains(target) && !more.contains(target)) closeMenu();
    });
    const menuPresets = presets.cloneNode(true) as HTMLSelectElement;
    menuPresets.addEventListener('change', () => {
      const id = menuPresets.value;
      menuPresets.value = '';
      closeMenu();
      if (id) void this.applyPreset(id).catch((error) => this.report(asError(error).message, 'bad'));
    });
    const menuItem = (text: string, run: () => void) => {
      const item = button(d, text);
      item.setAttribute('role', 'menuitem');
      item.addEventListener('click', () => { closeMenu(); run(); });
      return item;
    };
    const menuInspect = menuItem('Inspect stages', () => { inspectBox.checked = !inspectBox.checked; inspectBox.dispatchEvent(new Event('change')); });
    menuInspect.setAttribute('role', 'menuitemcheckbox');
    menuInspect.setAttribute('aria-checked', 'false');
    const menuStatus = el(d, 'div', 'meta');
    menu.append(
      menuPresets,
      menuItem('Open scene\u2026', () => sceneInput.click()),
      menuItem('Save scene', () => void this.saveScene().catch((error) => this.report(asError(error).message, 'bad'))),
      menuInspect,
    );
    if ((this.editor.outputs ?? []).length) menu.append(el(d, 'hr'));
    for (const output of this.editor.outputs ?? [])
      menu.append(menuItem(output.label ?? `Export ${output.id}`, () => void this.exportOutput(output).catch((error) => this.report(asError(error).message, 'bad'))));
    menu.append(el(d, 'hr'), menuStatus);
    const main = el(d, 'div', 'ce-main');
    const viewer = el(d, 'section', 'ce-view');
    const surface = el(d, 'div', 'ce-out');
    const output = el(d, 'div', 'ce-zoom');
    surface.append(output);
    const inspect = el(d, 'div', 'ce-inspect');
    viewer.append(surface, inspect);
    const side = el(d, 'aside', 'ce-side');
    const head = el(d, 'div', 'ce-head');
    const grip = el(d, 'div', 'ce-grip');
    grip.setAttribute('aria-hidden', 'true');
    const messages = el(d, 'div');
    const peek = el(d, 'div', 'ce-peek');
    head.append(grip, messages, peek);
    const body = el(d, 'div', 'ce-body');
    const panelSlot = el(d, 'div');
    const groups = el(d, 'div');
    body.append(panelSlot, groups);
    side.append(head, body);
    main.append(viewer, side);
    const toast = el(d, 'div', 'ce-toast');
    toast.setAttribute('role', 'status');
    const toastText = el(d, 'span');
    const toastAction = button(d, '');
    toastAction.hidden = true;
    toast.append(toastText, toastAction);
    shell.append(bar, main, menu, toast);
    this.root.replaceChildren(shell);
    // Edge to edge on a phone, so the safe-area insets are real numbers.
    const viewport = d.querySelector('meta[name="viewport"]');
    if (viewport && !/viewport-fit/.test(viewport.getAttribute('content') ?? ''))
      viewport.setAttribute('content', `${viewport.getAttribute('content')},viewport-fit=cover`);
    // A scene dropped anywhere opens; any other file goes to the file parameter that accepts it.
    viewer.addEventListener('dragover', (event) => event.preventDefault());
    viewer.addEventListener('drop', (event) => {
      event.preventDefault();
      const file = event.dataTransfer?.files?.[0];
      if (file) void this.dropAnywhere(file).catch((error) => this.report(asError(error).message, 'bad'));
    });
    return { shell, status, output, surface, viewer, inspect, inspectToggle, messages, panelSlot, groups, bar, side, head, peek, menuInspect, menuStatus, toast, toastText, toastAction };
  }

  private renderParameters(): void {
    const d = this.root.ownerDocument;
    const outputParameters = new Set((this.editor.outputs ?? []).flatMap((output) => output.parameters ?? []));
    const order = [...(this.editor.groups ?? [])];
    for (const parameter of this.parameters) {
      const group = parameter.group ?? 'Parameters';
      if (!outputParameters.has(parameter.id) && !order.includes(group)) order.push(group);
    }
    const exportGroup = 'Export';
    if (!order.includes(exportGroup)) order.push(exportGroup);
    this.ui.groups.replaceChildren();
    for (const group of order) {
      const details = d.createElement('details');
      details.className = 'ce-group';
      details.open = true;
      const summary = d.createElement('summary');
      summary.textContent = group;
      const body = el(d, 'div');
      details.append(summary, body);
      for (const parameter of this.parameters)
        if ((parameter.group ?? 'Parameters') === group && !outputParameters.has(parameter.id)) body.append(this.row(parameter));
      if (group === exportGroup) {
        for (const output of this.editor.outputs ?? []) {
          for (const id of output.parameters ?? []) {
            const parameter = this.byId.get(id);
            if (parameter && !this.rows.has(id)) body.append(this.row(parameter));
          }
          const action = button(d, `Export ${output.label ?? output.id}`);
          action.addEventListener('click', () => void this.exportOutput(output).catch((error) => this.report(asError(error).message, 'bad')));
          body.append(action);
        }
      }
      if (body.childElementCount) this.ui.groups.append(details);
    }
    this.refreshVisibility();
  }

  private row(parameter: PublishedParameter): HTMLElement {
    const d = this.root.ownerDocument;
    const wrap = el(d, 'div', 'ce-p');
    const label = el(d, 'label');
    const name = el(d, 'span');
    name.textContent = parameter.label ?? parameter.id;
    const readout = el(d, 'span');
    label.append(name, readout);
    wrap.append(label);
    const control = this.control(parameter);
    const commit = (value: unknown) => void this.set(parameter.id, value).catch((error) => this.report(asError(error).message, 'bad'));
    let refresh = () => {};
    const unit = parameter.unit ? ` ${parameter.unit}` : '';
    if (control === 'number' || control === 'slider' || control === 'int' || control === 'seed') {
      const integer = control === 'int' || control === 'seed';
      const line = el(d, 'div', 'ce-row');
      const range = d.createElement('input');
      range.type = 'range';
      const number = d.createElement('input');
      number.type = 'number';
      const step = parameter.step ?? (integer ? 1 : 'any');
      for (const input of [range, number]) {
        if (parameter.min !== undefined) input.min = String(parameter.min);
        if (parameter.max !== undefined) input.max = String(parameter.max);
        input.step = String(step);
      }
      if (range.step === 'any') range.step = String(((parameter.max ?? 1) - (parameter.min ?? 0)) / 1000);
      const hasRange = parameter.min !== undefined && parameter.max !== undefined && control !== 'seed';
      if (hasRange) line.append(range);
      line.append(number);
      if (unit) line.append(d.createTextNode(unit));
      // Phones: a keypad that fits, steppers for the thumb, a tick as a slider crosses each tenth.
      if (integer && (parameter.min ?? 0) >= 0) number.inputMode = 'numeric';
      else if ((parameter.min ?? 0) >= 0) number.inputMode = 'decimal';
      const stepSize = stepOf(parameter.step, parameter.min, parameter.max, integer);
      if (control !== 'seed') {
        for (const direction of [-1, 1] as const) {
          const stepper = button(d, direction < 0 ? '\u2212' : '+');
          stepper.className = 'ce-step';
          stepper.setAttribute('aria-label', `${direction < 0 ? 'Decrease' : 'Increase'} ${parameter.label ?? parameter.id}`);
          stepper.addEventListener('click', () => {
            const current = Number(this.values[parameter.id] ?? parameter.min ?? 0);
            const value = stepValue(Number.isFinite(current) ? current : 0, direction, stepSize, parameter.min, parameter.max);
            number.value = String(value);
            range.value = String(value);
            tick();
            commit(value);
          });
          line.append(stepper);
        }
      }
      let lastNotch = Number.NaN;
      const begin = () => this.beginDraft(parameter.id);
      const end = () => this.endDraft();
      range.addEventListener('pointerdown', begin);
      range.addEventListener('touchstart', begin, { passive: true });
      for (const type of ['pointerup', 'pointercancel', 'touchend', 'touchcancel', 'change']) range.addEventListener(type, end);
      const parse = (text: string) => {
        const value = Number(text);
        return Number.isFinite(value) ? (integer ? Math.round(value) : value) : undefined;
      };
      range.addEventListener('input', () => {
        const value = parse(range.value);
        if (value === undefined) return;
        number.value = String(value);
        const step = notch(value, parameter.min ?? 0, parameter.max ?? 1);
        if (this.mobile && step !== lastNotch && !Number.isNaN(lastNotch)) tick();
        lastNotch = step;
        commit(value);
      });
      number.addEventListener('change', () => {
        const value = parse(number.value);
        if (value !== undefined) commit(value);
      });
      if (control === 'seed') {
        const reroll = button(d, 'Reroll');
        reroll.addEventListener('click', () => {
          const value = Math.floor(Math.random() * Math.max(2, parameter.max ?? 99999));
          number.value = String(value);
          commit(value);
        });
        line.append(reroll);
      }
      refresh = () => {
        const value = this.values[parameter.id];
        range.value = String(value ?? '');
        number.value = String(value ?? '');
      };
      wrap.append(line);
    } else if (control === 'bool') {
      const box = d.createElement('input');
      box.type = 'checkbox';
      box.addEventListener('change', () => commit(box.checked));
      label.prepend(box);
      label.style.justifyContent = 'flex-start';
      refresh = () => { box.checked = this.values[parameter.id] === true; };
    } else if (control === 'select') {
      const select = d.createElement('select');
      const options = (parameter.options ?? []).map((item) =>
        item !== null && typeof item === 'object' && 'value' in item ? item : { value: item, label: String(item) },
      );
      options.forEach((item, index) => {
        const entry = option(d, String(index), item.label);
        if ('disabled' in item && item.disabled) entry.disabled = true;
        select.append(entry);
      });
      select.addEventListener('change', () => commit(options[Number(select.value)]?.value));
      refresh = () => { select.value = String(options.findIndex((item) => Object.is(item.value, this.values[parameter.id]))); };
      wrap.append(select);
    } else if (control === 'text' || control === 'textarea') {
      const input = control === 'textarea' ? d.createElement('textarea') : d.createElement('input');
      if (input instanceof HTMLInputElement) input.type = 'text';
      let timer: ReturnType<typeof setTimeout> | undefined;
      input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => commit(input.value), 250);
      });
      refresh = () => { if (d.activeElement !== input) input.value = String(this.values[parameter.id] ?? ''); };
      wrap.append(input);
    } else if (control === 'color') {
      const line = el(d, 'div', 'ce-row');
      const picker = d.createElement('input');
      picker.type = 'color';
      const hex = d.createElement('input');
      hex.type = 'text';
      hex.size = 8;
      const asArray = Array.isArray(this.values[parameter.id]);
      const toValue = (text: string) => (asArray ? hexToRgba(text) : text);
      picker.addEventListener('input', () => { hex.value = picker.value; commit(toValue(picker.value)); });
      hex.addEventListener('change', () => { if (/^#[0-9a-f]{6}$/i.test(hex.value)) { picker.value = hex.value; commit(toValue(hex.value)); } });
      refresh = () => {
        const value = this.values[parameter.id];
        const text = Array.isArray(value) ? rgbaToHex(value as number[]) : String(value ?? '#000000');
        picker.value = text.slice(0, 7);
        hex.value = text;
      };
      line.append(picker, hex);
      wrap.append(line);
    } else if (control === 'vec2') {
      const line = el(d, 'div', 'ce-row');
      const inputs = [d.createElement('input'), d.createElement('input')];
      for (const input of inputs) {
        input.type = 'number';
        input.step = String(parameter.step ?? 'any');
        if (parameter.min !== undefined) input.min = String(parameter.min);
        if (parameter.max !== undefined) input.max = String(parameter.max);
        input.addEventListener('change', () => {
          const value = inputs.map((item) => Number(item.value));
          if (value.every(Number.isFinite)) commit(value);
        });
        line.append(input);
      }
      if (unit) line.append(d.createTextNode(unit));
      refresh = () => {
        const value = (this.values[parameter.id] as number[] | undefined) ?? [0, 0];
        inputs.forEach((input, index) => { input.value = String(value[index] ?? 0); });
      };
      wrap.append(line);
    } else if (control === 'file') {
      const drop = el(d, 'div', 'ce-drop');
      const picker = d.createElement('input');
      picker.type = 'file';
      picker.hidden = true;
      if (parameter.accept?.length) picker.accept = parameter.accept.join(',');
      const clear = button(d, 'Use default');
      clear.addEventListener('click', () => void this.clearFile(parameter).catch((error) => this.report(asError(error).message, 'bad')));
      drop.addEventListener('click', () => picker.click());
      drop.addEventListener('dragover', (event) => { event.preventDefault(); drop.classList.add('over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('over'));
      drop.addEventListener('drop', (event) => {
        event.preventDefault();
        event.stopPropagation();
        drop.classList.remove('over');
        const file = event.dataTransfer?.files?.[0];
        if (file) void this.dropFile(parameter, file).catch((error) => this.report(asError(error).message, 'bad'));
      });
      picker.addEventListener('change', () => {
        const file = picker.files?.[0];
        picker.value = '';
        if (file) void this.dropFile(parameter, file).catch((error) => this.report(asError(error).message, 'bad'));
      });
      refresh = () => {
        const dropped = this.files.get(parameter.id);
        const value = this.values[parameter.id] as { path?: string } | undefined;
        drop.textContent = dropped
          ? `${dropped.name} (stays in this browser)`
          : `${value?.path ? `Default: ${value.path.split('/').pop()}` : 'None'}. ${this.mobile ? 'Tap to choose a file' : 'Drop a file or click'}`;
        clear.hidden = !dropped;
      };
      wrap.append(drop, picker, clear);
    } else {
      const pre = el(d, 'pre');
      refresh = () => { pre.textContent = JSON.stringify(this.values[parameter.id]); };
      wrap.append(pre);
    }
    if (parameter.help) {
      const help = el(d, 'div', 'help');
      help.textContent = parameter.help;
      wrap.append(help);
    }
    if ((control === 'number' || control === 'slider' || control === 'int') && unit === '') readout.textContent = '';
    refresh();
    this.rows.set(parameter.id, { element: wrap, refresh });
    return wrap;
  }

  private refreshVisibility(): void {
    for (const parameter of this.parameters) {
      const row = this.rows.get(parameter.id);
      if (row) row.element.hidden = !isVisible(parameter, this.values);
    }
  }

  private async mountPanel(panel: EditorPanelModule): Promise<void> {
    const placement = this.editor.panel?.placement ?? 'extend';
    if (placement === 'replace') this.ui.groups.hidden = true;
    const dispose = await panel.mount(this.ui.panelSlot, this.api());
    if (typeof dispose === 'function') this.panelDispose = dispose;
  }
  private panelDispose?: () => void;

  // ---------------------------------------------------------------- values

  private changed(ids: readonly string[]): Promise<void> {
    for (const id of ids) this.rows.get(id)?.refresh();
    this.refreshVisibility();
    this.remember();
    for (const listener of this.listeners) listener({ ...this.values });
    const cooked = this.cook();
    cooked.catch(() => {});
    return cooked;
  }

  /** Stage several values; the next cook writes them. */
  private async assign(values: Readonly<Record<string, unknown>>): Promise<void> {
    for (const [id, value] of Object.entries(values)) {
      if (!this.byId.has(id) || value === undefined) continue;
      this.values[id] = value;
      this.pending.set(id, value);
    }
  }

  /** A phone starts dragging a slider: cook the declared draft values until it lets go. */
  private beginDraft(id: string): void {
    if (!this.mobile || this.drafting || !Object.keys(this.editor.draft ?? {}).length) return;
    this.drafting = id;
    this.draftWritten = false;
  }

  /** The drag ended: put the real values back and cook them. */
  private endDraft(): void {
    if (!this.drafting) return;
    const written = this.draftWritten;
    this.drafting = undefined;
    this.draftWritten = false;
    if (!written) return;
    for (const id of Object.keys(this.editor.draft ?? {}))
      if (this.byId.has(id)) this.pending.set(id, this.values[id]);
    void this.cook().catch(() => {});
  }

  /** Write staged values into the idle graph. Only ever called inside `exclusive`. */
  private async flush(): Promise<void> {
    const writes = [...this.pending].map(([id, value]) => {
      const parameter = this.byId.get(id)!;
      return [parameter.node, parameter.prop, value] as const;
    });
    this.pending.clear();
    if (this.drafting && !this.draftWritten) {
      for (const [id, value] of Object.entries(this.editor.draft ?? {})) {
        const parameter = this.byId.get(id);
        if (parameter && id !== this.drafting) writes.push([parameter.node, parameter.prop, value]);
      }
      this.draftWritten = true;
    }
    if (writes.length) await this.engine.setProps(writes);
  }

  /** Run one piece of graph work at a time, after any staged writes. */
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = this.tail.then(async () => {
      try { await this.flush(); }
      catch (error) { this.report(asError(error).message, 'bad'); }
      return work();
    });
    this.tail = run.then(() => {}, () => {});
    return run;
  }

  private async applyPreset(id: string): Promise<void> {
    const preset = (this.editor.presets ?? []).find((item) => item.id === id);
    const values: Record<string, unknown> = {};
    const keep = new Set(preset?.keep ?? []);
    for (const parameter of this.parameters)
      if (this.control(parameter) !== 'file' && !keep.has(parameter.id)) values[parameter.id] = this.defaults[parameter.id];
    Object.assign(values, preset?.values ?? {});
    await this.assign(values);
    this.changed([...this.rows.keys()]);
    this.report(preset ? `Preset: ${preset.label}` : 'Graph defaults', 'ok');
  }

  private async dropAnywhere(file: File): Promise<void> {
    if (file.name.endsWith('.json') || file.type === 'application/json') return this.openScene(file);
    const target = this.parameters.find((parameter) => this.control(parameter) === 'file' && accepts(parameter, file));
    if (!target) throw new Error(`Nothing here accepts ${file.name}`);
    await this.dropFile(target, file);
  }

  private async dropFile(parameter: PublishedParameter, file: File, remember = true): Promise<void> {
    if (!accepts(parameter, file)) throw new Error(`${parameter.label ?? parameter.id} accepts ${parameter.accept?.join(', ')}`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    await this.useFile(parameter, { name: file.name, mediaType: file.type || mediaTypeForName(file.name), bytes });
    if (remember) await rememberFile(this.editor.id, parameter.id, { name: file.name, mediaType: file.type, bytes });
  }

  private async useFile(parameter: PublishedParameter, file: DroppedFile): Promise<void> {
    const ref = await this.engine.writeAsset(file.bytes.slice(), { mediaType: file.mediaType, suggestedName: file.name });
    let value: unknown = ref;
    if (this.propTypes.get(`${parameter.node}\u0000${parameter.prop}`) === 'image') {
      const bitmap = await createImageBitmap(new Blob([file.bytes as BlobPart], { type: file.mediaType }));
      value = { path: ref.path, size: [bitmap.width, bitmap.height], channels: 'rgba', depth: 'u8', space: 'srgb' };
      bitmap.close();
    }
    file.scene = await sceneFile(parameter, file.bytes, file.name, file.mediaType);
    this.files.set(parameter.id, file);
    await this.set(parameter.id, value);
  }

  private async clearFile(parameter: PublishedParameter): Promise<void> {
    this.files.delete(parameter.id);
    await rememberFile(this.editor.id, parameter.id, null);
    await this.set(parameter.id, this.defaults[parameter.id]);
  }

  private async restoreRememberedFiles(): Promise<void> {
    for (const parameter of this.parameters) {
      if (this.control(parameter) !== 'file' || this.files.has(parameter.id)) continue;
      const stored = await recallFile(this.editor.id, parameter.id);
      if (!stored) continue;
      try { await this.useFile(parameter, stored); }
      catch (error) { this.report(`${parameter.label ?? parameter.id}: ${asError(error).message}`, 'warn'); }
    }
  }

  /** Bring files into play from a scene: embedded bytes, or a remembered file with the same hash. */
  private async restoreFiles(files: Readonly<Record<string, SceneFile>>, report = true): Promise<string[]> {
    const warnings: string[] = [];
    for (const [id, file] of Object.entries(files)) {
      const parameter = this.byId.get(id);
      if (!parameter) continue;
      if (file.data) {
        await this.useFile(parameter, { name: file.name, mediaType: file.mediaType, bytes: fromBase64(file.data) });
        continue;
      }
      const stored = await recallFile(this.editor.id, id);
      const storedHash = stored ? (await sceneFile({ ...parameter, embed: 'never' }, stored.bytes, stored.name)).sha256 : '';
      if (stored && storedHash === file.sha256) await this.useFile(parameter, stored);
      else warnings.push(`${parameter.label ?? id}: this scene used "${file.name}", which is not in this browser. Drop it to match.`);
    }
    if (report && warnings.length) this.report(warnings.join('\n'), 'warn');
    return warnings;
  }

  private async openScene(file: Blob): Promise<void> {
    const resolved = resolveScene(this.document, JSON.parse(await file.text()));
    const values: Record<string, unknown> = {};
    for (const parameter of this.parameters)
      if (this.control(parameter) !== 'file') values[parameter.id] = this.defaults[parameter.id];
    Object.assign(values, resolved.values);
    await this.assign(values);
    const fileWarnings = await this.restoreFiles(resolved.files, false);
    this.changed([...this.rows.keys()]);
    const warnings = [...resolved.warnings, ...fileWarnings];
    this.report(warnings.length ? warnings.join('\n') : 'Scene opened', warnings.length ? 'warn' : 'ok');
  }

  private currentScene(name?: string): CascadeScene {
    const values: Record<string, JsonValue> = {};
    const files: Record<string, SceneFile> = {};
    for (const parameter of this.parameters) {
      const dropped = this.files.get(parameter.id);
      if (dropped?.scene) files[parameter.id] = dropped.scene;
      else if (this.control(parameter) !== 'file' && this.values[parameter.id] !== undefined)
        values[parameter.id] = this.values[parameter.id] as JsonValue;
    }
    return createScene(this.document, { name, values, files, savedAt: new Date().toISOString() });
  }

  private async saveScene(): Promise<void> {
    const name = prompt('Scene name', 'scene')?.trim();
    if (!name) return;
    const scene = this.currentScene(name);
    await this.deliver(`${slug(name)}.scene.json`, new Blob([JSON.stringify(scene, null, 2)], { type: 'application/json' }));
  }

  private remember(): void {
    try {
      const scene = this.currentScene();
      const light = { ...scene, files: Object.fromEntries(Object.entries(scene.files ?? {}).map(([id, file]) => [id, { ...file, data: undefined }])) };
      localStorage.setItem(this.storageKey, JSON.stringify(light));
    } catch { /* storage unavailable: forget */ }
  }

  // ---------------------------------------------------------------- cooking

  private cook(): Promise<void> {
    if (this.queued && this.pendingCook) return this.pendingCook;
    this.queued = true;
    this.ui.shell.classList.add('busy');
    const run = this.exclusive(async () => {
      this.queued = false;
      const started = performance.now();
      try {
        if (this.inspecting) {
          const result = await this.engine.run({ reuse: true });
          if (result.status !== 'completed') throw new Error(result.messages.join('\n') || result.status);
        } else if (this.view) await this.runTarget(this.view);
        if (this.view) await this.show(await this.engine.output(this.view.node, this.view.port));
        if (this.inspecting) await this.renderInspect();
        const took = Math.round(performance.now() - started);
        this.ui.status.textContent = `${took} ms`;
        this.ui.menuStatus.textContent = `Last cook ${took} ms`;
        this.clearReport('bad');
      } catch (error) {
        this.report(asError(error).message, 'bad');
      } finally {
        if (!this.queued) this.ui.shell.classList.remove('busy');
      }
    });
    this.pendingCook = run;
    return run;
  }

  private async runTarget(output: PublishedOutput): Promise<void> {
    const result = await this.engine.run({ target: { kind: 'output', nodeId: output.node, outputName: output.port }, reuse: true });
    if (result.status !== 'completed') throw new Error(result.messages.join('\n') || `Cook ${result.status}`);
  }

  private async show(value: unknown): Promise<void> {
    const { element, release } = await this.render(value, 0, 0);
    this.viewRelease?.();
    this.viewRelease = release;
    this.ui.output.replaceChildren(element);
  }

  /** One output as an element: images and SVG as pictures, geometry drawn, anything else as JSON. */
  private async render(value: unknown, width: number, height: number): Promise<{ element: HTMLElement; release?: () => void }> {
    const d = this.root.ownerDocument;
    if (isSvgText(value)) {
      const url = URL.createObjectURL(new Blob([value], { type: 'image/svg+xml' }));
      const image = d.createElement('img');
      image.src = url;
      image.alt = 'SVG output';
      await image.decode().catch(() => {});
      return { element: image, release: () => URL.revokeObjectURL(url) };
    }
    if (isAssetRef(value) && isImageAsset(value)) {
      const bytes = await this.engine.readAsset(value);
      const type = ('mediaType' in value && value.mediaType) || mediaTypeForName(value.path) || 'image/png';
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
      const image = d.createElement('img');
      image.src = url;
      image.alt = value.path;
      await image.decode().catch(() => {});
      return { element: image, release: () => URL.revokeObjectURL(url) };
    }
    if (isGeometry(value) || isScene(value)) {
      const scene = isScene(value) ? value : sceneFromGeometry(value);
      const box = this.ui.viewer.getBoundingClientRect();
      const dark = d.defaultView?.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
      const ink: [number, number, number, number] = dark ? [0.92, 0.92, 0.92, 1] : [0.11, 0.11, 0.11, 1];
      return { element: renderSceneCanvas(d, scene, width || Math.max(320, Math.round(box?.width ?? 800)), height || Math.max(240, Math.round(box?.height ?? 600)), ink) };
    }
    const pre = d.createElement('pre');
    pre.textContent = summarise(value);
    return { element: pre };
  }

  private inspectReleases: (() => void)[] = [];

  private async renderInspect(): Promise<void> {
    const d = this.root.ownerDocument;
    for (const release of this.inspectReleases.splice(0)) release();
    const nodes = this.nodes;
    const outputs = await this.engine.outputs();
    const depth = (id: string | undefined): number => {
      let level = 0;
      let current = nodes.find((node) => node.id === id)?.parent;
      while (current) { level++; current = nodes.find((node) => node.id === current)?.parent; }
      return level;
    };
    const cards: HTMLElement[] = [];
    for (const node of nodes) {
      if (node.moduleId === 'cascade.core.Input' || node.moduleId === 'cascade.core.Output') continue;
      const card = el(d, 'div', 'ce-stage');
      if (depth(node.id)) card.classList.add('ce-indent');
      const title = el(d, 'h3');
      title.textContent = node.id;
      const module = el(d, 'div', 'mod');
      module.textContent = `${node.moduleId}${node.parent ? ` · in ${node.parent}` : ''}`;
      card.append(title, module);
      for (const [port, value] of outputs.get(node.id) ?? []) {
        const out = el(d, 'div', 'out');
        const name = el(d, 'span');
        name.textContent = port;
        const { element, release } = await this.render(value, 220, 140);
        if (release) this.inspectReleases.push(release);
        out.append(name, element);
        card.append(out);
      }
      cards.push(card);
    }
    this.ui.inspect.replaceChildren(...cards);
  }

  private async exportOutput(output: PublishedOutput): Promise<void> {
    this.ui.status.textContent = `Exporting ${output.label ?? output.id}…`;
    const value = await this.exclusive(async () => {
      await this.runTarget(output);
      return this.engine.output(output.node, output.port);
    });
    const blob = await this.toBlob(value, output);
    const scene = slug(this.editor.id);
    const extension = output.format === 'text' ? 'txt' : output.format;
    const name = (output.filename ?? `{scene}-{id}.${extension}`).split('{id}').join(output.id).split('{scene}').join(scene);
    await this.deliver(name, blob);
  }

  /**
   * Hand a file over: a download on a desktop, the share sheet on a phone (Save
   * to Files, Photos, AirDrop), falling back to a download. When the cook took
   * longer than the browser lets a tap count, the toast offers a fresh tap.
   */
  private async deliver(name: string, blob: Blob): Promise<void> {
    const d = this.root.ownerDocument;
    const save = () => download(d, name, blob);
    if (!this.mobile) {
      save();
      this.report(`Saved ${name}`, 'ok');
      return;
    }
    const result = await shareFile(name, blob, save);
    if (result === 'needs-tap')
      this.toast(`${name} is ready`, 'Share', () => void shareFile(name, blob, save).then((again) => {
        if (again === 'downloaded') this.report(`Saved ${name}`, 'ok');
      }));
    else if (result === 'downloaded') this.report(`Saved ${name}`, 'ok');
    else this.ui.status.textContent = result === 'shared' ? `Shared ${name}` : '';
  }

  private async toBlob(value: unknown, output: PublishedOutput): Promise<Blob> {
    if (value instanceof Blob) return value;
    if (isAssetRef(value)) {
      const bytes = await this.engine.readAsset(value);
      return new Blob([bytes as BlobPart], { type: ('mediaType' in value && value.mediaType) || mediaTypeForName(value.path) || 'application/octet-stream' });
    }
    if (typeof value === 'string')
      return new Blob([value], { type: output.format === 'svg' ? 'image/svg+xml' : 'text/plain;charset=utf-8' });
    if (output.format === 'png' && (isGeometry(value) || isScene(value))) {
      const scene = isScene(value) ? value : sceneFromGeometry(value);
      return canvasBlob(renderSceneCanvas(this.root.ownerDocument, scene, 2048, 2048));
    }
    return new Blob([JSON.stringify(value, jsonReplacer, 2)], { type: 'application/json' });
  }

  // ---------------------------------------------------------------- phones

  private setupTouch(): void {
    const win = this.root.ownerDocument.defaultView;
    const query = win?.matchMedia?.(PHONE);
    const update = () => this.applyMode(query?.matches ?? false, (win?.innerWidth ?? 0) > (win?.innerHeight ?? 0));
    query?.addEventListener?.('change', update);
    win?.addEventListener('resize', update);
    attachZoom(this.ui.surface, this.ui.output, () => this.mobile);
    attachSheet(this.ui.head, {
      enabled: () => this.mobile && !this.landscape,
      height: () => this.sheetHeight,
      snaps: () => this.snaps(),
      onHeight: (height, settled) => this.setSheet(height, settled),
    });
    // The peek grows when a message or a longer text appears: follow it while resting there.
    if (typeof ResizeObserver !== 'undefined')
      new ResizeObserver(() => { if (this.mobile && !this.landscape && this.snapIndex === 0) this.setSheet(this.snaps()[0]!, false); }).observe(this.ui.head);
    update();
  }

  private applyMode(mobile: boolean, landscape: boolean): void {
    const changed = mobile !== this.mobile;
    this.mobile = mobile;
    this.landscape = mobile && landscape;
    this.ui.shell.classList.toggle('m', mobile);
    this.ui.shell.classList.toggle('land', this.landscape);
    if (changed) {
      this.placePeek(mobile);
      // A phone opens with the groups folded, so the sheet reads as a list of sections.
      if (mobile && !this.groupsFolded) {
        this.groupsFolded = true;
        for (const details of this.ui.groups.querySelectorAll('details')) details.open = false;
      }
      for (const row of this.rows.values()) row.refresh();
    }
    if (mobile && !this.landscape) this.setSheet(this.snaps()[Math.min(this.snapIndex, 2)]!, false);
    else {
      this.ui.shell.style.removeProperty('--ce-sheet');
      this.ui.shell.style.removeProperty('--ce-cut');
    }
  }

  /** The parameters kept in reach at the peek: declared, else the first text and seed. */
  private peekIds(): string[] {
    if (this.editor.peek) return this.editor.peek.filter((id) => this.byId.has(id));
    const ids: string[] = [];
    const text = this.parameters.find((parameter) => ['text', 'textarea'].includes(this.control(parameter)));
    const seed = this.parameters.find((parameter) => this.control(parameter) === 'seed');
    for (const parameter of this.parameters) if (parameter === text || parameter === seed) ids.push(parameter.id);
    return ids;
  }

  /** Move the peek rows into the sheet's head on a phone, and back to their groups otherwise. */
  private placePeek(mobile: boolean): void {
    const d = this.root.ownerDocument;
    for (const id of this.peekIds()) {
      const row = this.rows.get(id)?.element;
      if (!row) continue;
      if (mobile && row.parentElement !== this.ui.peek) {
        const slot = d.createComment(`peek:${id}`);
        row.before(slot);
        this.peekSlots.set(id, slot);
        this.ui.peek.append(row);
      } else if (!mobile) {
        const slot = this.peekSlots.get(id);
        if (slot) { slot.replaceWith(row); this.peekSlots.delete(id); }
      }
    }
  }

  /** Peek, half and full heights of the sheet, in px. */
  private snaps(): [number, number, number] {
    const shell = this.ui.shell.clientHeight || this.root.ownerDocument.defaultView?.innerHeight || 800;
    const inset = parseFloat(getComputedStyle(this.ui.side).paddingBottom) || 0;
    const peek = Math.min(Math.round(this.ui.head.scrollHeight + inset + 1), Math.round(shell * 0.45));
    const full = Math.max(peek, shell - this.ui.bar.offsetHeight - 8);
    const half = Math.min(full, Math.max(peek + 96, Math.round(shell * 0.55)));
    return [peek, half, full];
  }

  private setSheet(height: number, settled: boolean): void {
    const snaps = this.snaps();
    this.sheetHeight = height;
    this.ui.side.classList.toggle('settle', settled);
    this.ui.shell.style.setProperty('--ce-sheet', `${Math.round(height)}px`);
    // The preview sits above the sheet up to half height; a full sheet covers it.
    this.ui.shell.style.setProperty('--ce-cut', `${Math.round(Math.min(height, snaps[1]))}px`);
    if (settled) {
      this.snapIndex = snaps.reduce((best, snap, index) => (Math.abs(snap - height) < Math.abs(snaps[best]! - height) ? index : best), 0);
      this.ui.side.dataset.snap = ['peek', 'half', 'full'][this.snapIndex];
    }
  }

  private toast(text: string, action?: string, run?: () => void): void {
    this.ui.toastText.textContent = text;
    this.ui.toastAction.hidden = !action;
    this.ui.toastAction.textContent = action ?? '';
    this.ui.toastAction.onclick = run ? () => { this.ui.toast.classList.remove('on'); run(); } : null;
    this.ui.toast.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.ui.toast.classList.remove('on'), action ? 8000 : 2200);
  }

  // ---------------------------------------------------------------- messages

  private report(text: string, kind: 'ok' | 'warn' | 'bad'): void {
    const d = this.root.ownerDocument;
    this.clearReport(kind);
    if (kind === 'ok') {
      this.ui.status.textContent = text;
      if (this.mobile) this.toast(text);
      return;
    }
    this.ui.messages.append(message(d, text, kind));
  }

  private clearReport(kind: string): void {
    for (const child of [...this.ui.messages.children]) if (child.classList.contains(kind)) child.remove();
  }
}


function el(d: Document, tag: string, className?: string): HTMLElement {
  const element = d.createElement(tag);
  if (className) element.className = className;
  return element;
}

function button(d: Document, text: string): HTMLButtonElement {
  const element = d.createElement('button');
  element.type = 'button';
  element.textContent = text;
  return element;
}

function option(d: Document, value: string, label: string): HTMLOptionElement {
  const element = d.createElement('option');
  element.value = value;
  element.textContent = label;
  return element;
}

function message(d: Document, text: string, kind: string): HTMLElement {
  const element = el(d, 'div', `ce-msg ${kind}`);
  element.setAttribute('role', kind === 'bad' ? 'alert' : 'status');
  element.textContent = text;
  return element;
}

function accepts(parameter: PublishedParameter, file: File): boolean {
  const accept = parameter.accept ?? [];
  if (!accept.length) return true;
  const name = file.name.toLowerCase();
  return accept.some((rule) => {
    const lower = rule.toLowerCase();
    if (lower.startsWith('.')) return name.endsWith(lower);
    if (lower.endsWith('/*')) return file.type.startsWith(lower.slice(0, -1));
    return file.type === lower;
  });
}

function summarise(value: unknown): string {
  if (value === undefined) return 'No output';
  if (ArrayBuffer.isView(value)) return `${value.constructor.name} (${(value as unknown as ArrayLike<number>).length})`;
  const text = JSON.stringify(value, (key, item) => {
    if (ArrayBuffer.isView(item)) return `${item.constructor.name}(${(item as unknown as ArrayLike<number>).length})`;
    if (Array.isArray(item) && item.length > 24) return [...item.slice(0, 24), `… ${item.length - 24} more`];
    return item;
  }, 2) ?? String(value);
  return text.length > 4000 ? `${text.slice(0, 4000)}\n…` : text;
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'scene';
}

function download(d: Document, name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = d.createElement('a');
  link.href = url;
  link.download = name;
  d.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function hexToRgba(hex: string): number[] {
  const value = parseInt(hex.slice(1, 7), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255, 1];
}

function rgbaToHex(value: readonly number[]): string {
  return `#${value.slice(0, 3).map((part) => Math.round(Math.max(0, Math.min(1, part)) * 255).toString(16).padStart(2, '0')).join('')}`;
}

function readLocal(key: string): CascadeScene | undefined {
  try {
    const text = localStorage.getItem(key);
    return text ? JSON.parse(text) : undefined;
  } catch { return undefined; }
}

// Dropped files are remembered in this browser only, so a font need not be dropped every visit.
const DB = 'cascade-editor';
const STORE = 'files';

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function rememberFile(editor: string, id: string, file: DroppedFile | null): Promise<void> {
  try {
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      const store = transaction.objectStore(STORE);
      if (file) store.put({ name: file.name, mediaType: file.mediaType, bytes: file.bytes }, `${editor}:${id}`);
      else store.delete(`${editor}:${id}`);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch { /* storage unavailable: forget */ }
}

async function recallFile(editor: string, id: string): Promise<DroppedFile | null> {
  try {
    const db = await database();
    return await new Promise((resolve) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(`${editor}:${id}`);
      request.onsuccess = () => resolve((request.result as DroppedFile | undefined) ?? null);
      request.onerror = () => resolve(null);
    });
  } catch { return null; }
}
