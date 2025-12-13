<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { Graph } from '@/nodes/Graph';
  import type { Node } from '@/nodes/Node';
  import type { Annotation } from '@/nodes/annotations/Annotation';

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
    } else if (displayNode.preview) {
      // Check preview property
      if (displayNode.preview instanceof HTMLCanvasElement) {
        currentViewer = 'canvas';
      } else if (displayNode.preview instanceof HTMLImageElement) {
        currentViewer = 'image';
      } else {
        currentViewer = 'text';
      }
    } else {
      // Check output ports for renderable content
      const outputPort = displayNode.outputs.find(p => p.name === 'output' || p.name === 'preview');
      if (outputPort && outputPort.value) {
        if (outputPort.value instanceof HTMLCanvasElement) {
          currentViewer = 'canvas';
        } else if (outputPort.value instanceof HTMLImageElement) {
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

    if (displayNode.preview instanceof HTMLCanvasElement) {
      canvas = displayNode.preview;
    } else {
      const outputPort = displayNode.outputs.find(p => p.name === 'output' || p.name === 'preview');
      if (outputPort?.value instanceof HTMLCanvasElement) {
        canvas = outputPort.value;
      }
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

  // Generate a key representing current content for change detection
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

    // For canvas/image content, use a simple fingerprint
    if (displayNode.preview instanceof HTMLCanvasElement) {
      // Use dimensions as a lightweight fingerprint (full toDataURL is expensive)
      return `canvas:${displayNode.preview.width}x${displayNode.preview.height}:${displayNode.id}:${displayNode.isDirty}`;
    } else if (displayNode.preview instanceof HTMLImageElement) {
      return `img:${displayNode.preview.src}`;
    } else if (displayNode.preview) {
      return `preview:${JSON.stringify(displayNode.preview)}`;
    }

    // Check output ports
    const outputPort = displayNode.outputs.find(p => p.name === 'output' || p.name === 'preview');
    if (outputPort?.value instanceof HTMLCanvasElement) {
      return `canvas:${outputPort.value.width}x${outputPort.value.height}:${displayNode.id}:${displayNode.isDirty}`;
    } else if (outputPort?.value instanceof HTMLImageElement) {
      return `img:${outputPort.value.src}`;
    } else if (outputPort?.value !== undefined) {
      return `data:${JSON.stringify(outputPort.value)}`;
    }

    return null;
  }

  onMount(() => {
    // Guard against overlapping async executions
    let isExecuting = false;

    // Periodically check for preview updates and trigger lazy evaluation
    const interval = setInterval(async () => {
      // Lazy evaluation: request output if display node is dirty (not for annotations)
      // Guard prevents overlapping async executions
      if (displayNode && displayNode.isDirty && !isExecuting) {
        isExecuting = true;
        try {
          await displayNode.requestOutput();
        } finally {
          isExecuting = false;
        }
      }

      // Only re-render if content has changed (prevents flickering)
      if ((displayNode || displayAnnotation) && currentViewer !== 'empty') {
        const currentId = displayNode?.id || displayAnnotation?.id || null;
        const contentKey = getContentKey();

        // Check if anything changed that requires re-render
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
    }, 100);

    return () => {
      clearInterval(interval);
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
