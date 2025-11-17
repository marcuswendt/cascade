<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Node } from '@/core/Node';
  import { getNodeIcon } from './nodeTemplates';
  
  export let node: Node;
  export let selected = false;
  
  const dispatch = createEventDispatcher();
  
  $: hasError = node.error !== null;
  $: nodeIcon = getNodeIcon(node.type);
  
  // Reactive statements to track port changes
  $: inputs = node.inputs;
  $: outputs = node.outputs;
  
  let isDragging = false;
  
  function handlePortClick(portId: string, portType: 'input' | 'output', e: MouseEvent) {
    dispatch('portClick', {
      nodeId: node.id,
      portId,
      portType,
      event: e
    });
  }
  
  function handleMouseDown(e: MouseEvent) {
    // Don't dispatch if clicking on a port
    if ((e.target as HTMLElement).closest('.port')) {
      return;
    }
    
    // Prevent text selection while dragging
    e.preventDefault();
    isDragging = true;
    
    dispatch('nodeMouseDown', {
      nodeId: node.id,
      event: e
    });
  }
  
  function handleMouseUp() {
    isDragging = false;
  }
  
  function handleDoubleClick(e: MouseEvent) {
    // Don't open editor if clicking on a port
    if ((e.target as HTMLElement).closest('.port')) {
      return;
    }
    e.stopPropagation();
    dispatch('edit', { node });
  }
  
  function handleKeyDown(portId: string, portType: 'input' | 'output', e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Create a synthetic mouse event for the port click handler
      const syntheticEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true
      });
      handlePortClick(portId, portType, syntheticEvent);
    }
  }
</script>

<div 
  class="node"
  role="application"
  aria-label="Node: {node.name}"
  class:selected
  class:error={hasError}
  class:dragging={isDragging}
  style="left: {node.position.x}px; top: {node.position.y}px"
  data-node-id={node.id}
  on:click={(e) => {
    e.stopPropagation();
    dispatch('click', { event: e });
  }}
  on:mousedown={handleMouseDown}
  on:mouseup={handleMouseUp}
  on:mouseleave={handleMouseUp}
  on:dblclick={handleDoubleClick}
>
  <div class="node-container">
    <div class="node-content">
      <!-- Input ports (top) -->
      <div class="port-row inputs">
        {#each inputs as port}
          <div 
            class="port port-{port.portType}"
            role="button"
            tabindex="0"
            on:click={(e) => handlePortClick(port.id, 'input', e)}
            on:keydown={(e) => handleKeyDown(port.id, 'input', e)}
            data-node-id={node.id}
            data-port-id={port.id}
            data-port-type="input"
          >
            <span class="port-dot"></span>
          </div>
        {/each}
      </div>
      
      <div class="body">
        <span class="node-icon">{nodeIcon}</span>
      </div>
      
      <!-- Output ports (bottom) -->
      <div class="port-row outputs">
        {#each outputs as port}
          <div 
            class="port port-{port.portType}"
            role="button"
            tabindex="0"
            on:click={(e) => handlePortClick(port.id, 'output', e)}
            on:keydown={(e) => handleKeyDown(port.id, 'output', e)}
            data-node-id={node.id}
            data-port-id={port.id}
            data-port-type="output"
          >
            <span class="port-dot"></span>
          </div>
        {/each}
      </div>
    </div>
    
    <div class="label">
      <span class="node-name">{node.name}</span>
    </div>
  </div>
  
  {#if node.comment}
    <div class="comment">{node.comment}</div>
  {/if}
  
  {#if hasError}
    <div class="error-message">{node.error?.message}</div>
  {/if}
</div>

<style>
  .node {
    position: absolute;
    cursor: move;
    user-select: none;
  }
  
  .node:active,
  .node.dragging {
    cursor: grabbing;
  }
  
  .node.dragging {
    opacity: 0.9;
  }
  
  .node.selected {
    --node-border-color: #4a9eff;
  }
  
  .node.error {
    --node-border-color: #ff4444;
  }
  
  .node-container {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 8px;
    position: relative;
  }
  
  .node-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0;
  }
  
  .port-row {
    display: flex;
    flex-direction: row;
    gap: 4px;
    align-items: center;
    justify-content: center;
    height: 12px;
  }
  
  .port {
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    width: 12px;
    height: 12px;
    position: relative;
  }
  
  .port:hover {
    opacity: 0.8;
  }
  
  .port-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #888;
    flex-shrink: 0;
  }
  
  .port-trigger .port-dot {
    background: #fff;
  }
  
  .port-param .port-dot {
    background: #888;
  }
  
  .body {
    width: 60px;
    height: 20px;
    background: #2a2a2a;
    border-radius: 5px;
    border: 1px solid var(--node-border-color, #444);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }
  
  .node.selected .body {
    border-color: var(--node-border-color);
  }
  
  .node.error .body {
    border-color: var(--node-border-color);
  }
  
  .node-icon {
    font-size: 12px;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  .label {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    font-size: 11px;
    color: #fff;
    white-space: nowrap;
  }
  
  .node-name {
    font-weight: 500;
  }
  
  
  .comment {
    margin-top: 4px;
    font-size: 10px;
    color: #666;
    font-style: italic;
  }
  
  .error-message {
    margin-top: 4px;
    padding: 4px;
    background: #ff4444;
    color: white;
    font-size: 10px;
    border-radius: 2px;
  }
</style>

