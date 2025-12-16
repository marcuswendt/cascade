/**
 * Registry for AI providers and models
 *
 * Manages provider instances and model schemas, providing
 * unified access to all available AI capabilities.
 */

import type { ProviderType, ModelSchema, ModelCapability } from './types';
import type { Provider } from './providers/Provider';
import { AIError, AIErrorType } from './errors';

/**
 * Central registry for AI providers and models
 */
class ProviderRegistryClass {
	/** Registered provider instances */
	private providers = new Map<ProviderType, Provider>();

	/** Registered model schemas */
	private models = new Map<string, ModelSchema>();

	/** Model ID to provider mapping */
	private modelProviders = new Map<string, ProviderType>();

	// =========================================================================
	// Provider Management
	// =========================================================================

	/**
	 * Register a provider instance
	 */
	registerProvider(provider: Provider): void {
		this.providers.set(provider.id, provider);

		// Register all models from this provider
		for (const model of provider.getModels()) {
			this.registerModel(model);
		}
	}

	/**
	 * Get a provider by type
	 * @throws AIError if provider not found
	 */
	getProvider(type: ProviderType): Provider {
		const provider = this.providers.get(type);
		if (!provider) {
			throw new AIError(AIErrorType.UNKNOWN, `Provider "${type}" not registered`, {
				retryable: false
			});
		}
		return provider;
	}

	/**
	 * Get the provider for a specific model
	 * @throws AIError if model or provider not found
	 */
	getProviderForModel(modelId: string): Provider {
		const providerType = this.modelProviders.get(modelId);
		if (!providerType) {
			throw new AIError(AIErrorType.MODEL_UNAVAILABLE, `Model "${modelId}" not found`, {
				model: modelId,
				retryable: false
			});
		}
		return this.getProvider(providerType);
	}

	/**
	 * Check if a provider is registered
	 */
	hasProvider(type: ProviderType): boolean {
		return this.providers.has(type);
	}

	/**
	 * Get all registered providers
	 */
	getAllProviders(): Provider[] {
		return Array.from(this.providers.values());
	}

	/**
	 * Get all configured (have API key) providers
	 */
	getConfiguredProviders(): Provider[] {
		return this.getAllProviders().filter((p) => p.isConfigured());
	}

	// =========================================================================
	// Model Management
	// =========================================================================

	/**
	 * Register a model schema
	 */
	registerModel(model: ModelSchema): void {
		this.models.set(model.id, model);
		this.modelProviders.set(model.id, model.provider);
	}

	/**
	 * Get a model by ID
	 */
	getModel(modelId: string): ModelSchema | null {
		return this.models.get(modelId) ?? null;
	}

	/**
	 * Get all registered models
	 */
	getAllModels(): ModelSchema[] {
		return Array.from(this.models.values());
	}

	/**
	 * Get models filtered by capability
	 */
	getModelsByCapability(capability: ModelCapability): ModelSchema[] {
		return this.getAllModels().filter((m) => m.capabilities.includes(capability));
	}

	/**
	 * Get models that support image generation
	 */
	getImageModels(): ModelSchema[] {
		return this.getModelsByCapability('generate');
	}

	/**
	 * Get models that support image editing
	 */
	getEditModels(): ModelSchema[] {
		return this.getAllModels().filter(
			(m) =>
				m.capabilities.includes('inpaint') ||
				m.capabilities.includes('instruct') ||
				m.capabilities.includes('outpaint')
		);
	}

	/**
	 * Get models that support LLM text completion
	 */
	getLLMModels(): ModelSchema[] {
		return this.getModelsByCapability('llm');
	}

	/**
	 * Get models that support vision/image description
	 */
	getVisionModels(): ModelSchema[] {
		return this.getModelsByCapability('vision');
	}

	/**
	 * Get models from a specific provider
	 */
	getModelsForProvider(providerType: ProviderType): ModelSchema[] {
		return this.getAllModels().filter((m) => m.provider === providerType);
	}

	/**
	 * Get models grouped by category
	 */
	getModelsByCategory(): Record<string, ModelSchema[]> {
		const categories: Record<string, ModelSchema[]> = {
			fast: [],
			quality: [],
			specialized: []
		};

		for (const model of this.getAllModels()) {
			categories[model.category]?.push(model);
		}

		return categories;
	}

	// =========================================================================
	// Provider Helpers
	// =========================================================================

	/**
	 * Get an LLM provider for a specific model
	 */
	getLLMProvider(modelId: string): Provider {
		const model = this.getModel(modelId);
		if (!model || !model.capabilities.includes('llm')) {
			throw new AIError(AIErrorType.MODEL_UNAVAILABLE, `LLM model "${modelId}" not found`, {
				model: modelId,
				retryable: false
			});
		}
		return this.getProvider(model.provider);
	}

