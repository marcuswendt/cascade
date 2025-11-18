<script lang="ts">
  import type { Prop } from '@/types/node.types';
  
  export let prop: Prop;
  export let id: string;
  export let onValueChange: (value: boolean) => void;
  
  $: checked = prop.value === true;
  $: disabled = typeof prop.disabled === 'function' ? prop.disabled() : prop.disabled;
  
  function handleChange(e: Event) {
    const newValue = (e.target as HTMLInputElement).checked;
    onValueChange(newValue);
  }
</script>

<label class="checkbox-label">
  <input
    type="checkbox"
    id={id}
    class="checkbox-input"
    checked={checked}
    disabled={disabled}
    on:change={handleChange}
  />
  <span class="checkbox-slider"></span>
  <span class="checkbox-text">{checked ? 'On' : 'Off'}</span>
</label>

<style>
  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    user-select: none;
  }
  
  .checkbox-input {
    display: none;
  }
  
  .checkbox-slider {
    position: relative;
    width: 36px;
    height: 20px;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 10px;
    transition: all 0.2s ease;
    flex-shrink: 0;
  }
  
  .checkbox-slider::before {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    background: #fff;
    border-radius: 50%;
    transition: all 0.2s ease;
  }
  
  .checkbox-input:checked + .checkbox-slider {
    background: rgba(74, 158, 255, 0.3);
    border-color: #4a9eff;
  }
  
  .checkbox-input:checked + .checkbox-slider::before {
    transform: translateX(16px);
    background: #4a9eff;
  }
  
  .checkbox-input:disabled + .checkbox-slider {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .checkbox-text {
    font-size: 12px;
    color: #aaa;
    min-width: 24px;
  }
  
  .checkbox-input:checked ~ .checkbox-text {
    color: #4a9eff;
  }
  
  .checkbox-label:has(.checkbox-input:disabled) {
    cursor: not-allowed;
    opacity: 0.5;
  }
</style>

