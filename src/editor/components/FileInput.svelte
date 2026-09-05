<script lang="ts">
  import type { Prop } from '@/types/node.types';
  import { onMount } from 'svelte';
  
  export let prop: Prop;
  export let id: string;
  export let onValueChange: (value: string) => void;
  
  let fileInput: HTMLInputElement;
  let previewUrl: string | null = null;
  let previewType: 'image' | 'video' | 'none' = 'none';
  
  $: value = typeof prop.value === 'string' ? prop.value : '';
  $: accept = prop.params?.accept || '*/*';
  $: disabled = typeof prop.disabled === 'function' ? prop.disabled() : prop.disabled;
  
  // Check if value is a visual file
  $: if (value) {
    const isImage = /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(value) || value.startsWith('data:image/');
    const isVideo = /\.(mp4|webm|mov)$/i.test(value) || value.startsWith('data:video/');
    
    if (isImage) {
      previewType = 'image';
      previewUrl = value.startsWith('data:') || value.startsWith('http') ? value : value;
    } else if (isVideo) {
      previewType = 'video';
      previewUrl = value.startsWith('data:') || value.startsWith('http') ? value : value;
    } else {
      previewType = 'none';
      previewUrl = null;
    }
  } else {
    previewType = 'none';
    previewUrl = null;
  }
  
  function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    
    // Create object URL for preview
    if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
      previewUrl = URL.createObjectURL(file);
      previewType = file.type.startsWith('image/') ? 'image' : 'video';
    }
    
    // For now, use the file name. In a real implementation, this would upload or reference the file
    onValueChange(file.name);
  }
  
  function handleClear() {
    if (previewUrl && previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(previewUrl);
    }
    previewUrl = null;
    previewType = 'none';
    onValueChange('');
    if (fileInput) {
      fileInput.value = '';
    }
  }
  
  function handleDrop(e: DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer?.files[0];
    if (!file) return;
    
    if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
      previewUrl = URL.createObjectURL(file);
      previewType = file.type.startsWith('image/') ? 'image' : 'video';
    }
    
    onValueChange(file.name);
  }
  
  function handleDragOver(e: DragEvent) {
    e.preventDefault();
  }
</script>

<div class="file-input-container">
  <div class="file-controls">
    <input
      bind:this={fileInput}
      type="file"
      id={id}
      accept={accept}
      disabled={disabled}
      on:change={handleFileSelect}
      style="display: none;"
    />
    <button
      class="file-button"
      disabled={disabled}
      on:click={() => fileInput?.click()}
    >
      Choose File
    </button>
    {#if value}
      <button
        class="clear-button"
        disabled={disabled}
        on:click={handleClear}
        title="Clear file"
      >
        ×
      </button>
    {/if}
  </div>
  
  {#if value}
    <div class="file-info">
      <span class="file-name" title={value}>{value}</span>
    </div>
  {/if}
  
  {#if previewType === 'image' && previewUrl}
    <div class="preview-container">
      <img src={previewUrl} alt="Preview" class="preview-image" />
    </div>
  {:else if previewType === 'video' && previewUrl}
    <div class="preview-container">
      <!-- User-selected local previews do not have an associated caption track. -->
      <!-- svelte-ignore a11y_media_has_caption -->
      <video src={previewUrl} class="preview-video" controls></video>
    </div>
  {/if}
  
  <div
    class="drop-zone"
    role="region"
    aria-label="File drop zone"
    class:has-preview={previewType !== 'none'}
    on:drop={handleDrop}
    on:dragover={handleDragOver}
  >
    {#if !value}
      <span class="drop-hint">Drop file here</span>
    {/if}
  </div>
</div>

<style>
  .file-input-container {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  
  .file-controls {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  
  .file-button {
    padding: 6px 12px;
    background: var(--accent-tint-medium);
    border: 1px solid var(--accent);
    border-radius: 3px;
    color: var(--accent);
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  
  .file-button:hover:not(:disabled) {
    background: var(--accent-tint-strong);
  }
  
  .file-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .clear-button {
    padding: 4px 8px;
    background: var(--tint-weak);
    border: 1px solid var(--tint);
    border-radius: 3px;
    color: var(--text-muted);
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  
  .clear-button:hover:not(:disabled) {
    background: var(--tint);
    color: var(--text-bright);
  }
  
  .clear-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .file-info {
    display: flex;
    align-items: center;
  }
  
  .file-name {
    font-size: 11px;
    color: var(--text-muted);
    font-family: 'Monaco', 'Menlo', monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .preview-container {
    width: 100%;
    max-height: 120px;
    border: 1px solid var(--tint);
    border-radius: 3px;
    overflow: hidden;
    background: var(--shade-weak);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  .preview-image {
    max-width: 100%;
    max-height: 120px;
    object-fit: contain;
  }
  
  .preview-video {
    max-width: 100%;
    max-height: 120px;
    object-fit: contain;
  }
  
  .drop-zone {
    min-height: 40px;
    border: 1px dashed var(--tint);
    border-radius: 3px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
  }
  
  .drop-zone.has-preview {
    border: none;
    min-height: 0;
  }
  
  .drop-zone:hover {
    border-color: var(--accent-tint-half);
    background: var(--accent-tint-weakest);
  }
  
  .drop-hint {
    font-size: 11px;
    color: var(--text-faintest);
  }
</style>
