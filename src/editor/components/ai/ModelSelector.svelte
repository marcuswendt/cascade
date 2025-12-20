<script lang="ts">
	/**
	 * ModelSelector - Dropdown for selecting LLM models
	 *
	 * Groups models by provider and shows configuration status.
	 */
	import { createEventDispatcher } from 'svelte';
	import { getChatModelOptions, getDefaultChatModel } from '@/services/genai';
	import Icon from '../../Icon.svelte';

	export let value: string = getDefaultChatModel() || '';
	export let disabled: boolean = false;
	export let compact: boolean = false;

	const dispatch = createEventDispatcher();

	// Get model options grouped by provider
	$: modelOptions = getChatModelOptions();

	// Group options by provider
	$: groupedOptions = groupByProvider(modelOptions);

	function groupByProvider(
		options: { value: string; label: string; group?: string; disabled?: boolean }[]
	): Map<string, typeof options> {
		const groups = new Map<string, typeof options>();
		for (const opt of options) {
			const group = opt.group || 'Other';
			if (!groups.has(group)) {
				groups.set(group, []);
			}
			groups.get(group)!.push(opt);
		}
		return groups;
	}

	function handleChange(e: Event) {
		const select = e.target as HTMLSelectElement;
		value = select.value;
		dispatch('change', value);
	}

	// Get display name for current selection
	$: currentLabel = modelOptions.find((m) => m.value === value)?.label || 'Select model';
</script>

<div class="model-selector" class:compact>
	<select {value} on:change={handleChange} {disabled}>
		{#each [...groupedOptions] as [group, options]}
			<optgroup label={group}>
				{#each options as option}
					<option value={option.value} disabled={option.disabled}>
						{option.label}
					</option>
				{/each}
			</optgroup>
		{/each}
	</select>
	{#if !compact}
		<Icon name="ChevronDown" size={14} class="chevron" />
	{/if}
</div>

<style>
	.model-selector {
		position: relative;
		display: inline-flex;
		align-items: center;
	}

	select {
		appearance: none;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 6px 28px 6px 10px;
		font-size: 12px;
		color: var(--color-text-1);
		cursor: pointer;
		min-width: 140px;
	}

	select:hover:not(:disabled) {
		border-color: var(--color-text-3);
	}

	select:focus {
		outline: none;
		border-color: var(--color-accent);
	}

	select:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.compact select {
		padding: 4px 20px 4px 8px;
		font-size: 11px;
		min-width: 100px;
	}

	:global(.chevron) {
		position: absolute;
		right: 8px;
		pointer-events: none;
		color: var(--color-text-3);
	}

	optgroup {
		font-weight: 600;
		color: var(--color-text-2);
	}

	option {
		font-weight: normal;
		color: var(--color-text-1);
	}

	option:disabled {
		color: var(--color-text-3);
	}
</style>
