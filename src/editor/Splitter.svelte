<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  
  export let direction: 'horizontal' | 'vertical' = 'vertical';
  export let splitterId: string;
  
  const dispatch = createEventDispatcher();
  
  let isDragging = false;
  let startPos = 0;
  let startSize1 = 0;
  let startSize2 = 0;
  
  function handleMouseDown(e: MouseEvent) {
    isDragging = true;
    startPos = direction === 'horizontal' ? e.clientY : e.clientX;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    e.preventDefault();
  }
  
  function handleMouseMove(e: MouseEvent) {
    if (!isDragging) return;
    
    const currentPos = direction === 'horizontal' ? e.clientY : e.clientX;
    const delta = currentPos - startPos;
    
    dispatch('resize', { 
      splitterId, 
      delta,
      direction 
    });
    
    startPos = currentPos;
  }
  
  function handleMouseUp() {
    isDragging = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  }

  function handleKeyDown(e: KeyboardEvent) {
    const delta = direction === 'vertical'
      ? (e.key === 'ArrowLeft' ? -10 : e.key === 'ArrowRight' ? 10 : 0)
      : (e.key === 'ArrowUp' ? -10 : e.key === 'ArrowDown' ? 10 : 0);
    if (!delta) return;
    e.preventDefault();
    dispatch('resize', { splitterId, delta, direction });
  }
</script>

<!-- The separator implements Arrow-key resizing; Svelte does not classify
     role="separator" as interactive for these two structural checks. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="splitter" 
  class:horizontal={direction === 'horizontal'}
  class:vertical={direction === 'vertical'}
  class:dragging={isDragging}
  on:mousedown={handleMouseDown}
  on:keydown={handleKeyDown}
  role="separator"
  tabindex="0"
  aria-orientation={direction}
  aria-label="Resize"
></div>

<style>
  .splitter {
    background: var(--tint-weak);
    transition: background 0.15s ease;
    flex-shrink: 0;
    position: relative;
    z-index: 10;
  }
  
  .splitter:hover {
    background: var(--accent-tint-strong);
  }
  
  .splitter.dragging {
    background: var(--accent-tint-half);
  }
  
  .splitter.vertical {
    width: 2px;
    cursor: col-resize;
  }
  
  .splitter.horizontal {
    height: 2px;
    cursor: row-resize;
  }
</style>
