<script lang="ts">
  import type { Node } from '@/core/Node';
  import type { InputPort, Prop } from '@/types/node.types';
  import type { Graph, CanvasAnnotation } from '@/core/Graph';
  import { inferPropControlType } from '@/utils/propUtils';
  
  export let node: Node | null = null;
  export let annotation: CanvasAnnotation | null = null;
  export let graph: Graph | null = null;
  export let position: 'right' | 'left' = 'right';
  export let skipAnimation: boolean = false;
  
  $: inputs = node?.inputs || [];
  $: paramInputs = inputs.filter(p => p.portType === 'param' && !(p.options?.hidden));
  $: props = node ? Object.entries(node.props).filter(([_, prop]) => {
    if (typeof prop.hidden === 'function') {
      return !prop.hidden();
    }
    return !prop.hidden;
  }) : [];
  
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
  
  function handlePropChange([key, prop]: [string, Prop], value: any) {
    if (node) {
      node.updateProp(key, value);
    }
  }
  
  function handlePropNumberInput([key, prop]: [string, Prop], e: Event) {
    const value = parseFloat((e.target as HTMLInputElement).value);
    handlePropChange([key, prop], value);
  }
  
  function handlePropTextInput([key, prop]: [string, Prop], e: Event) {
    const value = (e.target as HTMLInputElement).value;
    handlePropChange([key, prop], value);
  }
  
  function handlePropTextareaInput([key, prop]: [string, Prop], e: Event) {
    const value = (e.target as HTMLTextAreaElement).value;
    handlePropChange([key, prop], value);
  }
  
  function handlePropCheckboxChange([key, prop]: [string, Prop], e: Event) {
    const value = (e.target as HTMLInputElement).checked;
    handlePropChange([key, prop], value);
  }
  
  function handlePropSelectChange([key, prop]: [string, Prop], e: Event) {
    const selectedValue = (e.target as HTMLSelectElement).value;
    // Find the original option value (could be object or primitive)
    const option = prop.params?.options?.find(opt => {
      const optValue = typeof opt === 'object' && 'value' in opt ? opt.value : opt;
      return String(optValue) === selectedValue;
    });
    const finalValue = option && typeof option === 'object' && 'value' in option ? option.value : selectedValue;
    handlePropChange([key, prop], finalValue);
  }
  
  function renderPropControl([key, prop]: [string, Prop]): { key: string; prop: Prop; controlType: ReturnType<typeof inferPropControlType>; displayName: string; folder: string | undefined } | null {
    const controlType = inferPropControlType(prop);
    const displayName = prop.displayName || key;
    const isDisabled = typeof prop.disabled === 'function' ? prop.disabled() : prop.disabled;
    
    if (isDisabled) {
      return null;
    }
    
    // Group by folder if specified
    const folder = prop.folder;
    
    return { key, prop, controlType, displayName, folder };
  }
  
  type PropControlItem = { key: string; prop: Prop; controlType: ReturnType<typeof inferPropControlType>; displayName: string; folder: string | undefined };
  
  $: propControls = props.map(renderPropControl).filter((item): item is PropControlItem => item !== null);
  $: groupedProps = propControls.reduce((acc, item) => {
    const folder = item.folder || 'General';
    if (!acc[folder]) {
      acc[folder] = [];
    }
    acc[folder].push(item);
    return acc;
  }, {} as Record<string, PropControlItem[]>);
  
  // Annotation styling handlers
  function handleAnnotationStyleChange(styleKey: string, value: any) {
    if (annotation && graph) {
      // Create a new style object to ensure reactivity
      annotation.style = {
        ...annotation.style,
        [styleKey]: value
      };
      // Force reactivity by creating new array and updating annotation reference
      const index = graph.annotations.findIndex(a => a.id === annotation.id);
      if (index >= 0) {
        graph.annotations = [
          ...graph.annotations.slice(0, index),
          { ...graph.annotations[index], style: annotation.style },
          ...graph.annotations.slice(index + 1)
        ];
      }
    }
  }
  
  function handleAnnotationSizeChange(sizeKey: 'width' | 'height', value: number) {
    if (annotation && graph) {
      // Create a new size object to ensure reactivity
      annotation.size = {
        ...(annotation.size || { width: 540, height: 60 }),
        [sizeKey]: value
      };
      // Force reactivity by creating new array and updating annotation reference
      const index = graph.annotations.findIndex(a => a.id === annotation.id);
      if (index >= 0) {
        graph.annotations = [
          ...graph.annotations.slice(0, index),
          { ...graph.annotations[index], size: annotation.size },
          ...graph.annotations.slice(index + 1)
        ];
      }
    }
  }
  
  function handleAnnotationContentChange(value: string) {
    if (annotation && graph) {
      // Force reactivity by creating new array and updating annotation reference
      const index = graph.annotations.findIndex(a => a.id === annotation.id);
      if (index >= 0) {
        graph.annotations = [
          ...graph.annotations.slice(0, index),
          { ...graph.annotations[index], content: value },
          ...graph.annotations.slice(index + 1)
        ];
        // Update the annotation reference
        annotation.content = value;
      }
    }
  }
  
  function handleAnnotationContentInput(e: Event) {
    const value = (e.target as HTMLTextAreaElement).value;
    handleAnnotationContentChange(value);
  }
  
  function handleAnnotationStyleNumberInput(styleKey: string, e: Event) {
    const value = parseFloat((e.target as HTMLInputElement).value);
    handleAnnotationStyleChange(styleKey, value);
  }
  
  function handleAnnotationStyleTextInput(styleKey: string, e: Event) {
    const value = (e.target as HTMLInputElement).value;
    handleAnnotationStyleChange(styleKey, value);
  }
  
  function handleAnnotationStyleColorInput(styleKey: string, e: Event) {
    const value = (e.target as HTMLInputElement).value;
    handleAnnotationStyleChange(styleKey, value);
  }
  
  function handleAnnotationStyleSelectChange(styleKey: string, e: Event) {
    const value = (e.target as HTMLSelectElement).value;
    handleAnnotationStyleChange(styleKey, value);
  }
  
  function handleAnnotationSizeInput(sizeKey: 'width' | 'height', e: Event) {
    const value = parseFloat((e.target as HTMLInputElement).value);
    handleAnnotationSizeChange(sizeKey, value);
  }
  
  function handleAnnotationPositionXInput(e: Event) {
    const value = parseFloat((e.target as HTMLInputElement).value);
    if (!isNaN(value) && annotation && graph) {
      const index = graph.annotations.findIndex(a => a.id === annotation.id);
      if (index >= 0) {
        graph.annotations = [
          ...graph.annotations.slice(0, index),
          { ...graph.annotations[index], position: { ...annotation.position, x: value } },
          ...graph.annotations.slice(index + 1)
        ];
        annotation.position.x = value;
      }
    }
  }
  
  function handleAnnotationPositionYInput(e: Event) {
    const value = parseFloat((e.target as HTMLInputElement).value);
    if (!isNaN(value) && annotation && graph) {
      const index = graph.annotations.findIndex(a => a.id === annotation.id);
      if (index >= 0) {
        graph.annotations = [
          ...graph.annotations.slice(0, index),
          { ...graph.annotations[index], position: { ...annotation.position, y: value } },
          ...graph.annotations.slice(index + 1)
        ];
        annotation.position.y = value;
      }
    }
  }
  
  function handleAnnotationColorHexInput(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    if (/^#[0-9A-Fa-f]{6}$/.test(value)) {
      handleAnnotationStyleChange('color', value);
    }
  }
