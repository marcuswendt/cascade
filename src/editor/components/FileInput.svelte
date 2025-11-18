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
      <video src={previewUrl} class="preview-video" controls></video>
    </div>
  {/if}
  
  <div
    class="drop-zone"
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
    background: rgba(74, 158, 255, 0.2);
    border: 1px solid #4a9eff;
    border-radius: 3px;
    color: #4a9eff;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  
  .file-button:hover:not(:disabled) {
    background: rgba(74, 158, 255, 0.3);
  }
  
  .file-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .clear-button {
    padding: 4px 8px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    color: #aaa;
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  
  .clear-button:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
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
    color: #aaa;
    font-family: 'Monaco', 'Menlo', monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .preview-container {
    width: 100%;
    max-height: 120px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    overflow: hidden;
    background: rgba(0, 0, 0, 0.3);
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
    border: 1px dashed rgba(255, 255, 255, 0.1);
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
    border-color: rgba(74, 158, 255, 0.5);
    background: rgba(74, 158, 255, 0.05);
  }
  
  .drop-hint {
    font-size: 11px;
    color: #666;
  }
</style>

