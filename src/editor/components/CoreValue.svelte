<script lang="ts">
  import { coerceImageRef, isIntegerType, normalizeType, TYPE_COMPONENTS } from '@/types/coreTypes';
  import GeometryPreview from './GeometryPreview.svelte';
  import StructuredValue from './StructuredValue.svelte';
  import { typeRenderer } from './typeRenderers';
  import './registerRenderers';
  import {
    colorCss,
    colorHex,
    inferCascadeType,
    mediaUrl,
    normalizeColorTuple,
    summarizeValue,
    type PresentationMode,
  } from './typePresentation';

  export let type = 'any';
  export let value: any;
  export let mode: PresentationMode = 'inspect';
  export let readOnly = false;
  export let port: any = null;
  export let node: any = null;
  export let onChange: ((value: any) => void) | null = null;

  const GEOMETRY_TYPES = new Set(['points', 'lines', 'polyline', 'mesh', 'rects']);

  $: normalizedType = normalizeType(type);
  $: effectiveType = normalizedType === 'any' ? inferCascadeType(value) : normalizedType;
  $: components = TYPE_COMPONENTS[effectiveType] ?? 0;
  $: isMatrix = effectiveType.startsWith('mat');
  $: matrixSide = isMatrix ? Math.sqrt(components) : 0;
  $: wantsInteger = isIntegerType(effectiveType);
  $: labels = effectiveType === 'color' ? ['R', 'G', 'B', 'A'] : ['X', 'Y', 'Z', 'W'].slice(0, components);
  // Object and array renderers are viewers. Keep the validated JSON editor for
  // writable parameters; named custom renderers may still provide onChange.
  $: renderer = !readOnly && (effectiveType === 'object' || effectiveType === 'array')
    ? null
    : typeRenderer(effectiveType);

  /**
   * A parameter is "bounded" when its declaration gives both a min and a max.
   * Only then is a slider honest — a slider over an unknown range invents a
   * scale, and dragging it would imply limits the node never stated.
   */
  $: bounds = {
    min: Number(port?.options?.min),
    max: Number(port?.options?.max),
    step: port?.options?.step ?? (effectiveType === 'int' ? 1 : 'any'),
  };
  $: bounded = Number.isFinite(bounds.min) && Number.isFinite(bounds.max) && bounds.max > bounds.min;

  function clampNumber(next: number): number {
    if (!Number.isFinite(next)) return bounds.min;
    const clamped = Math.min(bounds.max, Math.max(bounds.min, next));
    return effectiveType === 'int' ? Math.round(clamped) : clamped;
  }
  $: image = effectiveType === 'image' ? coerceImageRef(value) : null;
  $: imageSrc = image ? mediaUrl(image.path, { width: mode === 'view' ? 1800 : 320 }) : '';
  $: color = normalizeColorTuple(value);

  function commit(next: any) {
    if (!readOnly && onChange) onChange(next);
  }

  function setComponent(index: number, raw: string) {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    const next = Array.isArray(value) ? [...value] : new Array(components).fill(0);
    next[index] = wantsInteger ? Math.round(parsed) : parsed;
    commit(next);
  }

  function identity() {
    const next = new Array(components).fill(0);
    for (let index = 0; index < matrixSide; index++) next[index * matrixSide + index] = 1;
    commit(next);
  }

  function setColor(index: number, raw: string) {
    const next = [...color] as [number, number, number, number];
    next[index] = Math.max(0, Math.min(1, Number(raw)));
    commit(next);
  }

  function setColorHex(hex: string) {
    const next = normalizeColorTuple(hex);
    next[3] = color[3];
    commit(next);
  }

</script>