	/**
	 * Get a vision provider for a specific model
	 */
	getVisionProvider(modelId: string): Provider {
		const model = this.getModel(modelId);
		if (!model || !model.capabilities.includes('vision')) {
			throw new AIError(AIErrorType.MODEL_UNAVAILABLE, `Vision model "${modelId}" not found`, {
				model: modelId,
				retryable: false
			});
		}
		return this.getProvider(model.provider);
	}

	// =========================================================================
	// UI Helpers
	// =========================================================================

	/**
	 * Get model options for a select dropdown, grouped by provider
	 * Models without API keys are marked with * and still selectable
	 */
	getImageModelOptions(): { value: string; label: string; group?: string; disabled?: boolean }[] {
		return this.getImageModels().map((model) => {
			const provider = this.providers.get(model.provider);
			const isConfigured = provider?.isConfigured() ?? false;

			return {
				value: model.id,
				label: isConfigured ? model.name : `${model.name} *`,
				group: provider?.name ?? model.provider
			};
		});
	}

	/**
	 * Get edit model options for a select dropdown, grouped by provider
	 * Models without API keys are marked with * and still selectable
	 */
	getEditModelOptions(): { value: string; label: string; group?: string; disabled?: boolean }[] {
		return this.getEditModels().map((model) => {
			const provider = this.providers.get(model.provider);
			const isConfigured = provider?.isConfigured() ?? false;

			return {
				value: model.id,
				label: isConfigured ? model.name : `${model.name} *`,
				group: provider?.name ?? model.provider
			};
		});
	}

	/**
	 * Get LLM model options for a select dropdown
	 * Models without API keys are marked with * and still selectable
	 */
	getLLMModelOptions(): { value: string; label: string; disabled?: boolean }[] {
		return this.getLLMModels().map((model) => {
			const provider = this.providers.get(model.provider);
			const isConfigured = provider?.isConfigured() ?? false;

			return {
				value: model.id,
				label: isConfigured ? model.name : `${model.name} *`
			};
		});
	}

	/**
	 * Get vision model options for a select dropdown
	 * Models without API keys are marked with * and still selectable
	 */
	getVisionModelOptions(): { value: string; label: string; disabled?: boolean }[] {
		return this.getVisionModels().map((model) => {
			const provider = this.providers.get(model.provider);
			const isConfigured = provider?.isConfigured() ?? false;

			return {
				value: model.id,
				label: isConfigured ? model.name : `${model.name} *`
			};
		});
	}

	// =========================================================================
	// Default Model Selection
	// =========================================================================

	/**
	 * Get the default image generation model
	 * Prefers fast models from configured providers
	 */
	getDefaultImageModel(): string | null {
		// First try to find a fast model from a configured provider
		const fastModels = this.getImageModels().filter((m) => m.category === 'fast');
		for (const model of fastModels) {
			if (this.providers.get(model.provider)?.isConfigured()) {
				return model.id;
			}
		}

		// Fall back to any configured image model
		for (const model of this.getImageModels()) {
			if (this.providers.get(model.provider)?.isConfigured()) {
				return model.id;
			}
		}

		// Return first image model even if not configured
		const firstModel = this.getImageModels()[0];
		return firstModel?.id ?? null;
	}

	/**
	 * Get the default LLM model
	 */
	getDefaultLLMModel(): string | null {
		for (const model of this.getLLMModels()) {
			if (this.providers.get(model.provider)?.isConfigured()) {
				return model.id;
			}
		}
		const firstModel = this.getLLMModels()[0];
		return firstModel?.id ?? null;
	}

	/**
	 * Get the default vision model
	 */
	getDefaultVisionModel(): string | null {
		for (const model of this.getVisionModels()) {
			if (this.providers.get(model.provider)?.isConfigured()) {
				return model.id;
			}
		}
		const firstModel = this.getVisionModels()[0];
		return firstModel?.id ?? null;
	}

	// =========================================================================
	// Debug
	// =========================================================================

	/**
	 * Get debug info about registered providers and models
	 */
	getDebugInfo(): {
		providers: { id: string; name: string; configured: boolean }[];
		models: { id: string; name: string; provider: string; capabilities: string[] }[];
	} {
		return {
			providers: this.getAllProviders().map((p) => ({
				id: p.id,
				name: p.name,
				configured: p.isConfigured()
			})),
			models: this.getAllModels().map((m) => ({
				id: m.id,
				name: m.name,
				provider: m.provider,
				capabilities: m.capabilities
			}))
		};
	}
}

// Singleton instance
export const ProviderRegistry = new ProviderRegistryClass();
