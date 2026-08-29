/** Metadata Cascade can discover without importing trusted project code. */
export interface ProjectPanelMeta {
  name: string;
  title: string;
  icon: string | null;
  rendererTypes?: string[];
}

export interface ProjectPanelApi {
  runStage<T = unknown>(stage: string, args: Record<string, unknown>): Promise<T>;
  mediaUrl(path: string, options?: { width?: number; raw?: boolean }): string;
  getParam<T = unknown>(nodeId: string, name: string): T | undefined;
  setParam(nodeId: string, name: string, value: unknown): void;
  selectedNodeId(): string | null;
  readonly sourceNodeId: string | null;
  readonly signal: AbortSignal;
  close(): void;
}

export interface ProjectValueRendererProps {
  value: unknown;
  readOnly: boolean;
  mode: 'compact' | 'inspect' | 'view';
  onChange: ((value: unknown) => void) | null;
}

export interface ProjectValueRendererInstance {
  update?(props: ProjectValueRendererProps): void;
  dispose(): void;
}

export interface ProjectValueRenderer {
  mount(element: HTMLElement, props: ProjectValueRendererProps):
    | void
    | (() => void)
    | ProjectValueRendererInstance
    | Promise<void | (() => void) | ProjectValueRendererInstance>;
}

export interface ProjectPanelModule {
  title?: string;
  icon?: string;
  mount(element: HTMLElement, api: ProjectPanelApi):
    | void
    | (() => void)
    | Promise<void | (() => void)>;
  renderers?: Record<string, ProjectValueRenderer>;
}
