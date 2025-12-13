<script lang="ts">
  import type { CascadePanelParams } from '../dockview/types';
  import type { Graph } from '@/nodes/Graph';
  import type { Node } from '@/nodes/Node';
  import { sharedContextStore, panelLockStore } from '../dockview/renderer';
  import { typeToPackagePath } from '@/utils/nodeTypeUtils';
  import { LensNode, ImageBuffer } from '@/nodes/lens/LensNode';

  export let panelId: string;
  export let panelParams: CascadePanelParams;
  export let panelApi: any;
  export let containerApi: any;

  // Props from shared context
  export let graph: Graph | undefined = undefined;
  export let selectedNode: Node | null = null;

  // The node to actually display (locked or selected)
  $: lockState = $panelLockStore.get(panelId);
  $: isLocked = lockState?.isLocked ?? false;
  $: displayNode = isLocked ? lockState?.lockedNode : selectedNode;

  // Subscribe to context store for reactive updates
  $: if ($sharedContextStore) {
    graph = $sharedContextStore.graph;
    selectedNode = $sharedContextStore.selectedNode;
  }

  // Update panel title when display node changes
  $: {
    if (panelApi?.setTitle) {
      const lockPrefix = isLocked ? '~ ' : '';
      if (displayNode) {
        panelApi.setTitle(`${lockPrefix}Info: ${displayNode.id}`);
      } else {
        panelApi.setTitle(`${lockPrefix}Node Info`);
      }
    }
  }

  // Format time in human-readable format
  function formatTime(ms: number): string {
    if (ms < 0.01) return '< 0.01ms';
    if (ms < 1) return `${ms.toFixed(2)}ms`;
    if (ms < 1000) return `${ms.toFixed(1)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }

  // Format bytes in human-readable format
  function formatBytes(bytes: number): string {
    if (bytes === 0) return '-';
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
  }

  // Format timestamp
  function formatTimestamp(timestamp: number): string {
    if (timestamp === 0) return 'Never';
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
  }

  // Get full module path
  function getModulePath(node: Node): string {
    return typeToPackagePath(node.type);
  }

  // Get class name
  function getClassName(node: Node): string {
    return node.constructor.name;
  }

  // Get input count (excluding hidden)
  function getInputCount(node: Node): number {
    return node.inputs.filter(p => !p.options?.hidden).length;
  }

  // Get output count
  function getOutputCount(node: Node): number {
    return node.outputs.length;
  }

  // Get connected input count
  function getConnectedInputCount(node: Node): number {
    return node.inputs.filter(p => p.connections.length > 0).length;
  }

  // Get connected output count
  function getConnectedOutputCount(node: Node): number {
    return node.outputs.filter(p => p.connections.length > 0).length;
  }

  // Get prop count
  function getPropCount(node: Node): number {
    return Object.keys(node.props).length;
  }

  // Get expressions count
  function getExpressionCount(node: Node): number {
    return Object.values(node.props).filter(p => p.expression).length;
  }

  // Reset the cook info for the node
  function resetCookInfo() {
    if (displayNode?.resetCookInfo) {
      displayNode.resetCookInfo();
    }
  }

  // Check if node is a LensNode
  function isLensNode(node: Node): node is LensNode {
    return node instanceof LensNode;
  }

  // Get buffer info for lens nodes
  function getBufferInfo(node: Node) {
    if (isLensNode(node)) {
      return node.getBufferInfo();
    }
    return null;
  }

  // Get global buffer stats
  function getGlobalBufferStats() {
    return {
      totalBuffers: ImageBuffer.totalBufferCount,
      totalMemoryBytes: ImageBuffer.totalMemoryBytes,
      totalMemoryMB: ImageBuffer.totalMemoryMB
    };
  }

  // Format resolution
  function formatResolution(width: number, height: number): string {
    const megapixels = (width * height) / 1000000;
    if (megapixels >= 1) {
      return `${width} × ${height} (${megapixels.toFixed(1)}MP)`;
    }
    const kilopixels = (width * height) / 1000;
    return `${width} × ${height} (${kilopixels.toFixed(0)}K)`;
  }

  // Get channel layout description
  function getLayoutDescription(layout: string, channels: number): string {
    switch (layout) {
      case 'gray': return 'Grayscale (1ch)';
      case 'rgb': return 'RGB (3ch)';
      case 'rgba': return 'RGBA (4ch)';
      default: return `${channels} channels`;
    }
  }

  // Reactive buffer info
  $: bufferInfo = displayNode ? getBufferInfo(displayNode) : null;
  $: globalStats = getGlobalBufferStats();
</script>

<div class="cook-info-panel">
  {#if displayNode}
    <div class="info-sections">
      <!-- Node Identity -->
      <section class="info-section">
        <h3>Node</h3>
        <div class="info-grid">
          <div class="info-row">
            <span class="label">ID</span>
            <span class="value mono">{displayNode.id}</span>
          </div>
          <div class="info-row">
            <span class="label">Type</span>
            <span class="value mono">{displayNode.type}</span>
          </div>
          <div class="info-row">
            <span class="label">Module</span>
            <span class="value mono path">{getModulePath(displayNode)}</span>
          </div>
          <div class="info-row">
            <span class="label">Class</span>
            <span class="value mono">{getClassName(displayNode)}</span>
          </div>
          <div class="info-row">
            <span class="label">Path</span>
            <span class="value mono path">{displayNode.path()}</span>
          </div>
        </div>
      </section>

      <!-- Cook Performance -->
      <section class="info-section">
        <h3>
          Cook Performance
          <button class="reset-btn" onclick={resetCookInfo} title="Reset statistics">
            Reset
          </button>
        </h3>
        <div class="info-grid">
          <div class="info-row">
            <span class="label">Last Cook</span>
            <span class="value" class:slow={displayNode.cookInfo.lastCookTime > 100}>
              {formatTime(displayNode.cookInfo.lastCookTime)}
            </span>
          </div>
          <div class="info-row">
            <span class="label">Average</span>
            <span class="value" class:slow={displayNode.cookInfo.averageCookTime > 100}>
              {formatTime(displayNode.cookInfo.averageCookTime)}
            </span>
          </div>
          <div class="info-row">
            <span class="label">Total Time</span>
            <span class="value">{formatTime(displayNode.cookInfo.totalCookTime)}</span>
          </div>
          <div class="info-row">
            <span class="label">Cook Count</span>
            <span class="value">{displayNode.cookInfo.cookCount}</span>
          </div>
          <div class="info-row">
            <span class="label">Last Cooked</span>
            <span class="value">{formatTimestamp(displayNode.cookInfo.lastCookTimestamp)}</span>
          </div>
          <div class="info-row">
            <span class="label">Peak Memory</span>
            <span class="value">{formatBytes(displayNode.cookInfo.peakMemory)}</span>
          </div>
        </div>
      </section>

      <!-- ImageBuffer Info (for LensNodes) -->
      {#if bufferInfo}
        <section class="info-section buffer-section">
          <h3>Output Buffer</h3>
          <div class="info-grid">
            <div class="info-row resolution-row">
              <span class="label">Resolution</span>
              <span class="value mono highlight">
                {formatResolution(bufferInfo.width, bufferInfo.height)}
              </span>
            </div>
            <div class="info-row">
              <span class="label">Format</span>
              <span class="value">{getLayoutDescription(bufferInfo.layout, bufferInfo.channels)}</span>
            </div>
            <div class="info-row">
              <span class="label">Buffer Size</span>
              <span class="value">{bufferInfo.memorySizeStr}</span>
            </div>
          </div>
        </section>

        <!-- Global Buffer Stats -->
        <section class="info-section">
          <h3>Global Buffers</h3>
          <div class="info-grid">
            <div class="info-row">
              <span class="label">Active Buffers</span>
              <span class="value">{globalStats.totalBuffers}</span>
            </div>
            <div class="info-row">
              <span class="label">Total Memory</span>
              <span class="value" class:warning={globalStats.totalMemoryMB > 100}>
                {globalStats.totalMemoryMB.toFixed(1)} MB
              </span>
            </div>
          </div>
        </section>
      {/if}

      <!-- State -->
      <section class="info-section">
        <h3>State</h3>
        <div class="info-grid">
          <div class="info-row">
            <span class="label">Bypass</span>
            <span class="value" class:active={displayNode.bypass}>
              {displayNode.bypass ? 'Yes' : 'No'}
            </span>
          </div>
          <div class="info-row">
            <span class="label">Cook Flag</span>
            <span class="value" class:active={displayNode.cook}>
              {displayNode.cook ? 'Yes' : 'No'}
            </span>
          </div>
          <div class="info-row">
            <span class="label">Time Dependent</span>
            <span class="value" class:active={displayNode.isTimeDependent}>
              {displayNode.isTimeDependent ? 'Yes' : 'No'}
            </span>
          </div>
          <div class="info-row">
            <span class="label">Dirty</span>
            <span class="value" class:warning={displayNode.isDirty}>
              {displayNode.isDirty ? 'Yes' : 'No'}
            </span>
          </div>
          <div class="info-row">
            <span class="label">Variadic</span>
            <span class="value">{displayNode.variadic ? 'Yes' : 'No'}</span>
          </div>
        </div>
      </section>

      <!-- Ports & Props -->
      <section class="info-section">
        <h3>Ports & Parameters</h3>
        <div class="info-grid">
          <div class="info-row">
            <span class="label">Inputs</span>
            <span class="value">
              {getConnectedInputCount(displayNode)} / {getInputCount(displayNode)} connected
            </span>
          </div>
          <div class="info-row">
            <span class="label">Outputs</span>
            <span class="value">
              {getConnectedOutputCount(displayNode)} / {getOutputCount(displayNode)} connected
            </span>
          </div>
          <div class="info-row">
            <span class="label">Parameters</span>
            <span class="value">{getPropCount(displayNode)}</span>
          </div>
          <div class="info-row">
            <span class="label">Expressions</span>
            <span class="value" class:active={getExpressionCount(displayNode) > 0}>
              {getExpressionCount(displayNode)}
            </span>
          </div>
        </div>
      </section>

      <!-- Errors & Warnings -->
      {#if displayNode.error || displayNode.warning}
        <section class="info-section">
          <h3>Issues</h3>
          <div class="issues">
            {#if displayNode.error}
              <div class="issue error">
                <span class="issue-type">Error</span>
                <span class="issue-message">{displayNode.error.message}</span>
              </div>
            {/if}
            {#if displayNode.warning}
              <div class="issue warning">
                <span class="issue-type">Warning</span>
                <span class="issue-message">{displayNode.warning}</span>
              </div>
            {/if}
          </div>
        </section>
      {/if}

      <!-- Code (if present) -->
      {#if displayNode.code}
        <section class="info-section">
          <h3>Code</h3>
          <div class="info-grid">
            <div class="info-row">
              <span class="label">Lines</span>
              <span class="value">{displayNode.code.split('\n').length}</span>
            </div>
            <div class="info-row">
              <span class="label">Characters</span>
              <span class="value">{displayNode.code.length}</span>
            </div>
          </div>
        </section>
      {/if}
    </div>
  {:else}
    <div class="empty-state">
      <p>Select a node to view its information</p>
    </div>
  {/if}
</div>

<style>
  .cook-info-panel {
    width: 100%;
    height: 100%;
    overflow-y: auto;
    background: #0a0a0a;
    color: #e0e0e0;
    font-size: 12px;
  }

  .info-sections {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .info-section {
    background: #141414;
    border-radius: 6px;
    padding: 12px;
  }

  .info-section h3 {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #808080;
    margin: 0 0 10px 0;
    padding-bottom: 6px;
    border-bottom: 1px solid #2a2a2a;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .reset-btn {
    background: #2a2a2a;
    border: none;
    border-radius: 3px;
    color: #808080;
    font-size: 10px;
    padding: 2px 6px;
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .reset-btn:hover {
    background: #3a3a3a;
    color: #a0a0a0;
  }

  .info-grid {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .info-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .label {
    color: #707070;
    font-size: 11px;
  }

  .value {
    color: #c0c0c0;
    text-align: right;
  }

  .value.mono {
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    font-size: 11px;
  }

  .value.path {
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .value.slow {
    color: #ff9966;
  }

  .value.active {
    color: #66ccff;
  }

  .value.warning {
    color: #ffcc66;
  }

  .value.highlight {
    color: #88ddff;
    font-weight: 500;
  }

  .buffer-section {
    background: linear-gradient(135deg, #141414 0%, #1a1a22 100%);
    border: 1px solid #2a2a3a;
  }

  .resolution-row .value {
    font-size: 12px;
  }

  .issues {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .issue {
    padding: 8px;
    border-radius: 4px;
    font-size: 11px;
  }

  .issue.error {
    background: rgba(255, 80, 80, 0.15);
    border: 1px solid rgba(255, 80, 80, 0.3);
  }

  .issue.warning {
    background: rgba(255, 180, 80, 0.15);
    border: 1px solid rgba(255, 180, 80, 0.3);
  }

  .issue-type {
    font-weight: 600;
    text-transform: uppercase;
    font-size: 10px;
    letter-spacing: 0.3px;
    display: block;
    margin-bottom: 4px;
  }

  .issue.error .issue-type {
    color: #ff6666;
  }

  .issue.warning .issue-type {
    color: #ffaa66;
  }

  .issue-message {
    color: #b0b0b0;
    word-break: break-word;
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #505050;
  }

  .empty-state p {
    margin: 0;
    font-size: 13px;
  }
</style>
