<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Node } from '@/nodes/Node';
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

  // Group variadic inputs by base name, showing only one pill per group
  // Non-variadic inputs are shown individually
  type DisplayPort = {
    type: 'single';
    port: typeof inputs[0];
  } | {
    type: 'variadic';
    baseName: string;
    ports: typeof inputs;  // All ports in the variadic group
    firstPort: typeof inputs[0];  // First port for color/id reference
  };

  // Check if this node has variadic inputs (show list-style UI)
  $: hasVariadicInputs = inputs.some(p => p.variadic);

  $: displayInputs = (() => {
    const result: DisplayPort[] = [];
    const seenVariadicGroups = new Set<string>();

    for (const port of inputs) {
      if (port.variadic) {
        // Extract base name (e.g., "image" from "image_0")
        const match = port.name.match(/^(.+)_\d+$/);
        const baseName = match ? match[1] : port.name;

        if (!seenVariadicGroups.has(baseName)) {
          seenVariadicGroups.add(baseName);
          // Get all ports in this variadic group
          const groupPorts = inputs.filter(p => p.variadic && p.name.startsWith(`${baseName}_`));
          result.push({
            type: 'variadic',
            baseName,
            ports: groupPorts,
            firstPort: groupPorts[0]
          });
        }
      } else {
        result.push({ type: 'single', port });
      }
    }
    return result;
  })();

  // Get connected variadic inputs with their source info
  $: variadicConnections = (() => {
    if (!hasVariadicInputs) return [];

    const connections: Array<{
      portId: string;
      portName: string;
      connectionId: string;
      sourceNodeId: string;
    }> = [];

    for (const port of inputs) {
      if (port.variadic && port.connections.length > 0) {
        for (const conn of port.connections) {
          connections.push({
            portId: port.id,
            portName: port.name,
            connectionId: conn.id,
            sourceNodeId: conn.from.nodeId
          });
        }
      }
    }
    return connections;
  })();

  function handleDisconnect(connectionId: string, e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    dispatch('disconnect', { connectionId });
  }
  
  let isDragging = false;
  let tooltip: { text: string; x: number; y: number; type: 'input' | 'output' } | null = null;
  let isEditingName = false;
  let nameInput: HTMLInputElement;
  let tempName = node.id;
  
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
    // Don't dispatch if clicking on a port or name input
    if ((e.target as HTMLElement).closest('.port') || 
        (e.target as HTMLElement).closest('.node-name-input') ||
        (e.target as HTMLElement).closest('.node-name')) {
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

    // For subnet nodes, dive into them instead of opening code editor
    if (node.isNetwork()) {
      dispatch('diveInto', { node });
    } else {
      dispatch('edit', { node });
    }
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
  
  function startEditingName(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    isEditingName = true;
    tempName = node.id;
    // Focus and select the input after it's rendered
    setTimeout(() => {
      nameInput?.focus();
      nameInput?.select();
    }, 0);
  }
  
  function saveName() {
    if (tempName.trim()) {
      // Remove spaces from the input
      const sanitized = tempName.trim().replace(/\s+/g, '');
      if (sanitized) {
        const actualId = node.rename(sanitized);
        tempName = actualId;
      } else {
        tempName = node.id; // Revert if empty after sanitization
      }
    } else {
      tempName = node.id; // Revert if empty
    }
    isEditingName = false;
  }
  
  function cancelEdit() {
    tempName = node.id;
    isEditingName = false;
  }
  
  function handleNameKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      saveName();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancelEdit();
    }
  }
  
  function handleNameKeyDownSpan(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      startEditingName(e as any);
    }
  }
  
  // Update tempName when node.id changes externally
  $: if (node.id && !isEditingName) {
    tempName = node.id;
  }
</script>

