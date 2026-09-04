<script lang="ts">
  import type { Prop } from '@/types/node.types';
  import { onMount } from 'svelte';
  import ColorPicker from './ColorPicker.svelte';
  import { openColorPickerId } from '../stores/colorPickerStore';
  import { normalizeColor, colorToCss, type ColorObject } from '@/utils/colorUtils';
  
  export let prop: Prop;
  export let id: string;
  export let onValueChange: (value: any) => void;
  
  let points: Array<{ position: number; color: ColorObject; interpolation: string }> = [];
  let autoUpdate = true;
  let rampCanvas: HTMLCanvasElement;
  let rampCtx: CanvasRenderingContext2D | null = null;
  let draggingIndex: number | null = null;
  let dragStartX = 0;
  let selectedColorIndex: number | null = null;
  let showColorPicker = false;
  
  // Interpolation options
  const interpolationOptions = [
    { value: 'linear', label: 'Linear' },
    { value: 'constant', label: 'Constant' },
    { value: 'smooth', label: 'Smooth' }
  ];
  
  // Convert color object to hex for ColorPicker
  function colorToHex(color: ColorObject): string {
    const r = Math.round(color.r * 255).toString(16).padStart(2, '0');
    const g = Math.round(color.g * 255).toString(16).padStart(2, '0');
    const b = Math.round(color.b * 255).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`.toUpperCase();
  }
  
  // Update points from prop value
  function updatePoints() {
    if (Array.isArray(prop.value) && prop.value.length > 0) {
      // Normalize colors to objects (support backward compatibility with strings)
      points = prop.value.map((p: any) => ({
        position: p.position,
        color: typeof p.color === 'string' ? normalizeColor(p.color) : normalizeColor(p.color),
        interpolation: p.interpolation || 'linear'
      })).sort((a, b) => a.position - b.position);
    } else {
      points = [
        { position: 0.0, color: { r: 0.0, g: 0.0, b: 0.0 }, interpolation: 'linear' },
        { position: 1.0, color: { r: 1.0, g: 1.0, b: 1.0 }, interpolation: 'linear' }
      ];
    }
    drawRamp();
  }
  
  // Draw the ramp visualization
  function drawRamp() {
    if (!rampCtx || !rampCanvas) return;
    
    const width = rampCanvas.width;
    const height = rampCanvas.height;
    rampCtx.clearRect(0, 0, width, height);
    
    // Draw gradient
    const gradient = rampCtx.createLinearGradient(0, 0, width, 0);
    
    // Sort points by position
    const sortedPoints = [...points].sort((a, b) => a.position - b.position);
    
    for (const point of sortedPoints) {
      gradient.addColorStop(point.position, colorToCss(point.color));
    }
    
    rampCtx.fillStyle = gradient;
    rampCtx.fillRect(0, 0, width, height);
    
    // Draw control point indicators above ramp
    const pointSize = 12;
    const pointY = -pointSize - 2;
    
    for (let i = 0; i < sortedPoints.length; i++) {
      const point = sortedPoints[i];
      const x = point.position * width;
      
      // Draw color swatch
      rampCtx.fillStyle = colorToCss(point.color);
      rampCtx.fillRect(x - pointSize / 2, pointY, pointSize, pointSize);
      rampCtx.strokeStyle = '#ffffff';
      rampCtx.lineWidth = 1;
      rampCtx.strokeRect(x - pointSize / 2, pointY, pointSize, pointSize);
    }
    
    // Draw handles below ramp
    const handleY = height + 2;
    for (let i = 0; i < sortedPoints.length; i++) {
      const point = sortedPoints[i];
      const x = point.position * width;
      
      rampCtx.fillStyle = '#888888';
      rampCtx.beginPath();
      rampCtx.moveTo(x, handleY);
      rampCtx.lineTo(x - 4, handleY + 6);
      rampCtx.lineTo(x + 4, handleY + 6);
      rampCtx.closePath();
      rampCtx.fill();
    }
  }
  
  // Get point index at position
  function getPointAtPosition(x: number): number | null {
    const rect = rampCanvas.getBoundingClientRect();
    const localX = x - rect.left;
    const position = Math.max(0, Math.min(1, localX / rect.width));
    
    // Check if clicking near a point (within 10px)
    const sortedPoints = [...points].sort((a, b) => a.position - b.position);
    for (let i = 0; i < sortedPoints.length; i++) {
      const point = sortedPoints[i];
      const pointX = point.position * rect.width;
      if (Math.abs(localX - pointX) < 10) {
        return points.indexOf(point);
      }
    }
    
    return null;
  }
  
  // Handle mouse down on ramp
  function handleMouseDown(e: MouseEvent) {
    if (!rampCanvas) return;
    
    const rect = rampCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const position = Math.max(0, Math.min(1, x / rect.width));
    
    const pointIndex = getPointAtPosition(e.clientX);
    
    if (pointIndex !== null) {
      // Start dragging existing point
      draggingIndex = pointIndex;
      dragStartX = e.clientX;
    } else if (e.button === 0) {
      // Left click: add new point
      addPoint(position);
    }
  }
  
  // Handle mouse move
  function handleMouseMove(e: MouseEvent) {
    if (draggingIndex !== null && rampCanvas) {
      const rect = rampCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const newPosition = Math.max(0, Math.min(1, x / rect.width));
      
      points[draggingIndex].position = newPosition;
      points.sort((a, b) => a.position - b.position);
      drawRamp();
      
      if (autoUpdate) {
        onValueChange([...points]);
      }
    }
  }
  
  // Handle mouse up
  function handleMouseUp() {
    if (draggingIndex !== null) {
      draggingIndex = null;
      if (!autoUpdate) {
        onValueChange([...points]);
      }
    }
  }
  
  // Add a new point
  function addPoint(position: number) {
    // Find color at position
    const sortedPoints = [...points].sort((a, b) => a.position - b.position);
    let color: ColorObject = { r: 0.5, g: 0.5, b: 0.5 };
    
    for (let i = 0; i < sortedPoints.length - 1; i++) {
      if (position >= sortedPoints[i].position && position <= sortedPoints[i + 1].position) {
        const t = (position - sortedPoints[i].position) / (sortedPoints[i + 1].position - sortedPoints[i].position);
        // Simple interpolation for new point color
        const c1 = sortedPoints[i].color;
        const c2 = sortedPoints[i + 1].color;
        color = {
          r: c1.r + (c2.r - c1.r) * t,
          g: c1.g + (c2.g - c1.g) * t,
          b: c1.b + (c2.b - c1.b) * t
        };
        break;
      }
    }
    
    points.push({
      position,
      color,
      interpolation: 'linear'
    });
    
    points.sort((a, b) => a.position - b.position);
    drawRamp();
    onValueChange([...points]);
  }
  
  // Remove a point
  function removePoint(index: number) {
    if (points.length <= 2) return; // Keep at least 2 points
    
    points.splice(index, 1);
    drawRamp();
    onValueChange([...points]);
  }
  
  // Update point color
  function updatePointColor(index: number, color: ColorObject) {
    points[index].color = color;
    drawRamp();
    onValueChange([...points]);
  }
  
  // Update point interpolation
  function updatePointInterpolation(index: number, interpolation: string) {
    points[index].interpolation = interpolation;
    drawRamp();
    onValueChange([...points]);
  }
  
  // Update point position
  function updatePointPosition(index: number, position: number) {
    points[index].position = Math.max(0, Math.min(1, position));
    points.sort((a, b) => a.position - b.position);
    drawRamp();
    onValueChange([...points]);
  }
  
  // Initialize
  onMount(() => {
    updatePoints();
    
    if (rampCanvas) {
      rampCtx = rampCanvas.getContext('2d');
      rampCanvas.width = rampCanvas.offsetWidth;
      rampCanvas.height = 20;
      drawRamp();
    }
    
    // Global mouse handlers for dragging
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  });
  
  // Watch for prop changes
  $: if (prop.value) {
    updatePoints();
  }
</script>

<div class="color-ramp-editor">
  <div class="ramp-header">
    <label class="ramp-label">{prop.displayName || 'Ramp'}</label>
    <label class="auto-update-label">
      <input type="checkbox" bind:checked={autoUpdate} />
      Auto-update
    </label>
  </div>
  
  <div class="ramp-visualization">
    <canvas
      bind:this={rampCanvas}
      class="ramp-canvas"
      on:mousedown={handleMouseDown}
      on:contextmenu|preventDefault={(e) => {
        const pointIndex = getPointAtPosition(e.clientX);
        if (pointIndex !== null) {
          // Right-click on point - could show context menu
        } else {
          // Right-click on ramp - add point
          const rect = rampCanvas.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const position = Math.max(0, Math.min(1, x / rect.width));
          addPoint(position);
        }
      }}
    ></canvas>
    
    <!-- Color swatches above ramp -->
    <div class="color-swatches">
      {#each points.sort((a, b) => a.position - b.position) as point, i}
        {@const sortedIndex = points.indexOf(point)}
        <div
          class="color-swatch"
          style="left: {point.position * 100}%"
          on:click={() => {
            selectedColorIndex = sortedIndex;
            showColorPicker = true;
          }}
        >
          <div class="swatch-color" style="background-color: {point.color}"></div>
        </div>
      {/each}
    </div>
    
    <!-- Handles below ramp -->
    <div class="ramp-handles">
      {#each points.sort((a, b) => a.position - b.position) as point, i}
        {@const sortedIndex = points.indexOf(point)}
        <div
          class="ramp-handle"
          style="left: {point.position * 100}%"
          on:mousedown|stopPropagation={(e) => {
            draggingIndex = sortedIndex;
            dragStartX = e.clientX;
          }}
        ></div>
      {/each}
    </div>
  </div>
  
  <!-- Points table -->
  <div class="ramp-points-table">
    <div class="table-header">
      <span>Position</span>
      <span>Color</span>
      <span>Interp.</span>
      <span class="table-actions">
        <button class="icon-button" on:click={() => addPoint(0.5)} title="Add Point">+</button>
      </span>
    </div>
    
    {#each points.sort((a, b) => a.position - b.position) as point, i}
      {@const sortedIndex = points.indexOf(point)}
      <div class="table-row">
        <input
          type="number"
          class="position-input"
          value={point.position.toFixed(3)}
          min="0"
          max="1"
          step="0.001"
          on:input={(e) => {
            const target = e.target;
            if (target instanceof HTMLInputElement) {
              const value = parseFloat(target.value);
              updatePointPosition(sortedIndex, value);
            }
          }}
        />
        <div
          class="color-cell"
          style="background-color: {point.color}"
          on:click={() => {
            selectedColorIndex = sortedIndex;
            showColorPicker = true;
          }}
        ></div>
        <select
          class="interpolation-select"
          value={point.interpolation}
          on:change={(e) => {
            const target = e.target;
            if (target instanceof HTMLSelectElement) {
              updatePointInterpolation(sortedIndex, target.value);
            }
          }}
        >
          {#each interpolationOptions as opt}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
        <div class="table-row-actions">
          <button
            class="icon-button"
            on:click={() => addPoint((point.position + (points[sortedIndex + 1]?.position || 1)) / 2)}
            title="Add Point"
          >+</button>
          <button
            class="icon-button delete-button"
            on:click={() => removePoint(sortedIndex)}
            title="Delete Point"
            disabled={points.length <= 2}
          >×</button>
        </div>
      </div>
    {/each}
  </div>
  
  <!-- Color Picker (shown when clicking on color) -->
  {#if showColorPicker && selectedColorIndex !== null}
    <div class="color-picker-overlay" on:click|self={() => showColorPicker = false}>
      <div class="color-picker-container" on:click|stopPropagation>
        <ColorPicker
          prop={{
            value: points[selectedColorIndex].color,
            type: 'color'
          }}
          id={`${id}-color-picker`}
          onValueChange={(color) => {
            if (selectedColorIndex !== null) {
              updatePointColor(selectedColorIndex, color);
            }
            showColorPicker = false;
          }}
        />
      </div>
    </div>
  {/if}
</div>

<style>
  .color-ramp-editor {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px;
    background: var(--surface-panel-alt);
    border-radius: 4px;
  }
  
  .ramp-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  
  .ramp-label {
    font-size: 12px;
    color: var(--text-bright);
  }
  
  .auto-update-label {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--text-secondary);
    cursor: pointer;
  }
  
  .ramp-visualization {
    position: relative;
    height: 40px;
    margin: 8px 0;
  }
  
  .ramp-canvas {
    width: 100%;
    height: 20px;
    cursor: crosshair;
    border: 1px solid var(--border);
    border-radius: 2px;
  }
  
  .color-swatches {
    position: absolute;
    top: -14px;
    left: 0;
    right: 0;
    height: 12px;
    pointer-events: none;
  }
  
  .color-swatch {
    position: absolute;
    width: 12px;
    height: 12px;
    margin-left: -6px;
    cursor: pointer;
    pointer-events: all;
  }
  
  .swatch-color {
    width: 100%;
    height: 100%;
    border: 1px solid var(--border-bright);
    box-sizing: border-box;
  }
  
  .ramp-handles {
    position: absolute;
    bottom: -6px;
    left: 0;
    right: 0;
    height: 8px;
    pointer-events: none;
  }
  
  .ramp-handle {
    position: absolute;
    width: 0;
    height: 0;
    margin-left: -4px;
    border-left: 4px solid transparent;
    border-right: 4px solid transparent;
    border-top: 6px solid var(--border-muted);
    cursor: move;
    pointer-events: all;
  }
  
  .ramp-points-table {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 11px;
  }
  
  .table-header {
    display: grid;
    grid-template-columns: 80px 40px 80px 1fr;
    gap: 8px;
    padding: 4px;
    color: var(--text-secondary);
    font-weight: 500;
  }
  
  .table-actions {
    text-align: right;
  }
  
  .table-row {
    display: grid;
    grid-template-columns: 80px 40px 80px 1fr;
    gap: 8px;
    padding: 4px;
    align-items: center;
  }
  
  .position-input {
    width: 100%;
    padding: 2px 4px;
    background: var(--surface-control);
    border: 1px solid var(--border);
    border-radius: 2px;
    color: var(--text-bright);
    font-size: 11px;
  }
  
  .color-cell {
    width: 32px;
    height: 20px;
    border: 1px solid var(--border);
    border-radius: 2px;
    cursor: pointer;
  }
  
  .interpolation-select {
    width: 100%;
    padding: 2px 4px;
    background: var(--surface-control);
    border: 1px solid var(--border);
    border-radius: 2px;
    color: var(--text-bright);
    font-size: 11px;
  }
  
  .table-row-actions {
    display: flex;
    gap: 4px;
    justify-content: flex-end;
  }
  
  .icon-button {
    width: 20px;
    height: 20px;
    padding: 0;
    background: var(--surface-control);
    border: 1px solid var(--border);
    border-radius: 2px;
    color: var(--text-bright);
    cursor: pointer;
    font-size: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  .icon-button:hover:not(:disabled) {
    background: var(--surface-hover);
  }
  
  .icon-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .delete-button {
    color: var(--status-error);
  }
  
  .color-picker-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: var(--shade-medium);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  
  .color-picker-container {
    background: var(--surface-panel-alt);
    border-radius: 8px;
    padding: 16px;
  }
</style>

