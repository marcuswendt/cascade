<script lang="ts">
  import Icon from '../Icon.svelte';

  export let icon: string;
  export let size = 14;
  let className = '';
  export { className as class };

  $: isNamedIcon = /^[A-Z][A-Za-z0-9]+$/.test(icon);
</script>

<span class={className} aria-hidden="true">
  {#if isNamedIcon}
    <Icon name={icon} {size} />
  {:else}
    {icon}
  {/if}
</span>

<style>
  span {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
  }
</style>
