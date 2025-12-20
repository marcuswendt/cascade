<script lang="ts">
	/**
	 * ErrorDisplay - Shows AI generation errors with helpful actions
	 *
	 * Features:
	 * - Error message display
	 * - Retry button
	 * - Error type-specific help
	 */
	import { createEventDispatcher } from 'svelte';
	import Icon from '../../Icon.svelte';
	import type { AIError } from '@/services/genai/errors';
	import { AIErrorType } from '@/services/genai/errors';

	export let error: AIError | string | null = null;
	export let showRetry: boolean = true;
	export let compact: boolean = false;

	const dispatch = createEventDispatcher();

	function handleRetry() {
		dispatch('retry');
	}

	function handleDismiss() {
		dispatch('dismiss');
	}

	function handleSettings() {
		dispatch('openSettings');
	}

	// Get error details
	$: errorMessage = typeof error === 'string' ? error : (error as AIError)?.getUserMessage?.() ?? (error as Error)?.message ?? 'Unknown error';
	$: errorType = typeof error === 'object' && error !== null && 'type' in error ? (error as AIError).type : null;
	$: isRetryable = typeof error === 'object' && error !== null && 'retryable' in error ? (error as AIError).retryable : true;

	// Get icon and color based on error type
	$: errorIcon = getErrorIcon(errorType);
	$: showSettingsButton = errorType === AIErrorType.NO_API_KEY || errorType === AIErrorType.INVALID_API_KEY;

	function getErrorIcon(type: AIErrorType | null): string {
		switch (type) {
			case AIErrorType.NO_API_KEY:
			case AIErrorType.INVALID_API_KEY:
				return 'Key';
			case AIErrorType.RATE_LIMITED:
				return 'Clock';
			case AIErrorType.NETWORK_ERROR:
				return 'WifiOff';
			case AIErrorType.CONTENT_POLICY:
				return 'ShieldOff';
			case AIErrorType.INVALID_INPUT:
				return 'AlertTriangle';
			case AIErrorType.MODEL_UNAVAILABLE:
				return 'ServerOff';
			case AIErrorType.TIMEOUT:
				return 'Timer';
			case AIErrorType.INSUFFICIENT_CREDITS:
				return 'CreditCard';
			default:
				return 'AlertCircle';
		}
	}
</script>

{#if error}
	<div class="error-display" class:compact>
		<div class="error-content">
			<div class="error-icon">
				<Icon name={errorIcon} size={compact ? 14 : 18} />
			</div>

			<div class="error-text">
				<span class="error-message">{errorMessage}</span>
			</div>
		</div>

		<div class="error-actions">
			{#if showSettingsButton}
				<button class="action-button settings" on:click={handleSettings} title="Open Settings">
					<Icon name="Settings" size={14} />
					{#if !compact}
						<span>Settings</span>
					{/if}
				</button>
			{/if}

			{#if showRetry && isRetryable}
				<button class="action-button retry" on:click={handleRetry} title="Retry">
					<Icon name="RefreshCw" size={14} />
					{#if !compact}
						<span>Retry</span>
					{/if}
				</button>
			{/if}

			<button class="action-button dismiss" on:click={handleDismiss} title="Dismiss">
				<Icon name="X" size={14} />
			</button>
		</div>
	</div>
{/if}

<style>
	.error-display {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px;
		background: color-mix(in srgb, var(--color-error) 15%, var(--color-surface-0));
		border: 1px solid color-mix(in srgb, var(--color-error) 30%, transparent);
		border-radius: 6px;
	}

	.error-display.compact {
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
		padding: 8px;
		gap: 12px;
	}

	.error-content {
		display: flex;
		align-items: flex-start;
		gap: 8px;
	}

	.compact .error-content {
		align-items: center;
		flex: 1;
		min-width: 0;
	}

	.error-icon {
		flex-shrink: 0;
		color: var(--color-error);
	}

	.error-text {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}

	.error-message {
		font-size: 12px;
		color: var(--color-text-1);
		line-height: 1.4;
	}

	.compact .error-message {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.error-actions {
		display: flex;
		gap: 6px;
		flex-shrink: 0;
	}

	.action-button {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px 8px;
		border: none;
		border-radius: 4px;
		font-size: 11px;
		cursor: pointer;
		transition: background 0.15s, color 0.15s;
	}

	.action-button.retry {
		background: var(--color-accent);
		color: white;
	}

	.action-button.retry:hover {
		background: var(--color-accent-hover);
	}

	.action-button.settings {
		background: var(--color-surface-2);
		color: var(--color-text-1);
	}

	.action-button.settings:hover {
		background: var(--color-surface-3);
	}

	.action-button.dismiss {
		background: transparent;
		color: var(--color-text-2);
		padding: 4px;
	}

	.action-button.dismiss:hover {
		background: var(--color-surface-2);
		color: var(--color-text-1);
	}

	.compact .action-button {
		padding: 4px;
	}

	.compact .action-button span {
		display: none;
	}
</style>
