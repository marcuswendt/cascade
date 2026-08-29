<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import type { Graph } from '@/nodes/Graph';
  import type { Node } from '@/nodes/Node';
  import type { Annotation } from '@/nodes/annotations/Annotation';
  import { ImageBuffer } from '@/nodes/lens/ImageBuffer';
  import ChatNodeContent from './components/ai/ChatNodeContent.svelte';
  import type { ChatNode } from '@/nodes/quill/nodes/ChatNode';
  import { propUpdateCounters } from './stores/propUpdateStore';
  import { coerceImageRef, normalizeType, typeColor } from '@/types/coreTypes';
  import CoreValue from './components/CoreValue.svelte';
  import { inferCascadeType, mediaUrl } from './components/typePresentation';

  export let graph: Graph | undefined;
  export let selectedNode: Node | null = null;
  export let selectedAnnotation: Annotation | null = null;

  let container: HTMLDivElement;
  let chatViewerElement: HTMLDivElement;
  let currentViewer: 'canvas' | 'image' | 'text' | 'typed' | 'chat' | 'empty' = 'empty';
  let displayNode: Node | null = null;
  let displayAnnotation: Annotation | null = null;
  let activeOutputId: string | null = null;
  let typedVersion = 0;
  let portsVersion = 0;
  let portsFingerprint = '';

  // Track what's currently rendered to avoid unnecessary DOM updates (prevents flickering)
  let lastRenderedId: string | null = null;
  let lastRenderedContent: string | null = null;
  let lastRenderedViewer: string | null = null;

  // Determine which node/annotation to display
  $: {
    // Priority: selected annotation > selected node > cooking nodes
    if (selectedAnnotation) {
      displayAnnotation = selectedAnnotation;
      displayNode = null;
    } else if (selectedNode) {
      displayNode = selectedNode;
      displayAnnotation = null;
    } else if (graph) {
      // Try to get first cooking node
      const cookingNodesArray = Array.from(graph.cookingNodes || []) as Node[];
      if (cookingNodesArray.length > 0) {
        displayNode = cookingNodesArray[0];
      } else {
        displayNode = null;
      }
      displayAnnotation = null;
    } else {
      displayNode = null;
      displayAnnotation = null;
    }
  }

  // Watch for cooking nodes changes
  $: if (graph) {
    // Force reactivity when cooking nodes change
    const _ = graph.cookingNodes?.size;
  }

  // Check if display node is a Chat node (handle both short and full type names)
  $: isChatNode = displayNode?.type === 'Chat' || displayNode?.type?.endsWith('.Chat');

  // Watch prop update counter to force reactivity when props change
  let chatPropsUpdateCounter = 0;
  $: {
    const counters = $propUpdateCounters;
    chatPropsUpdateCounter = displayNode ? (counters.get(displayNode.id) || 0) : 0;
  }

  // Include chatPropsUpdateCounter to force re-read when props change
  $: chatNodeState = isChatNode && displayNode && chatPropsUpdateCounter >= 0 ? (displayNode as ChatNode).getState() : null;
  // Depend on chatNodeState to ensure reactivity when node state changes
  $: chatConversation = (isChatNode && displayNode && chatNodeState) ? (displayNode as ChatNode).getConversation() : [];

  // Track last displayed chat node to trigger scroll on selection change
  let lastDisplayedChatNodeId: string | null = null;

  // Scroll to the last user message when a chat node is selected
  $: if (isChatNode && displayNode && displayNode.id !== lastDisplayedChatNodeId) {
    lastDisplayedChatNodeId = displayNode.id;
    scrollToLastUserMessage();
  } else if (!isChatNode) {
    // Reset when switching to non-chat node so scroll triggers when returning
    lastDisplayedChatNodeId = null;
  }

  async function scrollToLastUserMessage() {
    // Wait for DOM to update
    await tick();

    if (!chatViewerElement) return;

    // Find the last user message in the conversation
    const userMessages = chatViewerElement.querySelectorAll('.message.user');
    if (userMessages.length > 0) {
      const lastUserMessage = userMessages[userMessages.length - 1] as HTMLElement;
      lastUserMessage.scrollIntoView({ behavior: 'instant', block: 'start' });
    } else {
      // No user messages yet, scroll to top
      chatViewerElement.scrollTop = 0;
    }
  }

  /**
   * A node that produced an image on disk emits a project-relative PATH, not a
   * DOM image — the pipeline nodes here all do (`path`, `png_path`, and so on).
   * Those never reached the viewer before: a raw path resolved against the app's
   * own origin and came back as index.html, so every render showed as broken or
   * as "No preview available".
   */
  // .npy is here on purpose: the mask, signal, height and density stages emit a
  // float array, and the media route renders one to greyscale. Without it those
  // stages — nine of the twenty-two in cloud-plots — have no picture at all, and
  // a pipeline you can't look at halfway through isn't inspectable.
  /** Zoom and pan per node+image, so a re-cook doesn't throw away where you
   *  were looking. Cleared naturally when the page reloads. */
  const viewState = new Map<string, { scale: number; offset: { x: number; y: number }; fitScale: number; userAdjusted: boolean }>();

  const IMAGE_PATH = /\.(png|jpe?g|webp|gif|tiff?|avif|svg|npy)$/i;
  const PATH_PORTS = [
    'path', 'preview', 'image', 'png_path', 'output', 'svg_path',
    'field', 'mask', 'height', 'shading', 'density', 'points',
  ];

  function currentOutputs(version: number): any[] {
    void version;
    return displayNode?.outputs?.filter((port: any) => port.value !== undefined) ?? [];
  }

  $: outputPorts = currentOutputs(portsVersion);
  $: {
    const current = outputPorts.find((port: any) => port.id === activeOutputId);
    if (!current) {
      const preferred = PATH_PORTS
        .map(name => outputPorts.find((port: any) => port.name === name))
        .find(Boolean);
      activeOutputId = preferred?.id ?? outputPorts[0]?.id ?? null;
    }
  }
  $: activeOutput = outputPorts.find((port: any) => port.id === activeOutputId) ?? null;
  $: activeOutputType = activeOutput
    ? (normalizeType(activeOutput.dataType) === 'any' ? inferCascadeType(activeOutput.value) : normalizeType(activeOutput.dataType))
    : 'any';

  function valueFingerprint(value: any): string {
    if (value === undefined) return 'undefined';
    if (value === null) return 'null';
    if (typeof value !== 'object') return `${typeof value}:${String(value).slice(0, 80)}`;
    const image = coerceImageRef(value);
    if (image) return `image:${image.path}:${image.size.join('x')}`;
    if (Array.isArray(value)) return `array:${value.length}`;
    return `object:${value.width ?? ''}x${value.height ?? ''}:${value.size?.join?.('x') ?? ''}`;
  }

  function refreshPorts() {
    const next = displayNode
      ? `${displayNode.id}:${displayNode.cookInfo?.cookCount ?? 0}:${displayNode.outputs?.map((port: any) => `${port.id}=${valueFingerprint(port.value)}`).join('|')}`
      : '';
    if (next !== portsFingerprint) {
      portsFingerprint = next;
      portsVersion += 1;
    }
  }

  function imagePathFromValue(value: unknown): string | null {
    const image = coerceImageRef(value);
    return image && (typeof value !== 'string' || IMAGE_PATH.test(image.path)) ? image.path : null;
  }

  function findImagePath(node: any): string | null {
    if (!node?.outputs) return null;
    if (node === displayNode && activeOutput) {
      const activePath = imagePathFromValue(activeOutput.value);
      if (activePath) return activePath;
    }
    const named = PATH_PORTS
      .map(name => node.outputs.find((p: any) => p.name === name))
      .find((port: any) => imagePathFromValue(port?.value));
    if (named) return imagePathFromValue(named.value);
    const any = node.outputs.find((port: any) => imagePathFromValue(port?.value));
    return any ? imagePathFromValue(any.value) : null;
  }

  /** Display width in real device pixels, so the preview is sharp on a retina
   * display without ever fetching the full-resolution file. */
  function displayWidth(): number {
    const css = container?.clientWidth || 800;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    return Math.max(320, Math.min(3000, Math.round(css * dpr)));
  }

  // Determine viewer type based on node/annotation
  $: {
    if (displayAnnotation) {
      // Handle annotation display
      const annType = displayAnnotation.type;
      if (annType === 'Image') {
        // Check if image annotation has loaded image in output port
        const outputPort = displayAnnotation.outputs?.find(p => p.name === 'image');
        if (outputPort?.value instanceof HTMLImageElement) {
          currentViewer = 'image';
        } else if ((displayAnnotation as any).src) {
          // Has src but image not loaded yet - still show as image
          currentViewer = 'image';
        } else {
          currentViewer = 'empty';
        }
      } else if (annType === 'Text') {
        currentViewer = 'text';
      } else {
        currentViewer = 'empty';
      }
    } else if (!displayNode) {
      currentViewer = 'empty';
    } else if (displayNode.type === 'Chat' || displayNode.type.endsWith('.Chat')) {
      // Chat nodes get special viewer
      currentViewer = 'chat';
    } else {
      portsVersion;
      // The selected output decides the view. Every other core value uses the
      // shared Svelte presentation layer rather than a JSON/text fallback.
    const outputPort = activeOutput;
      if (outputPort && outputPort.value !== undefined) {
        if (outputPort.value instanceof HTMLCanvasElement || outputPort.value instanceof ImageBuffer) {
          currentViewer = 'canvas';
        } else if (outputPort.value instanceof HTMLImageElement) {
          currentViewer = 'image';
        } else if (activeOutputType === 'image' && imagePathFromValue(outputPort.value)) {
          currentViewer = 'image';
        } else {
          currentViewer = 'typed';
        }
      } else if (displayNode.preview) {
        // Fall back to preview property
        if (displayNode.preview instanceof HTMLCanvasElement) {
          currentViewer = 'canvas';
        } else if (displayNode.preview instanceof HTMLImageElement) {
          currentViewer = 'image';
        } else {
          currentViewer = 'text';
        }
      } else if (findImagePath(displayNode)) {
        currentViewer = 'image';
      } else {
        currentViewer = 'empty';
      }
    }
  }

  // Render canvas viewer
  function renderCanvas() {
    if (!container || !displayNode) return;

    container.innerHTML = '';

    let canvas: HTMLCanvasElement | null = null;

    // First check output ports directly (bypasses throttled preview for immediate updates)
      const outputPort = activeOutput;
    if (outputPort?.value) {
      if (outputPort.value instanceof HTMLCanvasElement) {
        canvas = outputPort.value;
      } else if (outputPort.value instanceof ImageBuffer) {
        // Convert ImageBuffer to canvas on-demand (bypasses throttled preview)
        canvas = outputPort.value.toCanvas();
      }
    }

    // Fall back to preview property if no output port canvas
    if (!canvas && displayNode.preview instanceof HTMLCanvasElement) {
      canvas = displayNode.preview;
    }

    if (canvas) {
      const wrapper = document.createElement('div');
      wrapper.className = 'canvas-viewer';
      wrapper.style.width = '100%';
      wrapper.style.height = '100%';
      wrapper.style.display = 'flex';
      wrapper.style.alignItems = 'center';
      wrapper.style.justifyContent = 'center';
      wrapper.style.background = '#0a0a0a';

      const img = document.createElement('img');
      img.src = canvas.toDataURL();
      img.style.maxWidth = '100%';
      img.style.maxHeight = '100%';
      img.style.objectFit = 'contain';
      wrapper.appendChild(img);

      container.appendChild(wrapper);
    }
  }

  /**
   * A stage output you can actually inspect: pan, zoom, and at 100% or above
   * the pixels the stage really produced rather than a fitted-down copy.
   *
   * Checking a render for artifacts is the reason you step through a graph one
   * stage at a time, and a fit-to-frame thumbnail cannot answer that question.
   * So the image is re-requested at the resolution the current zoom needs — the
   * server resizes and re-encodes per request, which is what makes that
   * affordable — and never above the file's own resolution.
   */
  /** The image path the viewer should currently be showing, or null when the
   *  current selection isn't a file-backed image. */
  function mountedSourceFor(): string | null {
    if (displayAnnotation) return null;
    if (!displayNode) return null;
    if (displayNode.preview instanceof HTMLImageElement) return null;
    return findImagePath(displayNode);
  }

  function buildZoomableImage(wrapper: HTMLElement, source: string, version?: number) {
    wrapper.style.position = 'relative';
    wrapper.style.overflow = 'hidden';
    wrapper.style.cursor = 'grab';

    const img = document.createElement('img');
    img.alt = source;
    img.draggable = false;
    img.dataset.cascadeSrc = source;
    // Hidden until the first fit. Without this the browser paints the image at
    // its intrinsic size for a frame before the layout is applied, which on a
    // 1400px render is a full-size flash — and because the viewer rebuilds on
    // re-cook, that flash repeated. Also capped, so even that frame can't
    // overflow the panel.
    // top/left pinned to zero on purpose. An absolutely positioned element with
    // neither set falls back to its STATIC position, and this wrapper is a
    // centring flex container — so the browser centred it and then the
    // transform offset it again from there, leaving the image pushed down by
    // exactly half the gap it was supposed to be centred in.
    img.style.cssText =
      'position:absolute;top:0;left:0;transform-origin:0 0;user-select:none;' +
      'visibility:hidden;max-width:100%;max-height:100%;';
    wrapper.appendChild(img);

    const bar = document.createElement('div');
    bar.style.cssText =
      'position:absolute;left:8px;bottom:8px;display:flex;gap:6px;align-items:center;' +
      'font-size:11px;color:#bbb;background:rgba(0,0,0,0.55);padding:3px 8px;border-radius:4px;';
    wrapper.appendChild(bar);

    const zoomText = document.createElement('span');
    bar.appendChild(zoomText);

    function button(text: string, onClick: () => void) {
      const b = document.createElement('button');
      b.textContent = text;
      b.style.cssText =
        'background:none;border:1px solid #444;border-radius:3px;color:#bbb;' +
        'font-size:10px;padding:1px 5px;cursor:pointer;';
      b.addEventListener('mousedown', (e) => e.stopPropagation());
      b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
      bar.appendChild(b);
      return b;
    }

    // The true pixel size is only known from the first load; later loads are
    // higher-resolution copies of the same image and must not redefine it.
    let natural = { width: 0, height: 0 };
    let fitScale = 1;
    let scale = 1;
    let offset = { x: 0, y: 0 };
    let loadedWidth = 0;

    // Zoom and pan survive a re-render of the same image. The viewer rebuilds
    // whenever the node re-cooks, and losing your position mid-inspection —
    // which is what the viewer is for — made it unusable.
    const viewKey = `${displayNode?.id ?? 'view'}:${source}`;
    const saved = viewState.get(viewKey);
    let userAdjusted = saved?.userAdjusted ?? false;

    function remember() {
      viewState.set(viewKey, { scale, offset: { ...offset }, fitScale, userAdjusted });
    }

    function frame() {
      return { width: wrapper.clientWidth || 1, height: wrapper.clientHeight || 1 };
    }

    /** Show the image and drop the pre-load size cap. The cap has to go: with
     *  max-width/max-height still applied the browser first clamps the element
     *  to the panel and THEN applies the transform, so everything ends up scaled
     *  twice — the image sat off-centre and refused to fill after a resize. */
    function reveal() {
      img.style.maxWidth = 'none';
      img.style.maxHeight = 'none';
      img.style.visibility = 'visible';
    }

    function apply() {
      img.style.width = natural.width + 'px';
      img.style.height = natural.height + 'px';
      img.style.transform = 'translate(' + offset.x + 'px,' + offset.y + 'px) scale(' + scale + ')';
      zoomText.textContent = Math.round(scale * 100) + '%';
      // Ask for more pixels once the zoom has outgrown what is loaded. Stepped
      // rather than exact, so a wheel gesture doesn't refetch on every tick.
      const needed = Math.min(natural.width, Math.ceil(natural.width * scale * 1.2));
      if (natural.width && needed > loadedWidth * 1.25) {
        loadedWidth = needed;
        img.src = mediaUrl(source, { width: needed, version });
      }
    }

    function fit() {
      const f = frame();
      if (!natural.width || !natural.height) return;
      fitScale = Math.min(f.width / natural.width, f.height / natural.height);
      scale = fitScale;
      offset = {
        x: (f.width - natural.width * scale) / 2,
        y: (f.height - natural.height * scale) / 2,
      };
      userAdjusted = false;
      reveal();
      apply();
      remember();
    }

    function zoomTo(next: number, px: number, py: number) {
      userAdjusted = true;
      const before = scale;
      // 20x is well past useful inspection; fit is the floor.
      const after = Math.max(fitScale, Math.min(fitScale * 20, next));
      if (after === before) return;
      offset.x = px - ((px - offset.x) * after) / before;
      offset.y = py - ((py - offset.y) * after) / before;
      scale = after;
      apply();
      remember();
    }

    wrapper.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = wrapper.getBoundingClientRect();
      zoomTo(scale * Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
    }, { passive: false });

    // Pointer capture rather than window listeners: a drag that leaves the panel
    // still tracks, and everything is unbound automatically when the element
    // goes away. The previous version watched document.body with a
    // MutationObserver to know when to detach — which meant one observer per
    // render, all of them firing on every DOM change in the app.
    let dragging = false;
    let last = { x: 0, y: 0 };

    wrapper.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement)?.closest('button, a')) return;
      dragging = true;
      last = { x: e.clientX, y: e.clientY };
      wrapper.style.cursor = 'grabbing';
      wrapper.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    wrapper.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      userAdjusted = true;
      offset.x += e.clientX - last.x;
      offset.y += e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
      apply();
      remember();
    });

    const endDrag = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      wrapper.style.cursor = 'grab';
      if (wrapper.hasPointerCapture(e.pointerId)) wrapper.releasePointerCapture(e.pointerId);
    };
    wrapper.addEventListener('pointerup', endDrag);
    wrapper.addEventListener('pointercancel', endDrag);

    wrapper.addEventListener('dblclick', () => fit());

    button('Fit', () => fit());
    button('1:1', () => {
      const f = frame();
      zoomTo(1, f.width / 2, f.height / 2);
    });

    const original = document.createElement('a');
    original.textContent = 'Original';
    original.href = mediaUrl(source, { raw: true, version });
    original.target = '_blank';
    original.rel = 'noopener';
    original.title = source;
    original.style.cssText = 'color:#9cdcfe;text-decoration:none;font-size:10px;';
    original.addEventListener('mousedown', (e) => e.stopPropagation());
    bar.appendChild(original);

    img.addEventListener('load', () => {
      if (natural.width) return;
      natural = { width: img.naturalWidth, height: img.naturalHeight };
      if (saved && saved.userAdjusted) {
        // Come back to exactly where they were rather than snapping to fit.
        scale = saved.scale;
        fitScale = saved.fitScale;
        offset = { ...saved.offset };
        reveal();
        apply();
      } else {
        fit();
      }
    });

    // The panel is laid out by dockview and is frequently not at its final size
    // when the first image lands — which is how a render ended up pinned small
    // in a corner of a tall panel and stayed there. Refit on every resize until
    // the user zooms or pans, after which their view is left alone.
    const observer = new ResizeObserver(() => {
      if (!natural.width) return;
      if (userAdjusted) return;
      fit();
    });
    // A ResizeObserver holds only a weak reference to its target, so it is
    // collected with the element; no document-wide watch is needed to tear it
    // down, and adding one per render is what made this expensive.
    observer.observe(wrapper);

    loadedWidth = displayWidth();
    img.src = mediaUrl(source, { width: loadedWidth, version });
  }

  // Render image viewer
  function renderImage() {
    if (!container) return;

    /**
     * Bail out when the same image is already on screen.
     *
     * Rebuilding tears the <img> out and puts a new one in, so the panel shows
     * its own background for a frame before the replacement decodes — a black
     * flash. Harmless once; at the ~29 renders a second this was running at, it
     * is a strobe. Measured at 231 rebuilds in eight seconds with no re-cook
     * behind them, so the render itself was the loop.
     *
     * Guarding here rather than chasing every reactive statement that might
     * trigger a render is the durable fix: a render with nothing to change
     * should cost nothing, however it was reached.
     */
    const mounted = container.querySelector('img[data-cascade-src]') as HTMLImageElement | null;
    const wanted = mountedSourceFor();
    if (mounted && wanted && mounted.dataset.cascadeSrc === wanted) {
      return;
    }

    container.innerHTML = '';

    let image: HTMLImageElement | null = null;
    let imageSrc: string | null = null;

    // Check if displaying an annotation
    if (displayAnnotation && displayAnnotation.type === 'Image') {
      const outputPort = displayAnnotation.outputs?.find(p => p.name === 'image');
      if (outputPort?.value instanceof HTMLImageElement) {
        image = outputPort.value;
      } else {
        // Try to load from src
        imageSrc = (displayAnnotation as any).src;
      }
    } else if (displayNode) {
      if (displayNode.preview instanceof HTMLImageElement) {
        image = displayNode.preview;
      } else {
        const outputPort = activeOutput;
        if (outputPort?.value instanceof HTMLImageElement) {
          image = outputPort.value;
        } else {
          imageSrc = imagePathFromValue(outputPort?.value) ?? findImagePath(displayNode);
        }
      }
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'image-viewer';
    wrapper.style.width = '100%';
    wrapper.style.height = '100%';
    wrapper.style.display = 'flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.justifyContent = 'center';
    wrapper.style.background = '#0a0a0a';

    if (image) {
      const img = image.cloneNode(true) as HTMLImageElement;
      img.style.maxWidth = '100%';
      img.style.maxHeight = '100%';
      img.style.objectFit = 'contain';
      wrapper.appendChild(img);
    } else if (imageSrc) {
      buildZoomableImage(wrapper, imageSrc);
    }

    container.appendChild(wrapper);
  }

  // Render text viewer
  function renderText() {
    if (!container) return;

    container.innerHTML = '';

    let content: any = null;

    // Check if displaying an annotation
    if (displayAnnotation && displayAnnotation.type === 'Text') {
      content = (displayAnnotation as any).content || '';
    } else if (displayNode) {
      if (displayNode.preview && !(displayNode.preview instanceof HTMLElement)) {
        content = displayNode.preview;
      } else {
        const outputPort = activeOutput;
        if (outputPort?.value !== undefined) {
          content = outputPort.value;
        }
      }
    }

    if (content !== null) {
      const wrapper = document.createElement('div');
      wrapper.className = 'text-viewer';
      wrapper.style.width = '100%';
      wrapper.style.height = '100%';
      wrapper.style.padding = '16px';
      wrapper.style.overflow = 'auto';
      wrapper.style.background = '#0a0a0a';
      wrapper.style.color = '#fff';
      wrapper.style.fontFamily = 'Monaco, Menlo, monospace';
      wrapper.style.fontSize = '12px';
      wrapper.style.lineHeight = '1.6';

      let textContent = '';
      if (typeof content === 'object') {
        try {
          textContent = JSON.stringify(content, null, 2);
        } catch (e) {
          textContent = String(content);
        }
      } else {
        textContent = String(content);
      }

      const pre = document.createElement('pre');
      pre.style.margin = '0';
      pre.style.whiteSpace = 'pre-wrap';
      pre.style.wordBreak = 'break-word';
      pre.textContent = textContent;
      wrapper.appendChild(pre);

      container.appendChild(wrapper);
    }
  }

  // Render empty viewer
  function renderEmpty() {
    if (!container) return;

    container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'empty-viewer';

    const p1 = document.createElement('p');
    p1.textContent = 'No preview available';
    wrapper.appendChild(p1);

    const p2 = document.createElement('p');
    p2.className = 'hint';
    p2.textContent = 'Select a node or annotation to view its content';
    wrapper.appendChild(p2);

    container.appendChild(wrapper);
  }

  // Update viewer when node/annotation or type changes
  $: {
    displayNode;
    displayAnnotation;
    // Reset render cache so change detection triggers fresh render
    lastRenderedId = null;
    lastRenderedContent = null;
    lastRenderedViewer = null;

    if (currentViewer === 'canvas') {
      renderCanvas();
    } else if (currentViewer === 'image') {
      renderImage();
    } else if (currentViewer === 'text') {
      renderText();
    } else if (currentViewer === 'chat') {
      // Chat viewer uses Svelte component - just clear the container
      if (container) container.innerHTML = '';
    } else if (currentViewer === 'typed') {
      if (container) container.innerHTML = '';
    } else {
      renderEmpty();
    }
  }

  // Generate a lightweight key for change detection (avoid expensive operations)
  function getContentKey(): string | null {
    if (displayAnnotation) {
      if (displayAnnotation.type === 'Image') {
        const outputPort = displayAnnotation.outputs?.find(p => p.name === 'image');
        if (outputPort?.value instanceof HTMLImageElement) {
          return `img:${outputPort.value.src}`;
        }
        return `img:${(displayAnnotation as any).src || 'none'}`;
      } else if (displayAnnotation.type === 'Text') {
        return `text:${(displayAnnotation as any).content || ''}`;
      }
      return null;
    }

    if (!displayNode) return null;

    // The selected port wins over a node-level preview, matching the visible
    // output switcher. Cook count detects in-place object/array replacements
    // without serializing potentially huge geometry or pixel data.
    const outputPort = activeOutput;
    if (outputPort?.value instanceof HTMLCanvasElement) {
      return `canvas:${outputPort.value.width}x${outputPort.value.height}:${displayNode.id}:${displayNode.cookInfo?.cookCount ?? 0}`;
    } else if (outputPort?.value instanceof HTMLImageElement) {
      return `img:${outputPort.value.src}`;
    } else if (outputPort?.value !== undefined) {
      // No cook count here. Evaluating the displayed node is what increments it,
      // and the viewer evaluates the displayed node — so including it made the
      // key change on every render, which rebuilt the image, which cooked again.
      // That loop is the flicker. The fingerprint already covers what matters,
      // and node outputs are content-addressed, so different pixels mean a
      // different path. The canvas branch above keeps its cook count: a canvas
      // really is mutated in place and has nothing else to detect.
      return `data:${outputPort.id}:${valueFingerprint(outputPort.value)}`;
    }

    // Use lightweight fingerprints - avoid isDirty and JSON.stringify.
    if (displayNode.preview instanceof HTMLCanvasElement) {
      return `canvas:${displayNode.preview.width}x${displayNode.preview.height}:${displayNode.id}`;
    } else if (displayNode.preview instanceof HTMLImageElement) {
      return `img:${displayNode.preview.src}`;
    } else if (displayNode.preview) {
      const preview = displayNode.preview as any;
      return `preview:${valueFingerprint(preview)}`;
    }

    return null;
  }

  // Trigger lazy evaluation for display node (called on-demand, not polling)
  async function evaluateDisplayNode() {
    if (!displayNode || !displayNode.isDirty) return;

    await displayNode.requestOutput();
    checkForRender();
  }

  // Check if content changed and re-render if needed
  function checkForRender() {
    if ((displayNode || displayAnnotation) && currentViewer !== 'empty') {
      const currentId = displayNode?.id || displayAnnotation?.id || null;
      const contentKey = getContentKey();

      const needsRender =
        currentId !== lastRenderedId ||
        currentViewer !== lastRenderedViewer ||
        contentKey !== lastRenderedContent;

      if (needsRender) {
        lastRenderedId = currentId;
        lastRenderedViewer = currentViewer;
        lastRenderedContent = contentKey;

        if (currentViewer === 'canvas') {
          renderCanvas();
        } else if (currentViewer === 'image') {
          renderImage();
        } else if (currentViewer === 'text') {
          renderText();
        } else if (currentViewer === 'typed') {
          typedVersion += 1;
        }
      }
    }
  }

  // Guard to prevent overlapping evaluations
  let isEvaluating = false;

  // Force re-render (bypasses change detection)
  function forceRender() {
    if (currentViewer === 'canvas') {
      renderCanvas();
    } else if (currentViewer === 'image') {
      renderImage();
    } else if (currentViewer === 'text') {
      renderText();
    } else if (currentViewer === 'typed') {
      typedVersion += 1;
    }
  }

  // Check for dirty nodes and trigger evaluation + render
  async function checkAndEvaluate() {
    // If display node is dirty, evaluate it first
    if (displayNode && displayNode.isDirty && !isEvaluating) {
      isEvaluating = true;
      try {
        await displayNode.requestOutput();
        refreshPorts();
        // Force re-render after evaluation (content changed even if dimensions didn't)
        forceRender();
      } finally {
        isEvaluating = false;
      }
    } else {
      // No evaluation needed, just check if render needed
      refreshPorts();
      checkForRender();
    }
  }

  // RAF-based polling - only schedules next frame when needed
  let rafId: number | null = null;
  let lastCheckTime = 0;
  const CHECK_INTERVAL = 100; // ms between dirty checks

  function scheduleCheck() {
    if (rafId !== null) return; // Already scheduled
    rafId = requestAnimationFrame(rafCheck);
  }

  function rafCheck() {
    rafId = null;
    const now = performance.now();

    // Throttle checks to CHECK_INTERVAL
    if (now - lastCheckTime >= CHECK_INTERVAL) {
      lastCheckTime = now;
      checkAndEvaluate();
    }

    // Continue polling if we have a display node
    if (displayNode || displayAnnotation) {
      scheduleCheck();
    }
  }

  // React to displayNode changes - trigger evaluation when selection changes
  $: if (displayNode) {
    lastCheckTime = 0; // Reset throttle for immediate check
    scheduleCheck();
  }

  onMount(() => {
    // Start the RAF-based check loop
    scheduleCheck();

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };
  });
