<script lang="ts">
  /**
   * The scrub number: a number field with its ‹ › steppers and edge lights.
   * The field itself is the slotted input, which carries `use:scrub` with
   * `field: true` — drag anywhere on it, click to type. Its tick ruler is the
   * input's own background, slid by `--scrub-x`; the look is all in
   * theme.css beside the other scrub rules, shared by every field.
   */
  export let atMin = false;
  export let atMax = false;
  /** Fill the row, as each vector component does. */
  export let grow = false;
  export let disabled = false;
  export let onStep: (direction: number, event: MouseEvent) => void;
</script>

<span class="scrub-field" class:at-min={atMin} class:at-max={atMax} style:flex={grow ? '1' : null}>
  <button type="button" tabindex="-1" aria-label="Decrease" {disabled} on:mousedown|preventDefault|stopPropagation on:click|stopPropagation={(e) => onStep(-1, e)}>‹</button>
  <slot />
  <button type="button" tabindex="-1" aria-label="Increase" {disabled} on:mousedown|preventDefault|stopPropagation on:click|stopPropagation={(e) => onStep(1, e)}>›</button>
</span>
