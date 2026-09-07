<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Node } from '@/nodes/Node';
  import { getNodeIcon } from './nodeTemplates';
  import Icon from './Icon.svelte';
  import { getPortColor } from '@/utils/portColors';
  import { propUpdateCounters } from './stores/propUpdateStore';
  import { runsOnByModule, iconByModule, moduleName, type RunsOn } from './stores/executionLocus';
  import { graphStructure } from './stores/graphStructure';

  export let node: Node;
  export let selected = false;
  export let canvasTransform: { x: number; y: number; zoom: number } = { x: 0, y: 0, zoom: 1 };

  const dispatch = createEventDispatcher();

  // Where this node's work happens. Server-side nodes hand their work to the
  // Python bridge; browser-side nodes do it in the page; portable nodes have
  // equivalent host-selected implementations.
  $: runsOn = ((): RunsOn | null => {
    const name = moduleName((node as any).modulePath);
    return name ? ($runsOnByModule[name] ?? null) : null;
  })();

  // Watch prop update counter to force reactivity when props change
  let propsUpdateCounter = 0;
  $: {
    const counters = $propUpdateCounters;
    propsUpdateCounter = node ? (counters.get(node.id) || 0) : 0;
  }

  $: cookState = node.cookState;
  $: hasError = cookState === 'error' || node.error !== null;
  // A project node's own declared icon wins over Cascade's built-in table,
  // which only knows the stdlib and hands everything else the same cog.
  $: nodeIcon = (() => {
    const mod = moduleName((node as any).modulePath);
    return (mod && $iconByModule[mod]) || getNodeIcon(node.type);
  })();

  /** Per-node colour, set from the palette and stored on the node. Used to group
   *  a pipeline visually — all the density nodes one colour, the signals
   *  another — which is faster to read than any label. */
  $: nodeColor = (node as any).color || null;
  $: isBypassed = node.bypass;
  $: isCookEnabled = node.cook;
  $: isCooking = cookState === 'cooking';
  // Reactive statements to track port changes
  // $graphStructure is referenced so these recompute when ports appear during a
  // cook — see stores/graphStructure.ts.
  function afterStructureChange<T>(version: number, value: T): T {
    void version;
    return value;
  }

  $: inputs = afterStructureChange($graphStructure, node.inputs);
  $: outputs = afterStructureChange($graphStructure, node.outputs);
  $: position = afterStructureChange($graphStructure, node.position);

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
  let tooltip: { name: string; dataType: string; color: string; x: number; y: number; type: 'input' | 'output' } | null = null;
  let isEditingName = false;
  let nameInput: HTMLInputElement;
  let tempName = node.id;

  function showPortTooltip(e: MouseEvent, portName: string, dataType: string, color: string, portType: 'input' | 'output') {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();

    // getBoundingClientRect returns viewport coordinates, but since the tooltip
    // is inside the transformed canvas container, we need to convert to container space
    const viewportX = rect.left + rect.width / 2;
    const viewportY = portType === 'input' ? rect.bottom : rect.top;

    // Convert viewport coordinates to container coordinates
    // (accounting for canvas pan and zoom)
    const containerX = (viewportX - canvasTransform.x) / canvasTransform.zoom;
    const containerY = (viewportY - canvasTransform.y) / canvasTransform.zoom;

    // Small offset in container space (2px gap between port and tooltip)
    const offset = 2;
    tooltip = {
      name: portName,
      dataType,
      color,
      x: containerX,
      y: portType === 'input' ? containerY + offset : containerY - offset,
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
  
  /** Hand the node's address to whatever it is dropped on. */
  function handleNameDragStart(event: DragEvent): void {
    // Stop the canvas seeing this as the start of a node move.
    event.stopPropagation();
    if (!event.dataTransfer) return;
    event.dataTransfer.setData('text/plain', node.id);
    event.dataTransfer.effectAllowed = 'copy';
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
  tabindex="-1"
  aria-label="Node: {node.id}"
  class:selected
  class:error={hasError}
  class:dragging={isDragging}
  class:bypassed={isBypassed}
  class:stale={cookState === 'stale'}
  class:queued={cookState === 'queued'}
  class:cooking={isCooking}
  data-cook-state={cookState}
  style="left: {position.x}px; top: {position.y}px; opacity: {node.bypass ? 0.5 : 1}"
  data-node-id={node.id}
  on:click={(e) => {
    e.stopPropagation();
    dispatch('nodeClick', { event: e });
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
                on:mouseenter={(e) => showPortTooltip(e, port.name, port.dataType || 'any', portColor, 'input')}
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
                  on:mouseenter={(e) => showPortTooltip(e, displayPort.baseName, displayPort.firstPort.dataType || 'any', portColor, 'input')}
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
          <div class="variadic-list" role="list" on:mousedown|stopPropagation>
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

        <div class="body" class:tinted={!!nodeColor} style={nodeColor ? `--node-fill:${nodeColor}` : ''}>
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

          {#if runsOn}
            {@const locusLabel = runsOn === 'server' ? 'S' : runsOn === 'browser' ? 'B' : 'P'}
            {@const locusTitle = runsOn === 'server'
              ? 'Runs on the server'
              : runsOn === 'browser'
                ? 'Runs in the browser'
                : 'Portable: browser or server implementation'}
            <span
              class="locus-badge locus-{runsOn}"
              title={locusTitle}
            >{locusLabel}</span>
          {/if}

          <!-- Cook button (right side) -->
          <button
            class="node-button cook-button"
            class:active={isCookEnabled}
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
              on:mouseenter={(e) => showPortTooltip(e, port.name, port.dataType || 'any', portColor, 'output')}
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
        <!-- The name is the drag handle for the node's address. The node body
             cannot be it: the canvas moves nodes with mouse events, and a
             native HTML5 drag on the same element would fight it for the
             pointer. The name is already a click target for renaming rather
             than a drag target, so it is the one part of a node that is free.
             `text/plain` carries the address, which is the contract the agent
             console reads and the same string that goes in an expression. -->
        <span 
          class="node-name"
          role="button"
          tabindex="0"
          draggable="true"
          on:dragstart={handleNameDragStart}
          on:click={startEditingName}
          on:keydown={handleNameKeyDownSpan}
          title="Click to rename · drag into the agent console for its path"
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
    style="left: {tooltip.x}px; top: {tooltip.y}px; border-color: {tooltip.color};"
    role="tooltip"
  >
    <span class="tooltip-name">{tooltip.name}</span>
    <span class="tooltip-type" style="color: {tooltip.color};">{tooltip.dataType}</span>
  </div>
{/if}


<style>
  .locus-badge {
    position: absolute;
    top: 3px;
    right: 3px;
    width: 11px;
    height: 11px;
    border-radius: 3px;
    font-size: 8px;
    font-weight: 700;
    line-height: 11px;
    text-align: center;
    letter-spacing: 0;
    pointer-events: auto;
    user-select: none;
  }

  /* Amber for server-side work, blue for in-page. Deliberately quiet: it is a
     property of the node, not an alert about it. */
  .locus-server {
    background: var(--syntax-regexp-tint);
    color: var(--syntax-regexp);
  }

  .locus-browser {
    background: var(--syntax-variable-tint);
    color: var(--syntax-variable);
  }

  .locus-portable {
    background: var(--status-ok-tint);
    color: var(--status-ok-soft);
  }

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
    --node-border-color: var(--accent);
  }
  
  .node.error {
    --node-border-color: var(--status-error-strong);
  }

  .node.stale .node-container {
    opacity: 0.52;
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
    background: var(--surface-panel);
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
    background: var(--surface-control);
    border-radius: 2px;
    font-size: 9px;
  }

  .variadic-source {
    color: var(--text-muted);
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
    color: var(--text-faintest);
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
    background: var(--status-error-strong);
    color: var(--text-on-accent);
  }

  /* The node's own colour arrives as a custom property, never as an inline
     border. An inline style beats any stylesheet rule, so setting the border
     here directly overrode the selected state and the selection outline
     silently vanished the moment a node was given a colour. */
  .body {
    /* Grows to fit its port row rather than clipping it. A node with many
       parameters — render-preview has fourteen inputs — laid its ports out past
       the edge of a fixed 80px box, which read as a broken node. Position is
       relative so the runs-on badge anchors to the box itself and not to the
       wider row that includes the name label. */
    min-width: 80px;
    align-self: stretch;
    position: relative;
    height: 36px;
    background: var(--surface-control);
    border-radius: 5px;
    border: 1px solid var(--node-border-color, var(--border));
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0;
    gap: 0;
    margin: 0;
  }

  /* Cook feedback is its own visual channel. The pseudo-element leaves both
     the authored --node-fill and the selection box-shadow untouched. */
  .node.queued .body::after,
  .node.cooking .body::after {
    content: '';
    position: absolute;
    inset: -4px;
    border: 2px solid var(--accent-cyan-tint-strong);
    border-radius: 8px;
    pointer-events: none;
  }

  .node.queued .body::after {
    border-style: dashed;
    opacity: 0.55;
  }

  .node.cooking .body::after {
    animation: cascade-cook-pulse 1.15s ease-in-out infinite;
  }

  @keyframes cascade-cook-pulse {
    0%, 100% {
      opacity: 0.45;
      transform: scale(0.98);
    }
    50% {
      opacity: 1;
      transform: scale(1.035);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .node.cooking .body::after {
      animation: none;
      opacity: 1;
    }
  }
  
  /* Selection has to survive whatever colour the node was given, so it is a
     ring outside the border rather than the border itself — a coloured node
     was making the old border-only cue invisible. */
  /* An authored node colour is a hue, not a surface.
     Documents in ~/Documents/Cascade carry colours like #2a3a4a and #4a3a2a,
     chosen against a black canvas. Painted as an opaque fill they were the
     nodes; on a light canvas they read as holes punched in the graph. So the
     authored colour is mixed into whatever the theme's node surface is, at a
     strength the theme sets: full in dark, where it is the fill it was drawn
     as, and a tint in light. The document is never touched, and the author's
     colour coding still means what it meant. */
  .body.tinted {
    background: color-mix(in oklab, var(--node-fill) var(--node-tint-strength, 100%), var(--surface-control));
  }

  .node.selected .body {
    border-color: var(--node-border-color);
    box-shadow: 0 0 0 2px var(--accent), 0 0 12px var(--accent-tint-strong);
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
    color: var(--text-bright);
    flex: 1;
  }
  
  .node-button {
    width: 16px;
    height: 36px;
    border: 0px solid var(--border-strong);
    background: var(--surface-panel);
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
    background: var(--surface-control);
    border-color: var(--border-dim);
  }
  
  .node-button.active {
    background: var(--accent);
    border-color: var(--accent);
  }
  
  .bypass-button.active {
    background: var(--status-attention);
    border-color: var(--status-attention);
  }
  
  .cook-button.active {
    background: var(--accent);
    border-color: var(--accent);
  }
  
  .button-label {
    font-size: 9px;
    font-weight: 600;
    color: var(--text-bright);
    line-height: 1;
    user-select: none;
  }
  
  .label {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    font-size: 11px;
    color: var(--text-bright);
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
    background: var(--surface-panel);
    border: 1px solid var(--accent);
    border-radius: 3px;
    color: var(--text-bright);
    font-size: 11px;
    font-weight: 500;
    padding: 2px 4px;
    outline: none;
    min-width: 60px;
    width: auto;
    font-family: inherit;
  }
  
  .node-name-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  
  
  .comment {
    margin-top: 4px;
    font-size: 10px;
    color: var(--text-faintest);
    font-style: italic;
  }
  
  .error-message {
    margin-top: 4px;
    padding: 4px;
    background: var(--status-error-strong);
    color: var(--text-on-accent);
    font-size: 10px;
    border-radius: 2px;
  }
  
  .port-tooltip {
    position: absolute;
    pointer-events: none;
    background: var(--surface-panel);
    color: var(--text-bright);
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 11px;
    white-space: nowrap;
    z-index: 10000;
    border: 1px solid;
    box-shadow: 0 2px 8px var(--shadow);
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .tooltip-name {
    font-weight: 500;
  }

  .tooltip-type {
    font-size: 10px;
    opacity: 0.9;
  }

  .port-tooltip-input {
    transform: translate(-50%, 0);
  }

  .port-tooltip-output {
    transform: translate(-50%, -100%);
  }

</style>