</script>

{#if annotation && annotation.type === 'text'}
  <div class="inspector" class:left={position === 'left'} class:no-animation={skipAnimation}>
    <div class="content">
      <!-- Content -->
      <div class="section">
        <div class="section-header">
          <span class="section-title">Content</span>
        </div>
        <textarea
          id="annotation-content"
          class="content-textarea"
          value={annotation.content || ''}
          on:input={handleAnnotationContentInput}
          placeholder="Enter text..."
        ></textarea>
      </div>
      
      <!-- Position -->
      <div class="section">
        <div class="section-header">
          <span class="section-title">Position</span>
        </div>
        <div class="position-grid">
          <div class="position-input-group">
            <label class="position-label" for="annotation-x">X</label>
            <input
              id="annotation-x"
              type="number"
              class="position-input"
              value={Math.round(annotation.position.x)}
              on:input={handleAnnotationPositionXInput}
            />
          </div>
          <div class="position-input-group">
            <label class="position-label" for="annotation-y">Y</label>
            <input
              id="annotation-y"
              type="number"
              class="position-input"
              value={Math.round(annotation.position.y)}
              on:input={handleAnnotationPositionYInput}
            />
          </div>
        </div>
      </div>
      
      <!-- Layout -->
      <div class="section">
        <div class="section-header">
          <span class="section-title">Layout</span>
        </div>
        <div class="layout-grid">
          <div class="layout-input-group">
            <label class="layout-label" for="annotation-width">W</label>
            <input
              id="annotation-width"
              type="number"
              class="layout-input"
              min="100"
              value={annotation.size?.width || 540}
              on:input={(e) => handleAnnotationSizeInput('width', e)}
            />
          </div>
          <div class="layout-input-group">
            <label class="layout-label" for="annotation-height">H</label>
            <input
              id="annotation-height"
              type="number"
              class="layout-input"
              min="20"
              value={annotation.size?.height || 60}
              on:input={(e) => handleAnnotationSizeInput('height', e)}
            />
          </div>
        </div>
      </div>
      
      <!-- Typography -->
      <div class="section">
        <div class="section-header">
          <span class="section-title">Typography</span>
        </div>
        
        <div class="typography-row">
          <div class="typography-input-group">
            <label class="typography-label" for="annotation-font-weight">Weight</label>
            <select
              id="annotation-font-weight"
              class="typography-select"
              value={annotation.style?.fontWeight || 'normal'}
              on:change={(e) => handleAnnotationStyleSelectChange('fontWeight', e)}
            >
              <option value="normal">Regular</option>
              <option value="600">Semi-bold</option>
              <option value="bold">Bold</option>
              <option value="700">Extra Bold</option>
            </select>
          </div>
          
          <div class="typography-input-group">
            <label class="typography-label" for="annotation-font-size">Size</label>
            <input
              id="annotation-font-size"
              type="number"
              class="typography-number-input"
              min="8"
              max="72"
              step="1"
              value={annotation.style?.fontSize || 14}
              on:input={(e) => handleAnnotationStyleNumberInput('fontSize', e)}
            />
          </div>
        </div>
        
        <div class="typography-row">
          <div class="typography-input-group">
            <label class="typography-label" for="annotation-font-style">Style</label>
            <select
              id="annotation-font-style"
              class="typography-select"
              value={annotation.style?.fontStyle || 'normal'}
              on:change={(e) => handleAnnotationStyleSelectChange('fontStyle', e)}
            >
              <option value="normal">Normal</option>
              <option value="italic">Italic</option>
            </select>
          </div>
          
          <div class="typography-input-group">
            <label class="typography-label" for="annotation-text-align">Align</label>
            <div class="align-buttons">
              <button
                class="align-button"
                class:active={annotation.style?.textAlign === 'left' || !annotation.style?.textAlign}
                on:click={() => handleAnnotationStyleChange('textAlign', 'left')}
                title="Align left"
                aria-label="Align left"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M2 3H12M2 7H10M2 11H12" stroke-linecap="round"/>
                </svg>
              </button>
              <button
                class="align-button"
                class:active={annotation.style?.textAlign === 'center'}
                on:click={() => handleAnnotationStyleChange('textAlign', 'center')}
                title="Align center"
                aria-label="Align center"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M2 3H12M4 7H10M2 11H12" stroke-linecap="round"/>
                </svg>
              </button>
              <button
                class="align-button"
                class:active={annotation.style?.textAlign === 'right'}
                on:click={() => handleAnnotationStyleChange('textAlign', 'right')}
                title="Align right"
                aria-label="Align right"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M2 3H12M4 7H12M2 11H12" stroke-linecap="round"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Fill -->
      <div class="section">
        <div class="section-header">
          <span class="section-title">Fill</span>
        </div>
        <div class="fill-controls">
          <input
            id="annotation-text-color"
            type="color"
            class="color-picker"
            value={annotation.style?.color || '#ffffff'}
            on:input={(e) => handleAnnotationStyleColorInput('color', e)}
          />
          <input
            id="annotation-color-hex"
            type="text"
            class="color-hex-input"
            value={(annotation.style?.color || '#ffffff').toUpperCase()}
            on:input={handleAnnotationColorHexInput}
            placeholder="#FFFFFF"
          />
        </div>
      </div>
      
      <!-- Appearance -->
      <div class="section">
        <div class="section-header">
          <span class="section-title">Appearance</span>
        </div>
        
        <div class="appearance-row">
          <div class="appearance-input-group">
            <label class="appearance-label" for="annotation-padding">Padding</label>
            <input
              id="annotation-padding"
              type="number"
              class="appearance-number-input"
              min="0"
              max="32"
              step="1"
              value={annotation.style?.padding || 8}
              on:input={(e) => handleAnnotationStyleNumberInput('padding', e)}
            />
          </div>
          
          <div class="appearance-input-group">
            <label class="appearance-label" for="annotation-border-radius">Radius</label>
            <input
              id="annotation-border-radius"
              type="number"
              class="appearance-number-input"
              min="0"
              max="16"
              step="1"
              value={annotation.style?.borderRadius || 4}
              on:input={(e) => handleAnnotationStyleNumberInput('borderRadius', e)}
            />
          </div>
        </div>
        
        {#if annotation.style?.backgroundColor}
          <div class="appearance-row">
            <div class="appearance-input-group">
              <label class="appearance-label" for="annotation-bg-color">Background</label>
              <input
                id="annotation-bg-color"
                type="color"
                class="color-picker-small"
                value={annotation.style.backgroundColor}
                on:input={(e) => handleAnnotationStyleColorInput('backgroundColor', e)}
              />
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
{:else if node}
  <div class="inspector" class:left={position === 'left'} class:no-animation={skipAnimation}>
    <div class="content">
      {#if node.error}
        <div class="error-badge-container">
          <span class="error-badge">Error</span>
        </div>
      {/if}
      <!-- Props -->
      {#if propControls.length > 0}
        {#each Object.entries(groupedProps) as entry}
          {@const [folder, folderProps] = entry}
          <div class="folder-group">
            {#if folder !== 'General'}
              <div class="folder-header">{folder}</div>
            {/if}
            {#each folderProps as item}
              {@const { key, prop, controlType, displayName } = item}
              {@const inputId = `prop-${key}-${folder}`}
              <div class="prop-group">
                <label class="prop-label" for={inputId}>
                  {displayName}
                </label>
                
                {#if controlType === 'number' || controlType === 'slider'}
                  {#if controlType === 'slider' && prop.params?.min !== undefined && prop.params?.max !== undefined}
                    {@const minValue = typeof prop.params.min === 'number' ? prop.params.min : Array.isArray(prop.params.min) ? prop.params.min[0] : 0}
                    {@const maxValue = typeof prop.params.max === 'number' ? prop.params.max : Array.isArray(prop.params.max) ? prop.params.max[0] : 100}
                    <div class="slider-container">
                      <input
                        id={inputId}
                        type="range"
                        class="slider"
                        min={minValue}
                        max={maxValue}
                        step={prop.params.step || 1}
                        value={typeof prop.value === 'number' ? prop.value : Array.isArray(prop.value) ? prop.value[0] : 0}
                        on:input={(e) => handlePropNumberInput([key, prop], e)}
                      />
                      <input
                        type="number"
                        class="number-input"
                        min={minValue}
                        max={maxValue}
                        step={prop.params.step || 1}
                        value={typeof prop.value === 'number' ? prop.value : Array.isArray(prop.value) ? prop.value[0] : 0}
                        on:input={(e) => handlePropNumberInput([key, prop], e)}
                        aria-label={displayName}
                      />
                    </div>
                  {:else}
                    <input
                      id={inputId}
                      type="number"
                      class="param-input"
                      value={typeof prop.value === 'number' ? prop.value : Array.isArray(prop.value) ? prop.value[0] : undefined}
                      min={typeof prop.params?.min === 'number' ? prop.params.min : undefined}
                      max={typeof prop.params?.max === 'number' ? prop.params.max : undefined}
                      step={prop.params?.step || 1}
                      on:input={(e) => handlePropNumberInput([key, prop], e)}
                    />
                  {/if}
                {:else if controlType === 'text' || controlType === 'textarea'}
                  {#if controlType === 'textarea'}
                    <textarea
                      id={inputId}
                      class="param-textarea"
                      value={prop.value || ''}
                      on:input={(e) => handlePropTextareaInput([key, prop], e)}
                    ></textarea>
                  {:else}
                    <input
                      id={inputId}
                      type="text"
                      class="param-input"
                      value={prop.value || ''}
                      on:input={(e) => handlePropTextInput([key, prop], e)}
                    />
                  {/if}
                {:else if controlType === 'color'}
                  <input
                    id={inputId}
                    type="color"
                    class="color-input"
                    value={prop.value || '#ffffff'}
                    on:input={(e) => handlePropTextInput([key, prop], e)}
                  />
                {:else if controlType === 'boolean'}
                  <label class="checkbox-label">
                    <input
                      id={inputId}
                      type="checkbox"
                      checked={prop.value}
                      on:change={(e) => handlePropCheckboxChange([key, prop], e)}
                    />
                    <span>{prop.value ? 'On' : 'Off'}</span>
                  </label>
                {:else if controlType === 'select' && prop.params?.options}
                  <select
                    id={inputId}
                    class="select-input"
                    value={String(prop.value)}
                    on:change={(e) => handlePropSelectChange([key, prop], e)}
                  >
                    {#each prop.params.options as option}
                      {@const optValue = typeof option === 'object' && 'value' in option ? option.value : option}
                      {@const optLabel = typeof option === 'object' && 'label' in option ? option.label : String(option)}
                      <option value={String(optValue)}>{optLabel}</option>
                    {/each}
                  </select>
                {:else if controlType === 'button'}
                  <button
                    id={inputId}
                    class="prop-button"
                    on:click={() => {
                      if (typeof prop.value === 'function') {
                        prop.value();
                      }
                    }}
                  >
                    Execute
                  </button>
                {:else}
                  <input
                    id={inputId}
                    type="text"
                    class="param-input"
                    value={String(prop.value || '')}
                    on:input={(e) => handlePropTextInput([key, prop], e)}
                  />
                {/if}
              </div>
            {/each}
          </div>
        {/each}
      {/if}
      
      <!-- Port Parameters -->
      {#if paramInputs.length === 0 && propControls.length === 0}
        <div class="empty-state">
          No parameters to edit
        </div>
      {:else if paramInputs.length > 0}
        {#each paramInputs as port}
          {@const portId = `port-${port.id}`}
          <div class="param-group">
            <label class="param-label" for={portId}>
              {port.name}
              {#if port.options.description}
                <span class="description">{port.options.description}</span>
              {/if}
            </label>
            
            {#if port.dataType === 'number'}
              <input
                id={portId}
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
                  id={portId}
                  type="checkbox"
                  checked={port.value}
                  on:change={(e) => handleCheckboxChange(port, e)}
                />
                <span>{port.value ? 'On' : 'Off'}</span>
              </label>
            {:else if port.dataType === 'string' && port.options?.multiline}
              <textarea
                id={portId}
                class="param-textarea"
                value={port.value || ''}
                on:input={(e) => handleTextareaInput(port, e)}
              ></textarea>
            {:else}
              <input
                id={portId}
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
    position: relative;
    width: 100%;
    height: 100%;
    background: rgba(20, 20, 20, 0.95);
    backdrop-filter: blur(10px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  
  .error-badge-container {
    padding: 12px 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
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
    padding: 12px;
  }
  
  .section {
    margin-bottom: 20px;
  }
  
  .section-header {
    margin-bottom: 8px;
  }
  
  .section-title {
    font-size: 11px;
    font-weight: 600;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  
  .content-textarea {
    width: 100%;
    padding: 8px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: #fff;
    font-size: 13px;
    font-family: inherit;
    min-height: 60px;
    resize: vertical;
  }
  
  .content-textarea:focus {
    outline: none;
    border-color: #4a9eff;
  }
  
  .position-grid,
  .layout-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  
  .position-input-group,
  .layout-input-group {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  
  .position-label,
  .layout-label {
    font-size: 11px;
    font-weight: 500;
    color: #aaa;
    min-width: 16px;
  }
  
  .position-input,
  .layout-input {
    flex: 1;
    padding: 6px 8px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: #fff;
    font-size: 12px;
    font-family: inherit;
  }
  
  .position-input:focus,
  .layout-input:focus {
    outline: none;
    border-color: #4a9eff;
  }
  
  .typography-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-bottom: 8px;
  }
  
  .typography-input-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  
  .typography-label {
    font-size: 11px;
    font-weight: 500;
    color: #aaa;
  }
  
  .typography-select {
    padding: 6px 8px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: #fff;
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
  }
  
  .typography-select:focus {
    outline: none;
    border-color: #4a9eff;
  }
  
  .typography-number-input {
    padding: 6px 8px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: #fff;
    font-size: 12px;
    font-family: inherit;
    width: 100%;
  }
  
  .typography-number-input:focus {
    outline: none;
    border-color: #4a9eff;
  }
  
  .align-buttons {
    display: flex;
    gap: 2px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    padding: 2px;
  }
  
  .align-button {
    flex: 1;
    padding: 4px;
    background: transparent;
    border: none;
    border-radius: 2px;
    color: #aaa;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
  }
  
  .align-button:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }
  
  .align-button.active {
    background: rgba(74, 158, 255, 0.2);
    color: #4a9eff;
  }
  
  .fill-controls {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  
  .color-picker {
    width: 40px;
    height: 32px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    cursor: pointer;
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
    background: none;
    padding: 0;
  }
  
  .color-picker::-webkit-color-swatch-wrapper {
    padding: 0;
  }
  
  .color-picker::-webkit-color-swatch {
    border: none;
    border-radius: 3px;
  }
  
  .color-hex-input {
    flex: 1;
    padding: 6px 8px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: #fff;
    font-size: 11px;
    font-family: 'Monaco', 'Menlo', monospace;
    text-transform: uppercase;
  }
  
  .color-hex-input:focus {
    outline: none;
    border-color: #4a9eff;
  }
  
  .appearance-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-bottom: 8px;
  }
  
  .appearance-input-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  
  .appearance-label {
    font-size: 11px;
    font-weight: 500;
    color: #aaa;
  }
  
  .appearance-number-input {
    padding: 6px 8px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: #fff;
    font-size: 12px;
    font-family: inherit;
    width: 100%;
  }
  
  .appearance-number-input:focus {
    outline: none;
    border-color: #4a9eff;
  }
  
  .color-picker-small {
    width: 32px;
    height: 24px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    cursor: pointer;
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
    background: none;
    padding: 0;
  }
  
  .color-picker-small::-webkit-color-swatch-wrapper {
    padding: 0;
  }
  
  .color-picker-small::-webkit-color-swatch {
    border: none;
    border-radius: 3px;
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
  
  .behavior-toggles {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
    padding-bottom: 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }
  
  .toggle-button {
    flex: 1;
    padding: 8px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: #aaa;
    font-size: 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    transition: all 0.15s ease;
  }
  
  .toggle-button:hover {
    background: rgba(255, 255, 255, 0.05);
    color: #fff;
  }
  
  .toggle-button.active {
    border-color: #4a9eff;
    color: #4a9eff;
  }
  
  .toggle-indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  
  .toggle-indicator.bypass {
    background: #ffd700;
  }
  
  .toggle-indicator.cook {
    background: #4a9eff;
  }
  
  .folder-group {
    margin-bottom: 24px;
  }
  
  .folder-header {
    font-size: 11px;
    font-weight: 600;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }
  
  .prop-group {
    margin-bottom: 16px;
  }
  
  .prop-label {
    display: block;
    font-size: 12px;
    font-weight: 500;
    color: #aaa;
    margin-bottom: 6px;
  }
  
  .slider-container {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  
  .slider {
    flex: 1;
    height: 4px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 2px;
    outline: none;
    -webkit-appearance: none;
    appearance: none;
  }
  
  .slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    background: #4a9eff;
    border-radius: 50%;
    cursor: pointer;
  }
  
  .slider::-moz-range-thumb {
    width: 14px;
    height: 14px;
    background: #4a9eff;
    border-radius: 50%;
    cursor: pointer;
    border: none;
  }
  
  .number-input {
    width: 80px;
    padding: 6px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: #fff;
    font-size: 12px;
  }
  
  .color-input {
    width: 100%;
    height: 40px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    cursor: pointer;
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
  }
  
  .select-input {
    width: 100%;
    padding: 8px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: #fff;
    font-size: 14px;
    font-family: inherit;
    cursor: pointer;
  }
  
  .select-input:focus {
    outline: none;
    border-color: #4a9eff;
  }
  
  .prop-button {
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
  
  .prop-button:hover {
    background: #357abd;
  }
</style>

