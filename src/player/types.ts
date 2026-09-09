export interface PlayerOutputSelection {
  readonly nodeId: string;
  readonly port: string;
}

export type PlayerEvent =
  | { readonly type: 'frame'; readonly frame: number }
  | { readonly type: 'playing'; readonly playing: boolean }
  | { readonly type: 'error'; readonly error: Error };

export type PlayerListener = (event: PlayerEvent) => void;

export interface PlayerController {
  play(): void;
  pause(): void;
  seek(frame: number): Promise<void>;
  setInput(nodeId: string, name: string, value: unknown): Promise<void>;
  setProp(nodeId: string, name: string, value: unknown): Promise<void>;
  getOutput(nodeId: string, port: string): unknown;
  selectOutput(nodeId: string, port: string): Promise<void>;
  downloadOutput(): Promise<Blob>;
  resize(width: number, height: number): void;
  subscribe(listener: PlayerListener): () => void;
  dispose(): Promise<void>;
}

export interface MountPlayerOptions {
  readonly url: string | URL;
  readonly frame?: number;
  readonly fps?: number;
  readonly autoplay?: boolean;
  readonly output?: PlayerOutputSelection;
}
