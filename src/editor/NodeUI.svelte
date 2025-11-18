<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Node } from '@/core/Node';
  import { getNodeIcon } from './nodeTemplates';
  import Icon from './Icon.svelte';
  import { getPortColor } from '@/utils/portColors';
  
  export let node: Node;
  export let selected = false;
  
  const dispatch = createEventDispatcher();
  
  $: hasError = node.error !== null;
  $: nodeIcon = getNodeIcon(node.type);
  $: isBypassed = node.bypassed;
  $: isCooking = node.cooking;
  
  // Reactive statements to track port changes
  $: inputs = node.inputs;
  $: outputs = node.outputs;
  
  let isDragging = false;
  let tooltip: { text: string; x: number; y: number; type: 'input' | 'output' } | null = null;
  
  function showPortTooltip(e: MouseEvent, portName: string, portType: 'input' | 'output') {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    
    tooltip = {
      text: portName,
      x: rect.left + rect.width / 2,
      y: portType === 'input' 
        ? rect.bottom + 4
        : rect.top - 4,
      type: portType
    };
  }
  
  function hidePortTooltip() {
    tooltip = null;
  }
  
  function handlePortClick(portId: string, portType: 'input' | 'output', e: MouseEvent) {
    dispatch('portClick', {
      nodeId: node.id,
      portId,
      portType,
      event: e
    });
  }
  
  function handlePortMouseDown(portId: string, portType: 'input' | 'output', e: MouseEvent) {
    // Only handle left mouse button
    if (e.button !== 0) return;
    e.stopPropagation();
    dispatch('portMouseDown', {
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
  
  function handleBypassClick(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    dispatch('bypassToggle', { nodeId: node.id, event: e });
  }
  
  function handleCookClick(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    dispatch('cookToggle', { nodeId: node.id, event: e });
  }
</script>

<div 
  class="node"
  role="application"
  aria-label="Node: {node.name}"
  class:selected
  class:error={hasError}
  class:dragging={isDragging}
  class:bypassed={isBypassed}
  class:cooking={isCooking}
  style="left: {node.position.x}px; top: {node.position.y}px; opacity: {node.bypassOpacity}"
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
          {@const portColor = getPortColor(port)}
          <div 
            class="port port-{port.portType}"
            role="button"
            tabindex="0"
            on:click={(e) => handlePortClick(port.id, 'input', e)}
            on:mousedown={(e) => handlePortMouseDown(port.id, 'input', e)}
            on:keydown={(e) => handleKeyDown(port.id, 'input', e)}
            on:mouseenter={(e) => showPortTooltip(e, port.name, 'input')}
            on:mouseleave={hidePortTooltip}
            data-node-id={node.id}
            data-port-id={port.id}
            data-port-type="input"
          >
            <span class="port-dot" style="background-color: {portColor};"></span>
          </div>
        {/each}
      </div>
      
      <div class="body">
        <!-- Bypass button (left side) -->
        <button
          class="node-button bypass-button"
          class:active={isBypassed}
          aria-label="Bypass node"
          title="Bypass (B)"
          on:click={handleBypassClick}
          on:mousedown={(e) => e.stopPropagation()}
        >
        </button>
        
        <!-- Icon / Preview (center) -->
        <span class="node-icon">
          <Icon name={nodeIcon} size={12} strokeWidth={2} />
        </span>
        
        <!-- Cook button (right side) -->
        <button
          class="node-button cook-button"
          class:active={isCooking}
          aria-label="Cook node"
          title="Cook (C)"
          on:click={handleCookClick}
          on:mousedown={(e) => e.stopPropagation()}
        >
        </button>
      </div>
      
      <!-- Output ports (bottom) -->
      <div class="port-row outputs">
        {#each outputs as port}
          {@const portColor = getPortColor(port)}
          <div 
            class="port port-{port.portType}"
            role="button"
            tabindex="0"
            on:click={(e) => handlePortClick(port.id, 'output', e)}
            on:mousedown={(e) => handlePortMouseDown(port.id, 'output', e)}
            on:keydown={(e) => handleKeyDown(port.id, 'output', e)}
            on:mouseenter={(e) => showPortTooltip(e, port.name, 'output')}
            on:mouseleave={hidePortTooltip}
            data-node-id={node.id}
            data-port-id={port.id}
            data-port-type="output"
          >
            <span class="port-dot" style="background-color: {portColor};"></span>
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

<!-- Port tooltip -->
{#if tooltip}
  <div 
    class="port-tooltip port-tooltip-{tooltip.type}"
    style="left: {tooltip.x}px; top: {tooltip.y}px;"
    role="tooltip"
  >
    {tooltip.text}
  </div>
{/if}


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
    flex-shrink: 0;
    /* Color is set via inline style based on port dataType */
  }
  
  .body {
    width: 80px;
    height: 36px;
    background: #2a2a2a;
    border-radius: 5px;
    border: 1px solid var(--node-border-color, #444);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0;
    gap: 0;
    margin: 0;
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
    color: #fff;
    flex: 1;
  }
  
  .node-button {
    width: 16px;
    height: 36px;
    border: 0px solid #555;
    background: #1a1a1a;
    border-radius: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
    margin: 0;
    flex-shrink: 0;
    transition: all 0.1s ease;
  }
  
  .bypass-button {
    border-radius: 5px 0 0 5px;
    border-right: none;
  }
  
  .cook-button {
    border-radius: 0 5px 5px 0;
    border-left: none;
  }
  
  .node-button:hover {
    background: #2a2a2a;
    border-color: #666;
  }
  
  .node-button.active {
    background: #4a9eff;
    border-color: #4a9eff;
  }
  
  .bypass-button.active {
    background: #ffd700;
    border-color: #ffd700;
  }
  
  .cook-button.active {
    background: #4a9eff;
    border-color: #4a9eff;
  }
  
  .button-label {
    font-size: 9px;
    font-weight: 600;
    color: #fff;
    line-height: 1;
    user-select: none;
  }
  
  .node-button.active .button-label {
    color: #000;
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
  
  .port-tooltip {
    position: fixed;
    pointer-events: none;
    background: rgba(0, 0, 0, 0.85);
    color: #fff;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 11px;
    white-space: nowrap;
    z-index: 10000;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }
  
  .port-tooltip-input {
    transform: translate(-50%, 0);
  }
  
  .port-tooltip-output {
    transform: translate(-50%, -100%);
  }
</style>

