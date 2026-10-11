import type { SelectOption } from "./definition.js";
import type { JsonValue } from "./values.js";

/**
 * The shareable editor a graph declares: which parameters someone else may
 * change, which outputs they may export, the presets they may start from, and
 * the assets that are allowed to leave the project with it.
 *
 * It sits beside `nodes` in the document, like Houdini's parameter interface on
 * a digital asset sits beside its network. The runtime ignores it: a published
 * parameter is an ordinary prop with a label, so a headless render, Studio and
 * the exported editor cook the same graph. Only `cascade export`, the editor
 * shell and scene files read it.
 *
 * Everything here is an allowlist. A parameter, output or asset that is not
 * named does not reach the exported site, and a scene file carries values for
 * named parameters only. That is the boundary a share relies on: an export is
 * the selected subgraph plus the selected assets, never the project.
 */
export interface EditorDeclaration {
  /** Stable identity of the editor, written into every scene. `cloud-type`. */
  readonly id: string;
  readonly title?: string;
  readonly description?: string;
  /** Group names in display order. Groups not listed follow, in first-use order. */
  readonly groups?: readonly string[];
  readonly parameters?: readonly PublishedParameter[];
  readonly outputs?: readonly PublishedOutput[];
  readonly presets?: readonly EditorPreset[];
  /**
   * Project-relative files the author selects to ship. Literal asset values of
   * published parameters are included too; nothing else is. A path inside a
   * `licensed/` directory, a hidden file, or a gitignored file is refused.
   */
  readonly assets?: readonly string[];
  /**
   * Data-source nodes replaced by a snapshot of chosen values. A live source
   * (server, files, Python, shell or a `source: "live"` definition) still wired
   * into the exported subgraph fails the export.
   */
  readonly freeze?: readonly FrozenSource[];
  /** Optional project panel module that extends or replaces the generated UI. */
  readonly panel?: EditorPanelDeclaration;
  /** The read-only stage view. On unless the author turns it off. */
  readonly inspect?: boolean;
}

export type PublishedControl =
  | "number"
  | "slider"
  | "int"
  | "bool"
  | "select"
  | "text"
  | "textarea"
  | "color"
  | "file"
  | "seed"
  | "vec2";

export interface PublishedParameter {
  /** Scene key. Stable across renames of the node or the prop it targets. */
  readonly id: string;
  /** The node and prop whose value this parameter sets. */
  readonly node: string;
  readonly prop: string;
  readonly label?: string;
  readonly group?: string;
  readonly order?: number;
  readonly help?: string;
  readonly unit?: string;
  /** Overrides the control the prop's type implies. */
  readonly control?: PublishedControl;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly options?: readonly SelectOption<"string">[] | readonly SelectOption<"float">[];
  /** File parameters: accepted extensions or media types (`.otf`, `image/*`). */
  readonly accept?: readonly string[];
  /**
   * File parameters: whether a dropped file may travel inside a scene.
   * `never` keeps it to a name and a hash (licensed fonts); `auto` embeds files
   * up to 2 MB. Dropped files never leave the viewer's browser otherwise.
   */
  readonly embed?: "never" | "auto";
  /** Shown only when other parameters have these values; a list must all hold. */
  readonly visibleWhen?: VisibleWhen | readonly VisibleWhen[];
}

export type VisibleWhen = Readonly<{ param: string; equals?: JsonValue; in?: readonly JsonValue[]; not?: readonly JsonValue[] }>;

export type PublishedOutputFormat = "png" | "svg" | "json" | "text";

export interface PublishedOutput {
  readonly id: string;
  readonly node: string;
  readonly port: string;
  readonly label?: string;
  readonly format: PublishedOutputFormat;
  /** Download name; `{id}` and `{scene}` are replaced. */
  readonly filename?: string;
  /** Published parameter ids shown beside this output's button (dpi, ground). */
  readonly parameters?: readonly string[];
  /** The output shown in the viewer. One output should set it. */
  readonly view?: boolean;
}

export interface EditorPreset {
  readonly id: string;
  readonly label: string;
  /** Published parameter id to value. Missing parameters take their defaults. */
  readonly values: Readonly<Record<string, JsonValue>>;
  /** Parameters the preset leaves as they are (colour, pen) instead of resetting them. */
  readonly keep?: readonly string[];
}

export interface FrozenSource {
  /** The live node the snapshot replaces. Everything upstream of it is dropped. */
  readonly node: string;
  readonly output: string;
  /** Project-relative snapshot written by `cascade freeze`. */
  readonly snapshot: string;
}

export interface EditorPanelDeclaration {
  /** Project-relative module exporting `mount(target, api)`. */
  readonly module: string;
  /** `extend` (default) mounts it above the generated parameters. */
  readonly placement?: "extend" | "replace";
}

/** What `cascade freeze` writes: exactly the chosen values, nothing else. */
export interface FrozenSnapshot {
  readonly format: "cascade.frozen";
  readonly version: 1;
  readonly node: string;
  readonly output: string;
  readonly fields: readonly string[];
  /** Fields the author marked as personal, flagged in every export plan. */
  readonly personal?: readonly string[];
  readonly value: JsonValue;
  /** Project-relative files the value refers to, copied beside the snapshot. */
  readonly files?: readonly string[];
  readonly frozenAt: string;
}

/**
 * A scene: what someone changed in an editor, as a file that opens onto the
 * same graph in Studio, the CLI or the exported editor.
 *
 * It holds published parameter values and the files the person dropped, and
 * nothing from the project. Version mismatches degrade: unknown parameters are
 * ignored with a warning, missing ones take the graph's defaults.
 */
export interface CascadeScene {
  readonly format: "cascade.scene";
  readonly version: 1;
  readonly graph: Readonly<{ id: string; version: string }>;
  readonly name?: string;
  readonly values: Readonly<Record<string, JsonValue>>;
  /** Files for `file` parameters, by parameter id. */
  readonly files?: Readonly<Record<string, SceneFile>>;
  readonly savedAt?: string;
}

export interface SceneFile {
  readonly name: string;
  readonly mediaType?: string;
  readonly size: number;
  /** Hex SHA-256 of the bytes, to match a file the receiver already has. */
  readonly sha256: string;
  /** Base64 bytes, present only when the parameter allows embedding. */
  readonly data?: string;
}

export const SCENE_EMBED_LIMIT = 2 * 1024 * 1024;