</script>

<div class="viewer-wrapper">
  {#if outputPorts.length > 1 && currentViewer !== 'chat'}
    <div class="output-switcher" aria-label="Node outputs">
      {#each outputPorts as output (output.id)}
        <button
          class:active={output.id === activeOutputId}
          on:click={() => (activeOutputId = output.id)}
          title={`${output.name}: ${normalizeType(output.dataType)}`}
        >
          <span class="output-dot" style="background:{typeColor(output.dataType)}"></span>
          {output.name}
        </button>
      {/each}
    </div>
  {/if}

  <!-- Container for canvas/image/text rendering (manipulated via innerHTML) -->
  <div class="viewer" bind:this={container} class:hidden={currentViewer === 'chat' || currentViewer === 'typed'}></div>

  {#if currentViewer === 'typed' && activeOutput}
    <div class="typed-viewer">
      {#key `${activeOutput.id}-${typedVersion}`}
        <CoreValue type={activeOutputType} value={activeOutput.value} port={activeOutput} node={displayNode} mode="view" readOnly />
      {/key}
    </div>
  {/if}

  <!-- Chat viewer (rendered via Svelte, outside innerHTML-manipulated container) -->
  {#if currentViewer === 'chat' && chatNodeState && displayNode}
    <div class="chat-viewer" bind:this={chatViewerElement}>
      <ChatNodeContent
        state={chatNodeState}
        displayMode="expanded"
        conversations={chatConversation}
        on:send={() => (displayNode as ChatNode).send()}
        on:cancel={() => (displayNode as ChatNode).cancel()}
        on:promptChange={(e) => (displayNode as ChatNode).setPrompt(e.detail)}
      />
    </div>
  {/if}
</div>

<style>
  .viewer-wrapper {
    width: 100%;
    height: 100%;
    position: relative;
    background: #0a0a0a;
  }

  .viewer {
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #0a0a0a;
  }

  .viewer.hidden {
    display: none;
  }

  .output-switcher {
    position: absolute;
    z-index: 20;
    top: 8px;
    left: 50%;
    display: flex;
    max-width: calc(100% - 24px);
    overflow-x: auto;
    border: 1px solid #333;
    border-radius: 5px;
    background: rgba(20, 20, 20, 0.92);
    box-shadow: 0 3px 14px rgba(0, 0, 0, 0.35);
    transform: translateX(-50%);
  }

  .output-switcher button {
    display: flex;
    align-items: center;
    gap: 5px;
    flex: none;
    border: 0;
    border-right: 1px solid #333;
    background: transparent;
    color: #888;
    padding: 5px 8px;
    font: 9px ui-monospace, SFMono-Regular, Menlo, monospace;
    cursor: pointer;
  }

  .output-switcher button:last-child { border-right: 0; }
  .output-switcher button:hover { color: #ccc; background: #292929; }
  .output-switcher button.active { color: #fff; background: #333; }
  .output-dot { width: 6px; height: 6px; flex: none; border-radius: 50%; }

  .typed-viewer {
    width: 100%;
    height: 100%;
    overflow: auto;
    box-sizing: border-box;
    padding-top: 30px;
    background: #0a0a0a;
  }

  :global(.empty-viewer) {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #666;
    font-size: 14px;
    text-align: center;
    padding: 32px;
  }

  :global(.empty-viewer p) {
    margin: 8px 0;
  }

  :global(.empty-viewer .hint) {
    font-size: 12px;
    color: #444;
  }

  :global(.canvas-viewer),
  :global(.image-viewer) {
    width: 100%;
    height: 100%;
  }

  :global(.text-viewer) {
    width: 100%;
    height: 100%;
  }

  .chat-viewer {
    width: 100%;
    height: 100%;
    overflow: auto;
    background: #0a0a0a;
  }
</style>
