<script lang="ts">
	/**
	 * ChatNodeContent - Renders Chat node with prompt/response display
	 *
	 * Supports multiple display modes:
	 * - standard: Shows both prompt and response
	 * - compact: Minimal view with status only
	 * - expanded: Full conversation view
	 */
	import type { ChatNodeState, ChatStatus, Message } from '@/types/chat.types';
	import { createEventDispatcher } from 'svelte';
	import Icon from '../../Icon.svelte';

	export let state: ChatNodeState;
	export let displayMode: 'standard' | 'compact' | 'expanded' = 'standard';
	export let conversations: Message[] = [];

	const dispatch = createEventDispatcher();

	// Status display info
	$: statusInfo = getStatusInfo(state.status);

	function getStatusInfo(status: ChatStatus): { icon: string; label: string; class: string } {
		switch (status) {
			case 'idle':
				return { icon: 'MessageSquare', label: 'Waiting', class: 'idle' };
			case 'ready':
				return { icon: 'Send', label: 'Ready', class: 'ready' };
			case 'streaming':
				return { icon: 'Loader', label: 'Generating...', class: 'streaming' };
			case 'complete':
				return { icon: 'Check', label: 'Complete', class: 'complete' };
			case 'error':
				return { icon: 'AlertCircle', label: 'Error', class: 'error' };
			case 'cancelled':
				return { icon: 'XCircle', label: 'Cancelled', class: 'cancelled' };
			default:
				return { icon: 'MessageSquare', label: '', class: '' };
		}
	}

	function handleSend() {
		dispatch('send');
	}

	function handleCancel() {
		dispatch('cancel');
	}

	function handlePromptChange(e: Event) {
		const value = (e.target as HTMLTextAreaElement).value;
		dispatch('promptChange', value);
	}

	function handleKeyDown(e: KeyboardEvent) {
		// Cmd/Ctrl+Enter to send
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			handleSend();
		}
		// Escape to cancel
		if (e.key === 'Escape' && state.status === 'streaming') {
			e.preventDefault();
			handleCancel();
		}
	}

	// Get display text for response (handles streaming)
	$: displayResponse = state.status === 'streaming' ? state.streamBuffer : state.response;

	// Simple markdown-like formatting for response
	function formatResponse(text: string | null): string {
		if (!text) return '';
		// Escape HTML but preserve line breaks
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/\n/g, '<br>');
	}
</script>

