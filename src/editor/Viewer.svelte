<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { Graph } from '@/core/engine/Graph';
  import type { Computation } from '@/core/engine/Computation';
  
  export let graph: Graph | undefined;
  export let selectedNode: Computation | null = null;

  let container: HTMLDivElement;
  let currentViewer: 'canvas' | 'image' | 'text' | 'empty' = 'empty';
  let displayNode: Computation | null = null;
  
  // Determine which node to display
  $: {
    if (selectedNode) {
      displayNode = selectedNode;
    } else if (graph) {
      // Try to get first cooking node
      const cookingNodesArray = Array.from(graph.cookingNodes || []);
      if (cookingNodesArray.length > 0) {
        displayNode = cookingNodesArray[0];
      } else {
        displayNode = null;
      }
    } else {
      displayNode = null;
    }
  }
  
  // Watch for cooking nodes changes
  $: if (graph) {
    // Force reactivity when cooking nodes change
    const _ = graph.cookingNodes?.size;
  }
  
  // Determine viewer type based on node preview/output
  $: {
    if (!displayNode) {
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
    if (!container || !displayNode) return;
    
    container.innerHTML = '';
    
    let image: HTMLImageElement | null = null;
    
    if (displayNode.preview instanceof HTMLImageElement) {
      image = displayNode.preview;
    } else {
      const outputPort = displayNode.outputs.find(p => p.name === 'output' || p.name === 'preview');
      if (outputPort?.value instanceof HTMLImageElement) {
        image = outputPort.value;
      }
    }
    
    if (image) {
      const wrapper = document.createElement('div');
      wrapper.className = 'image-viewer';
      wrapper.style.width = '100%';
      wrapper.style.height = '100%';
      wrapper.style.display = 'flex';
      wrapper.style.alignItems = 'center';
      wrapper.style.justifyContent = 'center';
      wrapper.style.background = '#0a0a0a';
      
      const img = image.cloneNode(true) as HTMLImageElement;
      img.style.maxWidth = '100%';
      img.style.maxHeight = '100%';
      img.style.objectFit = 'contain';
      wrapper.appendChild(img);
      
      container.appendChild(wrapper);
    }
  }
  
  // Render text viewer
  function renderText() {
    if (!container || !displayNode) return;
    
    container.innerHTML = '';
    
    let content: any = null;
    
    if (displayNode.preview && !(displayNode.preview instanceof HTMLElement)) {
      content = displayNode.preview;
    } else {
      const outputPort = displayNode.outputs.find(p => p.name === 'output' || p.name === 'preview' || p.name === 'data');
      if (outputPort?.value !== undefined) {
        content = outputPort.value;
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
    p2.textContent = 'Select a node with output to view its content';
    wrapper.appendChild(p2);
    
    container.appendChild(wrapper);
  }
  
  // Update viewer when node or type changes
  $: {
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
  
  onMount(() => {
    // Periodically check for preview updates (since preview might be updated asynchronously)
    const interval = setInterval(() => {
      if (displayNode && currentViewer !== 'empty') {
        if (currentViewer === 'canvas') {
          renderCanvas();
        } else if (currentViewer === 'image') {
          renderImage();
        } else if (currentViewer === 'text') {
          renderText();
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

