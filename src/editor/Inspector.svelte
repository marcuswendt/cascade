<script lang="ts">
  import type { Node } from '@/core/Node';
  import type { InputPort } from '@/types/node.types';
  
  export let node: Node | null = null;
  export let position: 'right' | 'left' = 'right';
  
  $: inputs = node?.inputs || [];
  $: paramInputs = inputs.filter(p => p.portType === 'param' && !(p.options?.hidden));
  
  function handleInputChange(port: InputPort, value: any) {
    port.value = value;
    if (port.onChange) {
      port.onChange(value);
    }
  }
  
  function handleNumberInput(port: InputPort, e: Event) {
    const value = parseFloat((e.target as HTMLInputElement).value);
    handleInputChange(port, value);
  }
  
  function handleTextInput(port: InputPort, e: Event) {
    const value = (e.target as HTMLInputElement).value;
    handleInputChange(port, value);
  }
  
  function handleTextareaInput(port: InputPort, e: Event) {
    const value = (e.target as HTMLTextAreaElement).value;
    handleInputChange(port, value);
  }
  
  function handleCheckboxChange(port: InputPort, e: Event) {
    const value = (e.target as HTMLInputElement).checked;
    handleInputChange(port, value);
  }
  
  function handleTriggerClick(port: InputPort) {
    if (port.onTrigger) {
      port.onTrigger();
    }
  }
</script>

{#if node}
  <div class="inspector" class:left={position === 'left'}>
    <div class="header">
      <h3>{node.name}</h3>
      {#if node.error}
        <span class="error-badge">Error</span>
      {/if}
    </div>
    
    <div class="content">
      {#if paramInputs.length === 0}
        <div class="empty-state">
          No parameters to edit
        </div>
      {:else}
        {#each paramInputs as port}
          <div class="param-group">
            <label class="param-label">
              {port.name}
              {#if port.options.description}
                <span class="description">{port.options.description}</span>
              {/if}
            </label>
            
            {#if port.dataType === 'number'}
              <input
                type="number"
                class="param-input"
                value={port.value}
                min={port.options?.min}
                max={port.options?.max}
                step={port.options?.step || 1}
                on:input={(e) => handleNumberInput(port, e)}
              />
            {:else if port.dataType === 'boolean'}
              <label class="checkbox-label">
                <input
                  type="checkbox"
                  checked={port.value}
                  on:change={(e) => handleCheckboxChange(port, e)}
                />
                <span>{port.value ? 'On' : 'Off'}</span>
              </label>
            {:else if port.dataType === 'string' && port.options?.multiline}
              <textarea
                class="param-textarea"
                value={port.value || ''}
                on:input={(e) => handleTextareaInput(port, e)}
              ></textarea>
            {:else}
              <input
                type="text"
                class="param-input"
                value={port.value || ''}
                on:input={(e) => handleTextInput(port, e)}
              />
            {/if}
          </div>
        {/each}
        
        <!-- Trigger inputs -->
        {#each inputs.filter(p => p.portType === 'trigger') as port}
          <div class="trigger-group">
            <button
              class="trigger-button"
              on:click={() => handleTriggerClick(port)}
            >
              {port.name}
            </button>
          </div>
        {/each}
      {/if}
      
      {#if node.comment}
        <div class="comment-section">
          <div class="comment">{node.comment}</div>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .inspector {
    position: fixed;
    top: 0;
    right: 0;
    width: 300px;
    height: 100vh;
    background: rgba(20, 20, 20, 0.95);
    backdrop-filter: blur(10px);
    border-left: 1px solid rgba(255, 255, 255, 0.1);
    display: flex;
    flex-direction: column;
    z-index: 150;
    animation: slideIn 0.2s ease;
  }
  
  .inspector.left {
    left: 0;
    right: auto;
    border-left: none;
    border-right: 1px solid rgba(255, 255, 255, 0.1);
    animation: slideInLeft 0.2s ease;
  }
  
  @keyframes slideIn {
    from {
      transform: translateX(100%);
    }
    to {
      transform: translateX(0);
    }
  }
  
  @keyframes slideInLeft {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(0);
    }
  }
  
  .header {
    padding: 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  
  .header h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: #fff;
  }
  
  .error-badge {
    padding: 4px 8px;
    background: #ff4444;
    color: white;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
  }
  
  .content {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
  }
  
  .param-group {
    margin-bottom: 16px;
  }
  
  .param-label {
    display: block;
    font-size: 12px;
    font-weight: 500;
    color: #aaa;
    margin-bottom: 6px;
  }
  
  .param-label .description {
    display: block;
    font-size: 10px;
    color: #666;
    font-weight: normal;
    margin-top: 2px;
  }
  
  .param-input,
  .param-textarea {
    width: 100%;
    padding: 8px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: #fff;
    font-size: 14px;
    font-family: inherit;
  }
  
  .param-input:focus,
  .param-textarea:focus {
    outline: none;
    border-color: #4a9eff;
  }
  
  .param-textarea {
    min-height: 60px;
    resize: vertical;
  }
  
  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    color: #fff;
    font-size: 14px;
  }
  
  .checkbox-label input[type="checkbox"] {
    width: 18px;
    height: 18px;
    cursor: pointer;
  }
  
  .trigger-group {
    margin-bottom: 12px;
  }
  
  .trigger-button {
    width: 100%;
    padding: 10px;
    background: #4a9eff;
    color: white;
    border: none;
    border-radius: 4px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }
  
  .trigger-button:hover {
    background: #357abd;
  }
  
  .comment-section {
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }
  
  .comment {
    font-size: 12px;
    color: #888;
    font-style: italic;
    line-height: 1.5;
  }
  
  .empty-state {
    padding: 32px;
    text-align: center;
    color: #666;
    font-size: 14px;
  }
</style>

