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
</script>

<div 
  class="splitter" 
  class:horizontal={direction === 'horizontal'}
  class:vertical={direction === 'vertical'}
  class:dragging={isDragging}
  on:mousedown={handleMouseDown}
  role="separator"
  aria-orientation={direction}
  aria-label="Resize"
></div>

<style>
  .splitter {
    background: rgba(255, 255, 255, 0.05);
    transition: background 0.15s ease;
    flex-shrink: 0;
    position: relative;
    z-index: 10;
  }
  
  .splitter:hover {
    background: rgba(74, 158, 255, 0.3);
  }
  
  .splitter.dragging {
    background: rgba(74, 158, 255, 0.5);
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