<div class="core-value mode-{mode}" data-type={effectiveType}>
  {#if renderer}
    {#if renderer.kind === 'project'}
      <svelte:component
        this={renderer.component}
        {value}
        {readOnly}
        {mode}
        onChange={readOnly ? null : commit}
        panelName={renderer.panelName}
        rendererType={renderer.rendererType}
      />
    {:else}
      <svelte:component
        this={renderer.component}
        {value}
        {port}
        {readOnly}
        {mode}
        {node}
        onChange={readOnly ? null : commit}
      />
    {/if}
  {:else if isMatrix}
    <div class="matrix" style="grid-template-columns: repeat({matrixSide}, minmax(0, 1fr))">
      {#each Array(components) as _, index}
        <input
          aria-label="Row {Math.floor(index / matrixSide) + 1}, column {(index % matrixSide) + 1}"
          type="number"
          class="cell"
          disabled={readOnly}
          value={Array.isArray(value) ? value[index] ?? 0 : 0}
          on:change={(event) => setComponent(index, event.currentTarget.value)}
        />
      {/each}
    </div>
    {#if !readOnly}<button class="reset" on:click={identity}>Identity</button>{/if}
  {:else if effectiveType === 'color'}
    <div class="color-row">
      {#if readOnly}
        <span class="swatch" style="background:{colorCss(color)}"></span>
      {:else}
        <input aria-label="Color" type="color" value={colorHex(color)} on:input={(event) => setColorHex(event.currentTarget.value)} />
      {/if}
      <span class="color-css">{colorCss(color)}</span>
    </div>
    {#if !readOnly || mode === 'view'}
      <div class="vector">
        {#each color as component, index}
          <label class="component">
            <span>{labels[index]}</span>
            <input aria-label={labels[index]} type="number" min="0" max="1" step="0.01" disabled={readOnly} value={component} on:change={(event) => setColor(index, event.currentTarget.value)} />
          </label>
        {/each}
      </div>
    {/if}
  {:else if components > 0}
    <div class="vector">
      {#each Array(components) as _, index}
        <label class="component">
          <span>{labels[index]}</span>
          <input
            aria-label={labels[index]}
            type="number"
            step={wantsInteger ? 1 : 'any'}
            disabled={readOnly}
            value={Array.isArray(value) ? value[index] ?? 0 : 0}
            on:change={(event) => setComponent(index, event.currentTarget.value)}
          />
        </label>
      {/each}
    </div>
  {:else if effectiveType === 'bool'}
    <label class="boolean"><input type="checkbox" disabled={readOnly} checked={Boolean(value)} on:change={(event) => commit(event.currentTarget.checked)} /> {Boolean(value) ? 'true' : 'false'}</label>
  {:else if (effectiveType === 'float' || effectiveType === 'int') && bounded}
    <!-- A bounded number gets a slider, because most parameters here have a
         range that means something — a gamma, a percentage, a contribution —
         and a range you can feel is worth far more than a range you have to
         remember. The number stays editable beside it for the cases where you
         know the value you want. -->
    <div class="slider-row">
      <input
        aria-label={effectiveType}
        type="range"
        min={bounds.min}
        max={bounds.max}
        step={bounds.step}
        disabled={readOnly}
        value={value ?? bounds.min}
        on:input={(event) => commit(clampNumber(Number(event.currentTarget.value)))}
      />
      <input
        aria-label="{effectiveType} value"
        type="number"
        class="slider-number"
        min={bounds.min}
        max={bounds.max}
        step={bounds.step}
        disabled={readOnly}
        value={value ?? bounds.min}
        on:change={(event) => commit(clampNumber(Number(event.currentTarget.value)))}
      />
    </div>

  {:else if effectiveType === 'float' || effectiveType === 'int'}
    <input aria-label={effectiveType} type="number" class="single" step={effectiveType === 'int' ? 1 : 'any'} disabled={readOnly} value={value ?? 0} on:change={(event) => commit(effectiveType === 'int' ? Math.round(Number(event.currentTarget.value)) : Number(event.currentTarget.value))} />
  {:else if effectiveType === 'string'}
    {#if mode === 'view' && readOnly}<pre class="text-value">{value ?? ''}</pre>{:else}<input aria-label="string" type="text" class="single" disabled={readOnly} value={value ?? ''} on:change={(event) => commit(event.currentTarget.value)} />{/if}
  {:else if effectiveType === 'image'}
    <div class="image">
      {#if image}
        <img src={imageSrc} alt={image.path} loading="lazy" />
        <div class="meta">{summarizeValue(image, effectiveType)}</div>
        <div class="path" title={image.path}>{image.path}</div>
      {:else}
        <div class="summary">No image reference</div>
      {/if}
      {#if !readOnly}
        <div class="structured">
          {#if typeof value === 'string'}
            <input aria-label="image path" type="text" class="single" value={value} on:change={(event) => commit(event.currentTarget.value)} />
          {:else}
            <StructuredValue {value} type="image" {onChange} />
          {/if}
        </div>
      {/if}
    </div>
  {:else if effectiveType === 'texture'}
    <div class="texture">
      <div class="meta">{summarizeValue(value, effectiveType)}</div>
      <div class="notice">Live browser resource · convert to image to cross runtimes</div>
    </div>
  {:else if GEOMETRY_TYPES.has(effectiveType)}
    <GeometryPreview {value} type={effectiveType} />
    {#if !readOnly}<div class="structured"><StructuredValue {value} type={effectiveType} {onChange} /></div>{/if}
  {:else if effectiveType === 'asset' && typeof value === 'string'}
    <input aria-label="asset path" type="text" class="single" disabled={readOnly} value={value} on:change={(event) => commit(event.currentTarget.value)} />
  {:else if effectiveType === 'array' || effectiveType === 'object' || effectiveType === 'any' || effectiveType === 'asset'}
    <StructuredValue {value} type={effectiveType} {readOnly} {onChange} />
  {:else}
    <div class="summary">{summarizeValue(value, effectiveType)}</div>
  {/if}
</div>

<style>
  .slider-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: 13px;
  }

  .slider-row input[type='range'] {
    flex: 1;
    min-width: 0;
    accent-color: #4a9eff;
    height: 14px;
  }

  .slider-number {
    width: 52px;
    flex: none;
  }

  .core-value { min-width: 0; }
  .core-value.mode-view { width: min(100%, 1100px); margin: auto; padding: 24px; box-sizing: border-box; }
  .vector { display: flex; gap: 5px; }
  .component { display: flex; align-items: center; gap: 3px; flex: 1; min-width: 0; }
  .component span { width: 9px; flex: none; color: #777; font-size: 9px; }
  .matrix { display: grid; gap: 4px; }
  input[type='number'], input[type='text'] { width: 100%; min-width: 0; box-sizing: border-box; border: 1px solid #3a3a3a; border-radius: 3px; background: #1e1e1e; color: #ddd; padding: 3px 5px; font: 10px ui-monospace, SFMono-Regular, Menlo, monospace; }
  input:disabled { background: #232323; color: #999; }
  input:focus { outline: none; border-color: #0e639c; }
  .reset { margin-top: 4px; border: 1px solid #3a3a3a; border-radius: 3px; background: none; color: #999; font-size: 9px; cursor: pointer; }
  .boolean { color: #bbb; font: 10px ui-monospace, SFMono-Regular, Menlo, monospace; }
  .image img { display: block; width: 100%; max-height: 70vh; object-fit: contain; border-radius: 4px; background: #111; }
  .meta, .path, .summary, .notice, .color-css { overflow: hidden; color: #888; font: 9px ui-monospace, SFMono-Regular, Menlo, monospace; text-overflow: ellipsis; white-space: nowrap; }
  .meta { margin-top: 5px; }
  .path { color: #666; }
  .notice { margin-top: 3px; color: #9b8264; }
  .color-row { display: flex; align-items: center; gap: 7px; margin-bottom: 5px; }
  input[type='color'] { width: 28px; height: 22px; border: 0; padding: 0; background: none; }
  .swatch { width: 24px; height: 18px; border: 1px solid #555; border-radius: 3px; }
  .structured { margin-top: 7px; }
  .text-value { margin: 0; color: #ddd; white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; }
  .mode-view .vector, .mode-view .matrix { max-width: 720px; margin-inline: auto; }
  .mode-view .component span, .mode-view input, .mode-view .boolean { font-size: 12px; }
</style>