{#if displayMode === 'compact'}
	<!-- Compact mode - status only -->
	<div class="compact-content">
		<div class="status-badge {statusInfo.class}">
			<Icon name={statusInfo.icon} size={12} />
			{#if state.status === 'streaming'}
				<span class="typing-indicator">
					<span class="dot"></span>
					<span class="dot"></span>
					<span class="dot"></span>
				</span>
			{/if}
		</div>
		{#if state.prompt}
			<span class="compact-prompt">{state.prompt.slice(0, 30)}{state.prompt.length > 30 ? '...' : ''}</span>
		{/if}
	</div>

{:else if displayMode === 'expanded'}
	<!-- Expanded mode - full conversation view -->
	<div class="expanded-content">
		<!-- Conversation messages -->
		{#if conversations.length > 0}
			<div class="conversation-history">
				{#each conversations as message}
					<div class="message {message.role}">
						<div class="message-header">
							<Icon name={message.role === 'user' ? 'User' : 'Cloud'} size={12} />
							<span class="message-role">{message.role === 'user' ? 'You' : (message.meta?.model || 'AI')}</span>
						</div>
						<div class="message-content">
							{@html formatResponse(typeof message.content === 'string' ? message.content : '[Multimodal content]')}
						</div>
					</div>
				{/each}
			</div>
		{:else if state.prompt || displayResponse}
			<!-- Fallback: show current state if no conversation messages -->
			<div class="conversation-history">
				{#if state.prompt}
					<div class="message user">
						<div class="message-header">
							<Icon name="User" size={12} />
							<span class="message-role">You</span>
						</div>
						<div class="message-content">
							{@html formatResponse(state.prompt)}
						</div>
					</div>
				{/if}
				{#if displayResponse}
					<div class="message assistant">
						<div class="message-header">
							<Icon name="Cloud" size={12} />
							<span class="message-role">{state.modelId || 'AI'}</span>
							{#if state.status === 'streaming'}
								<span class="streaming-indicator">
									<span class="dot"></span>
									<span class="dot"></span>
									<span class="dot"></span>
								</span>
							{/if}
						</div>
						<div class="message-content">
							{@html formatResponse(displayResponse)}
							{#if state.status === 'streaming'}
								<span class="cursor">|</span>
							{/if}
						</div>
					</div>
				{/if}
			</div>
		{:else}
			<!-- Empty state -->
			<div class="empty-state">
				<Icon name="MessageSquare" size={24} />
				<span>No conversation yet</span>
			</div>
		{/if}

		<!-- Streaming indicator at bottom -->
		{#if state.status === 'streaming' && !displayResponse}
			<div class="streaming-status">
				<span class="streaming-indicator">
					<span class="dot"></span>
					<span class="dot"></span>
					<span class="dot"></span>
				</span>
				<span>Generating response...</span>
			</div>
		{/if}

		<!-- Usage info -->
		{#if state.usage && state.status === 'complete'}
			<div class="usage-info">
				<span>{state.usage.total} tokens</span>
				{#if state.usage.cost}
					<span>${state.usage.cost.toFixed(4)}</span>
				{/if}
			</div>
		{/if}

		<!-- Error display -->
		{#if state.chatError}
			<div class="error-display">
				<Icon name="AlertCircle" size={14} />
				<span>{state.chatError}</span>
			</div>
		{/if}
	</div>

{:else}
	<!-- Standard mode -->
	<div class="standard-content">
		<!-- Status bar -->
		<div class="status-bar">
			<div class="status-badge {statusInfo.class}">
				<Icon name={statusInfo.icon} size={12} />
				<span>{statusInfo.label}</span>
			</div>
			{#if state.frozen}
				<span class="frozen-icon"><Icon name="Lock" size={12} /></span>
			{/if}
		</div>

		<!-- Prompt preview -->
		{#if state.prompt}
			<div class="prompt-preview">
				<span class="label">Prompt:</span>
				<span class="text">{state.prompt.slice(0, 100)}{state.prompt.length > 100 ? '...' : ''}</span>
			</div>
		{/if}

		<!-- Response preview -->
		{#if displayResponse}
			<div class="response-preview">
				<span class="label">Response:</span>
				<span class="text">{displayResponse.slice(0, 150)}{displayResponse.length > 150 ? '...' : ''}</span>
			</div>
		{:else if state.status === 'streaming'}
			<div class="response-preview streaming">
				<span class="typing-indicator">
					<span class="dot"></span>
					<span class="dot"></span>
					<span class="dot"></span>
				</span>
			</div>
		{/if}

		<!-- Quick actions -->
		<div class="quick-actions">
			{#if state.status === 'streaming'}
				<button class="quick-btn" on:click={handleCancel} title="Cancel">
					<Icon name="Square" size={12} />
				</button>
			{:else if state.status === 'complete'}
				<button class="quick-btn" on:click={handleSend} title="Regenerate">
					<Icon name="RefreshCw" size={12} />
				</button>
			{/if}
		</div>
	</div>
{/if}

<style>
	/* Compact mode */
	.compact-content {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 8px;
		min-width: 100px;
	}

	.compact-prompt {
		font-size: 10px;
		color: var(--color-text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		flex: 1;
	}

	/* Status badge */
	.status-badge {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 10px;
		padding: 2px 6px;
		border-radius: 4px;
		background: var(--color-surface-2);
	}

	.status-badge.idle {
		color: var(--color-text-3);
	}

	.status-badge.ready {
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 15%, transparent);
	}

	.status-badge.streaming {
		color: var(--color-warning);
		background: color-mix(in srgb, var(--color-warning) 15%, transparent);
	}

	.status-badge.complete {
		color: var(--color-success);
		background: color-mix(in srgb, var(--color-success) 15%, transparent);
	}

	.status-badge.error, .status-badge.cancelled {
		color: var(--color-error);
		background: color-mix(in srgb, var(--color-error) 15%, transparent);
	}

	/* Typing indicator */
	.typing-indicator, .streaming-indicator {
		display: inline-flex;
		gap: 2px;
		margin-left: 4px;
	}

	.dot {
		width: 4px;
		height: 4px;
		background: currentColor;
		border-radius: 50%;
		animation: pulse 1.4s infinite;
	}

	.dot:nth-child(2) {
		animation-delay: 0.2s;
	}

	.dot:nth-child(3) {
		animation-delay: 0.4s;
	}

	@keyframes pulse {
		0%, 80%, 100% {
			opacity: 0.3;
			transform: scale(0.8);
		}
		40% {
			opacity: 1;
			transform: scale(1);
		}
	}

	/* Standard mode */
	.standard-content {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 8px;
		min-width: 180px;
		max-width: 280px;
	}

	.status-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.frozen-icon {
		color: var(--color-text-3);
	}

	.prompt-preview, .response-preview {
		font-size: 11px;
		line-height: 1.4;
	}

	.prompt-preview .label, .response-preview .label {
		color: var(--color-text-3);
		margin-right: 4px;
	}

	.prompt-preview .text, .response-preview .text {
		color: var(--color-text-2);
	}

	.response-preview.streaming {
		display: flex;
		align-items: center;
	}

	.quick-actions {
		display: flex;
		gap: 4px;
		justify-content: flex-end;
	}

	.quick-btn {
		background: var(--color-surface-2);
		border: none;
		padding: 4px;
		border-radius: 4px;
		cursor: pointer;
		color: var(--color-text-2);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.quick-btn:hover {
		background: var(--color-surface-3);
		color: var(--color-text-1);
	}

	/* Expanded mode */
	.expanded-content {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 20px;
		width: 100%;
		height: 100%;
		box-sizing: border-box;
		overflow-y: auto;
	}

	.conversation-history {
		display: flex;
		flex-direction: column;
		gap: 16px;
		flex: 1;
		min-height: 0;
	}

	.message {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px 16px;
		border-radius: 8px;
		background: var(--color-surface-1, #1a1a1a);
	}

	.message.user {
		background: var(--color-surface-2, #252525);
		border-left: 3px solid var(--color-accent, #4a9eff);
	}

	.message.assistant {
		background: var(--color-surface-1, #1a1a1a);
		border-left: 3px solid var(--color-success, #4caf50);
	}

	.message-header {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		color: var(--color-text-3, #888);
	}

	.message-role {
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.message.user .message-header {
		color: var(--color-accent, #4a9eff);
	}

	.message.assistant .message-header {
		color: var(--color-success, #4caf50);
	}

	.message-content {
		font-size: 13px;
		line-height: 1.6;
		color: var(--color-text-1, #e0e0e0);
		white-space: pre-wrap;
		word-break: break-word;
	}

	.current-exchange {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-top: auto;
		padding-top: 16px;
		border-top: 1px solid var(--color-border, #3a3a3a);
	}

	.prompt-section {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.prompt-input {
		background: var(--color-surface-2, #252525);
		border: 1px solid var(--color-border, #3a3a3a);
		border-left: 3px solid var(--color-accent, #4a9eff);
		border-radius: 8px;
		padding: 12px 16px;
		font-size: 13px;
		line-height: 1.6;
		resize: vertical;
		min-height: 80px;
		color: var(--color-text-1, #e0e0e0);
		font-family: inherit;
	}

	.prompt-input:focus {
		outline: none;
		border-color: var(--color-accent, #4a9eff);
		background: var(--color-surface-1, #1a1a1a);
	}

	.prompt-input:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.prompt-actions {
		display: flex;
		justify-content: flex-end;
	}

	.action-btn {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 6px 12px;
		border-radius: 6px;
		font-size: 12px;
		font-weight: 500;
		border: none;
		cursor: pointer;
		transition: all 0.15s;
	}

	.action-btn.send {
		background: var(--color-accent);
		color: white;
	}

	.action-btn.send:hover:not(:disabled) {
		filter: brightness(1.1);
	}

	.action-btn.send:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.action-btn.cancel {
		background: var(--color-error);
		color: white;
	}

	.action-btn.cancel:hover {
		filter: brightness(1.1);
	}

	.response-section {
		background: var(--color-surface-1, #1a1a1a);
		border-radius: 8px;
		border-left: 3px solid var(--color-success, #4caf50);
		padding: 12px 16px;
	}

	.response-header {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		color: var(--color-success, #4caf50);
		margin-bottom: 8px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.response-content {
		font-size: 13px;
		line-height: 1.6;
		color: var(--color-text-1, #e0e0e0);
		white-space: pre-wrap;
		word-break: break-word;
	}

	.cursor {
		color: var(--color-accent);
		animation: blink 1s infinite;
	}

	@keyframes blink {
		0%, 50% {
			opacity: 1;
		}
		51%, 100% {
			opacity: 0;
		}
	}

	.usage-info {
		display: flex;
		gap: 12px;
		font-size: 10px;
		color: var(--color-text-3);
		justify-content: flex-end;
	}

	.error-display {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 8px;
		background: color-mix(in srgb, var(--color-error) 15%, transparent);
		border-radius: 6px;
		font-size: 11px;
		color: var(--color-error);
	}

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		padding: 40px 20px;
		color: var(--color-text-3, #666);
		font-size: 13px;
	}

	.streaming-status {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 16px;
		background: var(--color-surface-1, #1a1a1a);
		border-radius: 8px;
		border-left: 3px solid var(--color-warning, #ffc107);
		font-size: 12px;
		color: var(--color-text-2, #b0b0b0);
	}
</style>
