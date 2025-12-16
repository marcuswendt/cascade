/**
 * Provider exports and initialization
 */

export { Provider } from './Provider';
export { ReplicateProvider } from './ReplicateProvider';
export { GoogleProvider } from './GoogleProvider';
export { FalProvider } from './FalProvider';
export { OpenAIProvider } from './OpenAIProvider';
export { AnthropicProvider } from './AnthropicProvider';

import { ProviderRegistry } from '../ProviderRegistry';
import { ReplicateProvider } from './ReplicateProvider';
import { GoogleProvider } from './GoogleProvider';
import { FalProvider } from './FalProvider';
import { OpenAIProvider } from './OpenAIProvider';
import { AnthropicProvider } from './AnthropicProvider';

/**
 * Initialize all providers and register them with the registry.
 * Call this once at application startup.
 */
export function initializeProviders(): void {
	// Only initialize once
	if (ProviderRegistry.hasProvider('replicate')) {
		return;
	}

	// Register providers
	ProviderRegistry.registerProvider(new ReplicateProvider());
	ProviderRegistry.registerProvider(new GoogleProvider());
	ProviderRegistry.registerProvider(new FalProvider());
	ProviderRegistry.registerProvider(new OpenAIProvider());
	ProviderRegistry.registerProvider(new AnthropicProvider());
}
