<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { Graph } from '@/nodes/Graph';
  import type { Node } from '@/nodes/Node';
  import type { Annotation } from '@/nodes/annotations/Annotation';
  import { ImageBuffer } from '@/nodes/lens/ImageBuffer';

  export let graph: Graph | undefined;
  export let selectedNode: Node | null = null;
  export let selectedAnnotation: Annotation | null = null;

  let container: HTMLDivElement;
  let currentViewer: 'canvas' | 'image' | 'text' | 'empty' = 'empty';
  let displayNode: Node | null = null;
  let displayAnnotation: Annotation | null = null;

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
    } else {
      // Check output ports first for renderable content (includes 'image' port for LensNodes)
      const outputPort = displayNode.outputs.find(p => p.name === 'output' || p.name === 'preview' || p.name === 'image');
      if (outputPort && outputPort.value) {
        if (outputPort.value instanceof HTMLCanvasElement || outputPort.value instanceof ImageBuffer) {
          currentViewer = 'canvas';
        } else if (outputPort.value instanceof HTMLImageElement) {
          currentViewer = 'image';
        } else {
          currentViewer = 'text';
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
    const outputPort = displayNode.outputs.find(p => p.name === 'output' || p.name === 'preview' || p.name === 'image');
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

  // Render image viewer
  function renderImage() {
    if (!container) return;

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
        const outputPort = displayNode.outputs.find(p => p.name === 'output' || p.name === 'preview');
        if (outputPort?.value instanceof HTMLImageElement) {
          image = outputPort.value;
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
      const img = document.createElement('img');
      img.src = imageSrc.startsWith('/') || imageSrc.startsWith('http') || imageSrc.startsWith('data:')
        ? imageSrc : `/${imageSrc}`;
      img.style.maxWidth = '100%';
      img.style.maxHeight = '100%';
      img.style.objectFit = 'contain';
      wrapper.appendChild(img);
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
        const outputPort = displayNode.outputs.find(p => p.name === 'output' || p.name === 'preview' || p.name === 'data');
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

    // Use lightweight fingerprints - avoid isDirty (expensive) and JSON.stringify
    if (displayNode.preview instanceof HTMLCanvasElement) {
      return `canvas:${displayNode.preview.width}x${displayNode.preview.height}:${displayNode.id}`;
    } else if (displayNode.preview instanceof HTMLImageElement) {
      return `img:${displayNode.preview.src}`;
    } else if (displayNode.preview) {
      // Lightweight fingerprint for other preview types
      const p = displayNode.preview as any;
      if (typeof p === 'object' && p.width !== undefined) {
        return `preview:${p.width}x${p.height || 0}`;
      }
      return `preview:${typeof p}:${String(p).slice(0, 50)}`;
    }

    // Check output ports
    const outputPort = displayNode.outputs.find(p => p.name === 'output' || p.name === 'preview' || p.name === 'image');
    if (outputPort?.value instanceof HTMLCanvasElement) {
      return `canvas:${outputPort.value.width}x${outputPort.value.height}:${displayNode.id}`;
    } else if (outputPort?.value instanceof HTMLImageElement) {
      return `img:${outputPort.value.src}`;
    } else if (outputPort?.value !== undefined) {
      // Lightweight fingerprint for data values
      const v = outputPort.value;
      if (typeof v === 'object' && v.width !== undefined) {
        return `data:${v.width}x${v.height || 0}`;
      }
      if (typeof v === 'string' || typeof v === 'number') {
        return `data:${String(v).slice(0, 100)}`;
      }
      return `data:${typeof v}`;
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
    }
  }

  // Check for dirty nodes and trigger evaluation + render
  async function checkAndEvaluate() {
    // If display node is dirty, evaluate it first
    if (displayNode && displayNode.isDirty && !isEvaluating) {
      isEvaluating = true;
      try {
        await displayNode.requestOutput();
        // Force re-render after evaluation (content changed even if dimensions didn't)
        forceRender();
      } finally {
        isEvaluating = false;
      }
    } else {
      // No evaluation needed, just check if render needed
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

<div class="viewer" bind:this={container}>
</div>

<style>
  .viewer {
    width: 100%;
    height: 100%;
    overflow: hidden;
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
</style>
