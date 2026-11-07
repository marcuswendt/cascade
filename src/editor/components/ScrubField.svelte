<script lang="ts">
  /**
   * The scrub number: a number field with its ‹ › steppers and edge lights.
   * The field itself is the slotted input, which carries `use:scrub` with
   * `field: true` — drag anywhere on it, click to type. Its tick ruler is the
   * input's own background, slid by `--scrub-x`; the look is all in
   * theme.css beside the other scrub rules, shared by every field. A
   * disabled (or read-only) field has no steppers at all.
   */
  export let atMin = false;
  export let atMax = false;
  /** Fill the row, as each vector component does. */
  export let grow = false;
  export let disabled = false;
  export let onStep: (direction: number, event: MouseEvent) => void;
</script>

<span class="scrub-field" class:scrub-min={atMin} class:scrub-max={atMax} style:flex={grow ? '1' : null}>
  {#if !disabled}<button type="button" tabindex="-1" aria-label="Decrease" on:mousedown|preventDefault|stopPropagation on:click|stopPropagation={(e) => onStep(-1, e)}>‹</button>{/if}
  <slot />
  {#if !disabled}<button type="button" tabindex="-1" aria-label="Increase" on:mousedown|preventDefault|stopPropagation on:click|stopPropagation={(e) => onStep(1, e)}>›</button>{/if}
</span>
