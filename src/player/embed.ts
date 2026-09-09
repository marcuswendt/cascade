import type { MountPlayerOptions, PlayerController } from './types.js';

export type {
  MountPlayerOptions,
  PlayerController,
  PlayerEvent,
  PlayerListener,
  PlayerOutputSelection,
} from './types.js';

interface PlayerWindow extends Window {
  cascadePlayerReady?: Promise<PlayerController> | PlayerController;
}

/** Mount a built player in a realm-isolated same-origin iframe. */
export async function mountPlayer(
  container: HTMLElement,
  options: MountPlayerOptions,
): Promise<PlayerController> {
  const hostDocument = container.ownerDocument;
  const hostWindow = hostDocument.defaultView;
  if (!hostWindow) throw new Error('Cascade player mount requires a browser window');
  const url = new URL(String(options.url), hostDocument.baseURI);
  if (url.origin !== hostWindow.location.origin) {
    throw new Error(
      'Programmatic Cascade player mounts must be same-origin; use ordinary iframe markup for cross-origin embeds',
    );
  }
  setQueryOption(url, 'frame', options.frame ?? 1);
  setQueryOption(url, 'fps', options.fps ?? 30);
  url.searchParams.set('autoplay', options.autoplay ? '1' : '0');
  if (options.output) {
    url.searchParams.set('outputNode', options.output.nodeId);
    url.searchParams.set('outputPort', options.output.port);
  } else {
    url.searchParams.delete('outputNode');
    url.searchParams.delete('outputPort');
  }

  const iframe = hostDocument.createElement('iframe');
  iframe.src = url.href;
  iframe.title = 'Cascade player';
  iframe.loading = 'eager';
  Object.assign(iframe.style, { display: 'block', width: '100%', height: '100%', border: '0' });
  iframe.setAttribute('allow', 'fullscreen');
  container.append(iframe);

  try {
    await iframeLoaded(iframe);
    const child = iframe.contentWindow as PlayerWindow | null;
    const ready = child?.cascadePlayerReady;
    if (!ready) throw new Error('Cascade player did not expose cascadePlayerReady');
    const controller = await ready;
    let disposed = false;
    return {
      play: () => controller.play(),
      pause: () => controller.pause(),
      seek: (frame) => controller.seek(frame),
      setInput: (nodeId, name, value) => controller.setInput(nodeId, name, value),
      setProp: (nodeId, name, value) => controller.setProp(nodeId, name, value),
      getOutput: (nodeId, port) => controller.getOutput(nodeId, port),
      selectOutput: (nodeId, port) => controller.selectOutput(nodeId, port),
      downloadOutput: () => controller.downloadOutput(),
      resize: (width, height) => controller.resize(width, height),
      subscribe: (listener) => controller.subscribe(listener),
      async dispose() {
        if (disposed) return;
        disposed = true;
        try { await controller.dispose(); } finally { iframe.remove(); }
      },
    };
  } catch (error) {
    iframe.remove();
    throw error;
  }
}

function setQueryOption(url: URL, name: string, value: number | undefined): void {
  if (value === undefined) return;
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  url.searchParams.set(name, String(value));
}

function iframeLoaded(iframe: HTMLIFrameElement): Promise<void> {
  return new Promise((resolve, reject) => {
    iframe.addEventListener('load', () => resolve(), { once: true });
    iframe.addEventListener('error', () => reject(new Error(`Could not load Cascade player ${iframe.src}`)), {
      once: true,
    });
  });
}
