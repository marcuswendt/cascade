<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Icon from './Icon.svelte';
  import { X } from 'lucide-svelte';

  export let open = false;

  const dispatch = createEventDispatcher();

  // Form state
  let nodeName = '';
  let modulePath = '';
  let baseClassSelection = 'cascade.Node';
  let customBaseClass = '';
  let autoModulePath = true;

  // Available base classes with their descriptions and code templates
  const baseClasses = [
    {
      id: 'cascade.Node',
      label: 'Node',
      description: 'Base class for all nodes - use for general purpose computation',
      template: 'node'
    },
    {
      id: 'cascade.lens.LensNode',
      label: 'LensNode',
      description: 'Image processing base class with canvas/image utilities',
      template: 'lens'
    },
    {
      id: 'custom',
      label: 'Other',
      description: 'Specify a custom base class path',
      template: 'node'
    }
  ];

  // Get the actual base class value
  $: baseClass = baseClassSelection === 'custom' ? customBaseClass : baseClassSelection;

  // Auto-generate module path from name
  $: if (autoModulePath && nodeName) {
    // Convert name to lowercase, replace spaces with nothing, use as module name
    const safeName = nodeName.toLowerCase().replace(/[^a-z0-9]/g, '');
    modulePath = `local.${safeName}`;
  }

  function handleModulePathInput() {
    // User manually edited, disable auto-generation
    autoModulePath = false;
  }

  function handleNameInput() {
    // Re-enable auto if module path matches expected auto value
    const safeName = nodeName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const expectedPath = `local.${safeName}`;
    if (modulePath === expectedPath || modulePath === '') {
      autoModulePath = true;
    }
  }

  function handleSubmit() {
    if (!nodeName.trim()) return;
    if (baseClassSelection === 'custom' && !customBaseClass.trim()) return;

    const selectedBase = baseClasses.find(b => b.id === baseClassSelection);

    dispatch('create', {
      name: nodeName.trim(),
      modulePath: modulePath || `local.${nodeName.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
      baseClass,
      template: selectedBase?.template || 'node'
    });

    // Reset form
    resetForm();
  }

  function handleCancel() {
    resetForm();
    dispatch('close');
  }

  function resetForm() {
    nodeName = '';
    modulePath = '';
    baseClassSelection = 'cascade.Node';
    customBaseClass = '';
    autoModulePath = true;
    open = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      handleCancel();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  // Focus name input when dialog opens
  let nameInput: HTMLInputElement;
  $: if (open && nameInput) {
    setTimeout(() => nameInput?.focus(), 50);
  }
</script>

{#if open}
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <div class="dialog-overlay" on:click={handleCancel} on:keydown={handleKeydown} role="dialog">
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="dialog" on:click|stopPropagation>
      <div class="dialog-header">
        <h2>Create Custom Node</h2>
        <button class="close-button" on:click={handleCancel}>
          <X size={18} />
        </button>
      </div>

      <form on:submit|preventDefault={handleSubmit}>
        <div class="form-group">
          <label for="node-name">Node Name</label>
          <input
            id="node-name"
            type="text"
            bind:value={nodeName}
            bind:this={nameInput}
            on:input={handleNameInput}
            placeholder="e.g., ZigZagPattern"
            autocomplete="off"
          />
          <span class="hint">The display name for your node</span>
        </div>

        <div class="form-group">
          <label for="module-path">Module Path</label>
          <input
            id="module-path"
            type="text"
            bind:value={modulePath}
            on:input={handleModulePathInput}
            placeholder="e.g., local.zigzagpattern"
            autocomplete="off"
          />
          <span class="hint">
            Unique identifier for the node module
            {#if autoModulePath}
              <span class="auto-badge">auto</span>
            {/if}
          </span>
        </div>

        <div class="form-group">
          <label>Base Class</label>
          <div class="base-class-options">
            {#each baseClasses as base}
              <label class="radio-option" class:selected={baseClassSelection === base.id}>
                <input
                  type="radio"
                  name="baseClass"
                  value={base.id}
                  bind:group={baseClassSelection}
                />
                <div class="radio-content">
                  <div class="radio-header">
                    <span class="radio-label">{base.label}</span>
                    {#if base.id !== 'custom'}
                      <span class="radio-path">{base.id}</span>
                    {/if}
                  </div>
                  {#if base.id === 'custom' && baseClassSelection === 'custom'}
                    <input
                      type="text"
                      class="custom-base-input"
                      bind:value={customBaseClass}
                      placeholder="e.g., cascade.mylib.MyBaseNode"
                      autocomplete="off"
                      on:click|stopPropagation
                    />
                  {/if}
                </div>
              </label>
            {/each}
          </div>
        </div>

        <div class="dialog-footer">
          <button type="button" class="cancel-button" on:click={handleCancel}>
            Cancel
          </button>
          <button type="submit" class="create-button" disabled={!nodeName.trim() || (baseClassSelection === 'custom' && !customBaseClass.trim())}>
            <Icon name="Zap" size={14} />
            Create Node
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  .dialog-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    animation: fadeIn 0.15s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .dialog {
    background: #252526;
    border-radius: 8px;
    border: 1px solid #404040;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
    width: 380px;
    max-width: 90vw;
    max-height: 90vh;
    overflow: hidden;
    animation: slideIn 0.2s ease;
  }

  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateY(-20px) scale(0.95);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid #404040;
  }

  .dialog-header h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: #fff;
  }

  .close-button {
    background: none;
    border: none;
    color: #888;
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: all 0.15s;
  }

  .close-button:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }

  form {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .form-group > label {
    font-size: 12px;
    font-weight: 500;
    color: #aaa;
  }

  .form-group input[type="text"] {
    padding: 8px 10px;
    background: #1e1e1e;
    border: 1px solid #404040;
    border-radius: 4px;
    color: #fff;
    font-size: 13px;
    font-family: 'SF Mono', Monaco, monospace;
    transition: border-color 0.15s;
  }

  .form-group input[type="text"]:focus {
    outline: none;
    border-color: #0078d4;
  }

  .form-group input[type="text"]::placeholder {
    color: #666;
  }

  .hint {
    font-size: 11px;
    color: #888;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .auto-badge {
    padding: 1px 6px;
    background: rgba(0, 120, 212, 0.2);
    color: #0078d4;
    border-radius: 10px;
    font-size: 10px;
    text-transform: uppercase;
    font-weight: 500;
  }

  .base-class-options {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .radio-option {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    background: #1e1e1e;
    border: 1px solid #404040;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .radio-option:hover {
    border-color: #555;
    background: #2a2a2a;
  }

  .radio-option.selected {
    border-color: #0078d4;
    background: rgba(0, 120, 212, 0.1);
  }

  .radio-option input[type="radio"] {
    margin: 0;
    accent-color: #0078d4;
    flex-shrink: 0;
  }

  .radio-content {
    display: flex;
    flex-direction: column;
    gap: 0;
    flex: 1;
    min-width: 0;
  }

  .radio-header {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .radio-label {
    font-size: 13px;
    font-weight: 500;
    color: #fff;
  }

  .radio-path {
    font-size: 10px;
    font-family: 'SF Mono', Monaco, monospace;
    color: #666;
  }

  .radio-description {
    display: none;
  }

  .custom-base-input {
    margin-top: 8px;
    padding: 8px 10px;
    background: #2a2a2a;
    border: 1px solid #555;
    border-radius: 4px;
    color: #fff;
    font-size: 13px;
    font-family: 'SF Mono', Monaco, monospace;
    width: 100%;
    box-sizing: border-box;
  }

  .custom-base-input:focus {
    outline: none;
    border-color: #0078d4;
    background: #1e1e1e;
  }

  .custom-base-input::placeholder {
    color: #666;
  }

  .dialog-footer {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    padding-top: 12px;
    border-top: 1px solid #404040;
    margin-top: 8px;
  }

  .cancel-button,
  .create-button {
    padding: 8px 16px;
    border-radius: 4px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }

  .cancel-button {
    background: transparent;
    border: 1px solid #404040;
    color: #ccc;
  }

  .cancel-button:hover {
    background: rgba(255, 255, 255, 0.05);
    border-color: #555;
    color: #fff;
  }

  .create-button {
    display: flex;
    align-items: center;
    gap: 6px;
    background: #0078d4;
    border: none;
    color: #fff;
  }

  .create-button:hover:not(:disabled) {
    background: #1084d8;
  }

  .create-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
