import { writable } from 'svelte/store';
import type { AIServiceType } from './settingsStore';

/**
 * UI Event Store
 *
 * Provides a way for nodes and components to request UI actions
 * like opening dialogs without needing to pass callbacks through
 * the entire component tree.
 */

export interface SettingsDialogRequest {
	service: AIServiceType | null;
	timestamp: number;
}

/**
 * Store for requesting the settings dialog to open
 * When set, App.svelte will open the SettingsDialog with the specified service
 */
export const settingsDialogRequest = writable<SettingsDialogRequest | null>(null);

/**
 * Request to open the settings dialog, optionally for a specific service
 */
export function requestSettingsDialog(service?: AIServiceType): void {
	settingsDialogRequest.set({
		service: service ?? null,
		timestamp: Date.now()
	});
}

/**
 * Clear the settings dialog request (called after dialog opens)
 */
export function clearSettingsDialogRequest(): void {
	settingsDialogRequest.set(null);
}