<div 
  class="node"
  role="application"
  aria-label="Node: {node.id}"
  class:selected
  class:error={hasError}
  class:dragging={isDragging}
  class:bypassed={isBypassed}
  class:cooking={isCooking}
  style="left: {node.position.x}px; top: {node.position.y}px; opacity: {node.bypassed ? 0.5 : 1}"
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
        {#each displayInputs as displayPort}
          {#if displayPort.type === 'single'}
            {@const port = displayPort.port}
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
          {:else}
            {@const portColor = getPortColor(displayPort.firstPort)}
            {@const connectedCount = displayPort.ports.filter(p => p.connections.length > 0).length}
            {#if hasVariadicInputs}
              <!-- List-style variadic with connections list -->
              <div
                class="port port-{displayPort.firstPort.portType} variadic"
                role="button"
                tabindex="0"
                on:click={(e) => handlePortClick(displayPort.firstPort.id, 'input', e)}
                on:mousedown={(e) => handlePortMouseDown(displayPort.firstPort.id, 'input', e)}
                on:keydown={(e) => handleKeyDown(displayPort.firstPort.id, 'input', e)}
                on:mouseenter={(e) => showPortTooltip(e, `Drop connections here`, 'input')}
                on:mouseleave={hidePortTooltip}
                data-node-id={node.id}
                data-port-id={displayPort.firstPort.id}
                data-port-type="input"
                data-variadic-base={displayPort.baseName}
                data-variadic-ports={displayPort.ports.map(p => p.id).join(',')}
              >
                <span class="port-pill" style="background-color: {portColor};"></span>
              </div>
            {/if}
          {/if}
        {/each}
      </div>

      <!-- Variadic connections list (between pill and body) -->
      {#if hasVariadicInputs && variadicConnections.length > 0}
        <div class="variadic-list" on:mousedown|stopPropagation>
          {#each variadicConnections as conn}
            <div class="variadic-item">
              <span class="variadic-source">{conn.sourceNodeId}</span>
              <button
                class="variadic-remove"
                title="Disconnect"
                on:click={(e) => handleDisconnect(conn.connectionId, e)}
                on:mousedown|stopPropagation
              >×</button>
            </div>
          {/each}
        </div>
      {/if}

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
      {#if isEditingName}
        <input
          type="text"
          class="node-name-input"
          bind:this={nameInput}
          bind:value={tempName}
          on:blur={saveName}
          on:keydown={handleNameKeyDown}
          on:click|stopPropagation
          on:mousedown|stopPropagation
        />
      {:else}
        <span 
          class="node-name"
          role="button"
          tabindex="0"
          on:click={startEditingName}
          on:keydown={handleNameKeyDownSpan}
          title="Click to rename (Enter or Space)"
        >
          {node.id}
        </span>
      {/if}
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

  /* Invisible extended hit area for easier clicking/dragging */
  .port::before {
    content: '';
    position: absolute;
    width: 24px;
    height: 24px;
    border-radius: 50%;
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

  .port.variadic {
    width: auto;
  }

  .port-pill {
    width: 80px;
    height: 8px;
    border-radius: 4px;
    flex-shrink: 0;
    /* Color is set via inline style based on port dataType */
  }

  /* Variadic connections list */
  .variadic-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    background: #1a1a1a;
    border-radius: 3px;
    padding: 2px;
    min-width: 80px;
    max-width: 150px;
  }

  .variadic-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
    padding: 2px 4px;
    background: #2a2a2a;
    border-radius: 2px;
    font-size: 9px;
  }

  .variadic-source {
    color: #aaa;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .variadic-remove {
    width: 14px;
    height: 14px;
    padding: 0;
    margin: 0;
    border: none;
    background: transparent;
    color: #666;
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 2px;
    flex-shrink: 0;
  }

  .variadic-remove:hover {
    background: #ff4444;
    color: #fff;
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
    cursor: text;
    user-select: none;
  }
  
  .node-name:hover {
    opacity: 0.8;
  }
  
  .node-name-input {
    background: #1a1a1a;
    border: 1px solid #4a9eff;
    border-radius: 3px;
    color: #fff;
    font-size: 11px;
    font-weight: 500;
    padding: 2px 4px;
    outline: none;
    min-width: 60px;
    width: auto;
    font-family: inherit;
  }
  
  .node-name-input:focus {
    border-color: #4a9eff;
    box-shadow: 0 0 0 1px #4a9eff;
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

