import { writable } from 'svelte/store';

/** Lets decoupled Studio components request the generic preferences dialog. */
export const settingsDialogRequest = writable(false);

export function requestSettingsDialog(): void {
	settingsDialogRequest.set(true);
}

export function clearSettingsDialogRequest(): void {
	settingsDialogRequest.set(false);
}
