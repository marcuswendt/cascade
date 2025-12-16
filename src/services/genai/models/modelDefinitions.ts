/**
 * Model definitions for all supported AI models
 *
 * Each model has a schema defining its capabilities, parameters, and provider.
 */

import type { ModelSchema } from '../types';

// =============================================================================
// Image Generation Models
// =============================================================================

/**
 * Flux models from Black Forest Labs (via Replicate)
 */
export const fluxModels: ModelSchema[] = [
	{
		id: 'flux-schnell',
		name: 'Flux Schnell',
		provider: 'replicate',
		endpoint: 'black-forest-labs/flux-schnell',
		capabilities: ['generate'],
		supportsImageInput: false,
		supportedReferenceTypes: [],
		supportsNegativePrompt: false,
		supportsBatchGeneration: false,
		maxBatchSize: 4,
		parameters: [
			{
				name: 'num_inference_steps',
				type: 'number',
				default: 4,
				min: 1,
				max: 12,
				step: 1,
				description: 'Number of denoising steps (4 is usually optimal)'
			},
			{
				name: 'guidance',
				type: 'number',
				default: 3.5,
				min: 1,
				max: 10,
				step: 0.5,
				description: 'Guidance scale',
				advanced: true
			}
		],
		defaultWidth: 1024,
		defaultHeight: 1024,
		maxResolution: 2048,
		outputFormat: 'webp',
		icon: 'Zap',
		category: 'fast'
	},
	{
		id: 'flux-dev',
		name: 'Flux Dev',
		provider: 'replicate',
		endpoint: 'black-forest-labs/flux-dev',
		capabilities: ['generate'],
		supportsImageInput: true,
		supportedReferenceTypes: ['general'],
		supportsNegativePrompt: false,
		supportsBatchGeneration: false,
		maxBatchSize: 4,
		parameters: [
			{
				name: 'num_inference_steps',
				type: 'number',
				default: 28,
				min: 1,
				max: 50,
				step: 1,
				description: 'Number of denoising steps'
			},
			{
				name: 'guidance',
				type: 'number',
				default: 3.5,
				min: 1,
				max: 10,
				step: 0.5,
				description: 'Guidance scale'
			},
			{
				name: 'prompt_strength',
				type: 'number',
				default: 0.8,
				min: 0,
				max: 1,
				step: 0.05,
				description: 'Prompt strength when using image input',
				advanced: true
			}
		],
		defaultWidth: 1024,
		defaultHeight: 1024,
		maxResolution: 2048,
		outputFormat: 'webp',
		icon: 'Sparkles',
		category: 'quality'
	},
	{
		id: 'flux-pro',
		name: 'Flux Pro 1.1',
		provider: 'replicate',
		endpoint: 'black-forest-labs/flux-1.1-pro',
		capabilities: ['generate'],
		supportsImageInput: true,
		supportedReferenceTypes: ['general'],
		supportsNegativePrompt: false,
		supportsBatchGeneration: false,
		maxBatchSize: 4,
		parameters: [
			{
				name: 'guidance',
				type: 'number',
				default: 3.5,
				min: 1,
				max: 10,
				step: 0.5,
				description: 'Guidance scale'
			},
			{
				name: 'num_inference_steps',
				type: 'number',
				default: 28,
				min: 1,
				max: 50,
				step: 1,
				description: 'Number of denoising steps',
				advanced: true
			},
			{
				name: 'output_quality',
				type: 'number',
				default: 80,
				min: 1,
				max: 100,
				step: 1,
				description: 'Output JPEG quality',
				advanced: true
			}
		],
		defaultWidth: 1024,
		defaultHeight: 1024,
		maxResolution: 2048,
		outputFormat: 'jpg',
		icon: 'Star',
		category: 'quality'
	}
];

/**
 * Stable Diffusion models (via Replicate)
 */
export const sdModels: ModelSchema[] = [
	{
		id: 'sdxl',
		name: 'Stable Diffusion XL',
		provider: 'replicate',
		endpoint: 'stability-ai/sdxl',
		capabilities: ['generate'],
		supportsImageInput: true,
		supportedReferenceTypes: ['general', 'mask'],
		supportsNegativePrompt: true,
		supportsBatchGeneration: false,
		maxBatchSize: 4,
		parameters: [
			{
				name: 'guidance_scale',
				type: 'number',
				default: 7.5,
				min: 0,
				max: 20,
				step: 0.5,
				description: 'Guidance scale (higher = more prompt adherence)'
			},
			{
				name: 'num_inference_steps',
				type: 'number',
				default: 30,
				min: 1,
				max: 100,
				step: 1,
				description: 'Number of denoising steps'
			},
			{
				name: 'scheduler',
				type: 'select',
				default: 'K_EULER',
				options: [
					{ value: 'K_EULER', label: 'Euler' },
					{ value: 'K_EULER_ANCESTRAL', label: 'Euler Ancestral' },
					{ value: 'K_DPM_2_ANCESTRAL', label: 'DPM++ 2M' },
					{ value: 'DDIM', label: 'DDIM' },
					{ value: 'K_HEUN', label: 'Heun' }
				],
				description: 'Sampling scheduler',
				advanced: true
			},
			{
				name: 'refine',
				type: 'select',
				default: 'no_refiner',
				options: [
					{ value: 'no_refiner', label: 'No Refiner' },
					{ value: 'expert_ensemble_refiner', label: 'Expert Ensemble' },
					{ value: 'base_image_refiner', label: 'Base Image Refiner' }
				],
				description: 'Refinement method',
				advanced: true
			}
		],
		defaultWidth: 1024,
		defaultHeight: 1024,
		maxResolution: 2048,
		outputFormat: 'png',
		icon: 'Box',
		category: 'quality'
	}
];

/**
 * Edit models for inpainting and image editing
 */
export const editModels: ModelSchema[] = [
	{
		id: 'flux-fill',
		name: 'Flux Fill',
		provider: 'replicate',
		endpoint: 'black-forest-labs/flux-fill-pro',
		capabilities: ['inpaint', 'outpaint'],
		supportsImageInput: true,
		supportedReferenceTypes: ['mask'],
		supportsNegativePrompt: false,
		supportsBatchGeneration: false,
		maxBatchSize: 4,
		parameters: [
			{
				name: 'guidance',
				type: 'number',
				default: 3.5,
				min: 1,
				max: 10,
				step: 0.5,
				description: 'Guidance scale'
			},
			{
				name: 'num_inference_steps',
				type: 'number',
				default: 28,
				min: 1,
				max: 50,
				step: 1,
				description: 'Number of denoising steps',
				advanced: true
			}
		],
		defaultWidth: 1024,
		defaultHeight: 1024,
		maxResolution: 2048,
		outputFormat: 'webp',
		icon: 'Paintbrush',
		category: 'specialized'
	},
	{
		id: 'sdxl-inpaint',
		name: 'SDXL Inpaint',
		provider: 'replicate',
		endpoint: 'stability-ai/sdxl-inpainting',
		capabilities: ['inpaint'],
		supportsImageInput: true,
		supportedReferenceTypes: ['mask'],
		supportsNegativePrompt: true,
		supportsBatchGeneration: false,
		maxBatchSize: 4,
		parameters: [
			{
				name: 'guidance_scale',
				type: 'number',
				default: 7.5,
				min: 0,
				max: 20,
				step: 0.5,
				description: 'Guidance scale'
			},
			{
				name: 'num_inference_steps',
				type: 'number',
				default: 30,
				min: 1,
				max: 100,
				step: 1,
				description: 'Number of denoising steps'
			},
			{
				name: 'strength',
				type: 'number',
				default: 0.85,
				min: 0,
				max: 1,
				step: 0.05,
				description: 'Edit strength'
			}
		],
		defaultWidth: 1024,
		defaultHeight: 1024,
		maxResolution: 2048,
		outputFormat: 'png',
		icon: 'Paintbrush',
		category: 'specialized'
	},
	{
		id: 'instruct-pix2pix',
		name: 'InstructPix2Pix',
		provider: 'replicate',
		endpoint: 'timothybrooks/instruct-pix2pix',
		capabilities: ['instruct'],
		supportsImageInput: true,
		supportedReferenceTypes: [],
		supportsNegativePrompt: true,
		supportsBatchGeneration: false,
		maxBatchSize: 4,
		parameters: [
			{
				name: 'image_guidance_scale',
				type: 'number',
				default: 1.5,
				min: 1,
				max: 3,
				step: 0.1,
				description: 'How much to follow the input image'
			},
			{
				name: 'guidance_scale',
				type: 'number',
				default: 7.5,
				min: 0,
				max: 20,
				step: 0.5,
				description: 'How much to follow the instruction'
			},
			{
				name: 'num_inference_steps',
				type: 'number',
				default: 50,
				min: 1,
				max: 100,
				step: 1,
				description: 'Number of denoising steps'
			}
		],
		defaultWidth: 512,
		defaultHeight: 512,
		maxResolution: 1024,
		outputFormat: 'png',
		icon: 'Wand2',
		category: 'specialized'
	}
];

// =============================================================================
// Google Models
// =============================================================================

/**
 * Google Imagen models
 */
export const googleImageModels: ModelSchema[] = [
	{
		id: 'imagen-3',
		name: 'Imagen 3',
		provider: 'google',
		endpoint: 'imagen-3.0-generate-001',
		capabilities: ['generate'],
		supportsImageInput: false,
		supportedReferenceTypes: [],
		supportsNegativePrompt: true,
		supportsBatchGeneration: true,
		maxBatchSize: 4,
		parameters: [
			{
				name: 'aspectRatio',
				type: 'select',
				default: '1:1',
				options: [
					{ value: '1:1', label: 'Square (1:1)' },
					{ value: '16:9', label: 'Landscape (16:9)' },
					{ value: '9:16', label: 'Portrait (9:16)' },
					{ value: '4:3', label: 'Standard (4:3)' },
					{ value: '3:4', label: 'Portrait (3:4)' }
				],
				description: 'Output aspect ratio'
			},
			{
				name: 'personGeneration',
				type: 'select',
				default: 'allow_adult',
				options: [
					{ value: 'dont_allow', label: "Don't Allow" },
					{ value: 'allow_adult', label: 'Allow Adults' }
				],
				description: 'Person generation setting',
				advanced: true
			}
		],
		defaultWidth: 1024,
		defaultHeight: 1024,
		maxResolution: 2048,
		outputFormat: 'png',
		icon: 'Sparkles',
		category: 'quality'
	}
];

/**
 * Google Gemini models for vision and LLM
 */
export const geminiModels: ModelSchema[] = [
	{
		id: 'gemini-1.5-flash',
		name: 'Gemini 1.5 Flash',
		provider: 'google',
		endpoint: 'gemini-1.5-flash',
		capabilities: ['llm', 'vision'],
		supportsImageInput: true,
		supportedReferenceTypes: [],
		supportsNegativePrompt: false,
		supportsBatchGeneration: false,
		maxBatchSize: 1,
		parameters: [
			{
				name: 'temperature',
				type: 'number',
				default: 0.7,
				min: 0,
				max: 2,
				step: 0.1,
				description: 'Temperature (higher = more creative)'
			},
			{
				name: 'maxOutputTokens',
				type: 'number',
				default: 1024,
				min: 1,
				max: 8192,
				step: 128,
				description: 'Maximum output tokens',
				advanced: true
			}
		],
		defaultWidth: 0,
		defaultHeight: 0,
		maxResolution: 0,
		outputFormat: 'png',
		icon: 'MessageSquare',
		category: 'fast'
	},
	{
		id: 'gemini-1.5-pro',
		name: 'Gemini 1.5 Pro',
		provider: 'google',
		endpoint: 'gemini-1.5-pro',
		capabilities: ['llm', 'vision'],
		supportsImageInput: true,
		supportedReferenceTypes: [],
		supportsNegativePrompt: false,
		supportsBatchGeneration: false,
		maxBatchSize: 1,
		parameters: [
			{
				name: 'temperature',
				type: 'number',
				default: 0.7,
				min: 0,
				max: 2,
				step: 0.1,
				description: 'Temperature'
			},
			{
				name: 'maxOutputTokens',
				type: 'number',
				default: 2048,
				min: 1,
				max: 8192,
				step: 128,
				description: 'Maximum output tokens',
				advanced: true
			}
		],
		defaultWidth: 0,
		defaultHeight: 0,
		maxResolution: 0,
		outputFormat: 'png',
		icon: 'MessageSquare',
		category: 'quality'
	}
];

// =============================================================================
// Fal Models
// =============================================================================

/**
 * Fal.ai Flux models (similar to Replicate but via Fal API)
 */
export const falModels: ModelSchema[] = [
	{
		id: 'fal-flux-schnell',
		name: 'Flux Schnell (Fal)',
		provider: 'fal',
		endpoint: 'fal-ai/flux/schnell',
		capabilities: ['generate'],
		supportsImageInput: false,
		supportedReferenceTypes: [],
		supportsNegativePrompt: false,
		supportsBatchGeneration: false,
		maxBatchSize: 4,
		parameters: [
			{
				name: 'num_inference_steps',
				type: 'number',
				default: 4,
				min: 1,
				max: 12,
				step: 1,
				description: 'Number of denoising steps'
			}
		],
		defaultWidth: 1024,
		defaultHeight: 1024,
		maxResolution: 2048,
		outputFormat: 'webp',
		icon: 'Zap',
		category: 'fast'
	},
	{
		id: 'fal-flux-pro',
		name: 'Flux Pro (Fal)',
		provider: 'fal',
		endpoint: 'fal-ai/flux/pro',
		capabilities: ['generate'],
		supportsImageInput: true,
		supportedReferenceTypes: ['general'],
		supportsNegativePrompt: false,
		supportsBatchGeneration: false,
		maxBatchSize: 4,
		parameters: [
			{
				name: 'num_inference_steps',
				type: 'number',
				default: 28,
				min: 1,
				max: 50,
				step: 1,
				description: 'Number of denoising steps'
			},
			{
				name: 'guidance_scale',
				type: 'number',
				default: 3.5,
				min: 1,
				max: 10,
				step: 0.5,
				description: 'Guidance scale'
			}
		],
		defaultWidth: 1024,
		defaultHeight: 1024,
		maxResolution: 2048,
		outputFormat: 'webp',
		icon: 'Star',
		category: 'quality'
	}
];

/**
 * Fal.ai edit models
 */
export const falEditModels: ModelSchema[] = [
	{
		id: 'fal-flux-fill',
		name: 'Flux Fill (Fal)',
		provider: 'fal',
		endpoint: 'fal-ai/flux/fill',
		capabilities: ['inpaint'],
		supportsImageInput: true,
		supportedReferenceTypes: ['mask'],
		supportsNegativePrompt: false,
		supportsBatchGeneration: false,
		maxBatchSize: 4,
		parameters: [
			{
				name: 'guidance_scale',
				type: 'number',
				default: 3.5,
				min: 1,
				max: 10,
				step: 0.5,
				description: 'Guidance scale'
			}
		],
		defaultWidth: 1024,
		defaultHeight: 1024,
		maxResolution: 2048,
		outputFormat: 'webp',
		icon: 'Paintbrush',
		category: 'specialized'
	}
];

// =============================================================================
// OpenAI Models
// =============================================================================

/**
 * OpenAI DALL-E models
 */
export const openAIImageModels: ModelSchema[] = [
	{
		id: 'dall-e-2',
		name: 'DALL-E 2',
		provider: 'openai',
		endpoint: 'dall-e-2',
		capabilities: ['generate'],
		supportsImageInput: false,
		supportedReferenceTypes: [],
		supportsNegativePrompt: false,
		supportsBatchGeneration: true,
		maxBatchSize: 4,
		parameters: [
			{
				name: 'quality',
				type: 'select',
				default: 'standard',
				options: [
					{ value: 'standard', label: 'Standard' },
					{ value: 'hd', label: 'HD' }
				],
				description: 'Image quality'
			}
		],
		defaultWidth: 1024,
		defaultHeight: 1024,
		maxResolution: 1024,
		outputFormat: 'png',
		icon: 'Sparkles',
		category: 'quality'
	},
	{
		id: 'dall-e-3',
		name: 'DALL-E 3',
		provider: 'openai',
		endpoint: 'dall-e-3',
		capabilities: ['generate'],
		supportsImageInput: false,
		supportedReferenceTypes: [],
		supportsNegativePrompt: false,
		supportsBatchGeneration: false, // DALL-E 3 only supports n=1
		maxBatchSize: 1,
		parameters: [
			{
				name: 'quality',
				type: 'select',
				default: 'standard',
				options: [
					{ value: 'standard', label: 'Standard' },
					{ value: 'hd', label: 'HD' }
				],
				description: 'Image quality'
			},
			{
				name: 'style',
				type: 'select',
				default: 'vivid',
				options: [
					{ value: 'vivid', label: 'Vivid' },
					{ value: 'natural', label: 'Natural' }
				],
				description: 'Image style'
			}
		],
		defaultWidth: 1024,
		defaultHeight: 1024,
		maxResolution: 1792,
		outputFormat: 'png',
		icon: 'Sparkles',
		category: 'quality'
	}
];

/**
 * OpenAI GPT models for LLM and Vision
 */
export const openAIModels: ModelSchema[] = [
	{
		id: 'gpt-4o',
		name: 'GPT-4o',
		provider: 'openai',
		endpoint: 'gpt-4o',
		capabilities: ['llm', 'vision'],
		supportsImageInput: true,
		supportedReferenceTypes: [],
		supportsNegativePrompt: false,
		supportsBatchGeneration: false,
		maxBatchSize: 1,
		parameters: [
			{
				name: 'temperature',
				type: 'number',
				default: 0.7,
				min: 0,
				max: 2,
				step: 0.1,
				description: 'Temperature (higher = more creative)'
			},
			{
				name: 'maxTokens',
				type: 'number',
				default: 1000,
				min: 1,
				max: 4096,
				step: 100,
				description: 'Maximum output tokens',
				advanced: true
			}
		],
		defaultWidth: 0,
		defaultHeight: 0,
		maxResolution: 0,
		outputFormat: 'png',
		icon: 'MessageSquare',
		category: 'quality'
	},
	{
		id: 'gpt-4o-mini',
		name: 'GPT-4o Mini',
		provider: 'openai',
		endpoint: 'gpt-4o-mini',
		capabilities: ['llm', 'vision'],
		supportsImageInput: true,
		supportedReferenceTypes: [],
		supportsNegativePrompt: false,
		supportsBatchGeneration: false,
		maxBatchSize: 1,
		parameters: [
			{
				name: 'temperature',
				type: 'number',
				default: 0.7,
				min: 0,
				max: 2,
				step: 0.1,
				description: 'Temperature'
			},
			{
				name: 'maxTokens',
				type: 'number',
				default: 1000,
				min: 1,
				max: 4096,
				step: 100,
				description: 'Maximum output tokens',
				advanced: true
			}
		],
		defaultWidth: 0,
		defaultHeight: 0,
		maxResolution: 0,
		outputFormat: 'png',
		icon: 'MessageSquare',
		category: 'fast'
	}
];

// =============================================================================
// Anthropic Models
// =============================================================================

/**
 * Anthropic Claude models for LLM and Vision
 */
export const claudeModels: ModelSchema[] = [
	{
		id: 'claude-3-5-sonnet',
		name: 'Claude 3.5 Sonnet',
		provider: 'anthropic',
		endpoint: 'claude-3-5-sonnet-latest',
		capabilities: ['llm', 'vision'],
		supportsImageInput: true,
		supportedReferenceTypes: [],
		supportsNegativePrompt: false,
		supportsBatchGeneration: false,
		maxBatchSize: 1,
		parameters: [
			{
				name: 'temperature',
				type: 'number',
				default: 0.7,
				min: 0,
				max: 1,
				step: 0.1,
				description: 'Temperature (higher = more creative)'
			},
			{
				name: 'maxTokens',
				type: 'number',
				default: 1024,
				min: 1,
				max: 8192,
				step: 128,
				description: 'Maximum output tokens',
				advanced: true
			}
		],
		defaultWidth: 0,
		defaultHeight: 0,
		maxResolution: 0,
		outputFormat: 'png',
		icon: 'MessageSquare',
		category: 'quality'
	},
	{
		id: 'claude-3-5-haiku',
		name: 'Claude 3.5 Haiku',
		provider: 'anthropic',
		endpoint: 'claude-3-5-haiku-latest',
		capabilities: ['llm', 'vision'],
		supportsImageInput: true,
		supportedReferenceTypes: [],
		supportsNegativePrompt: false,
		supportsBatchGeneration: false,
		maxBatchSize: 1,
		parameters: [
			{
				name: 'temperature',
				type: 'number',
				default: 0.7,
				min: 0,
				max: 1,
				step: 0.1,
				description: 'Temperature (higher = more creative)'
			},
			{
				name: 'maxTokens',
				type: 'number',
				default: 1024,
				min: 1,
				max: 8192,
				step: 128,
				description: 'Maximum output tokens',
				advanced: true
			}
		],
		defaultWidth: 0,
		defaultHeight: 0,
		maxResolution: 0,
		outputFormat: 'png',
		icon: 'MessageSquare',
		category: 'fast'
	},
	{
		id: 'claude-3-opus',
		name: 'Claude 3 Opus',
		provider: 'anthropic',
		endpoint: 'claude-3-opus-latest',
		capabilities: ['llm', 'vision'],
		supportsImageInput: true,
		supportedReferenceTypes: [],
		supportsNegativePrompt: false,
		supportsBatchGeneration: false,
		maxBatchSize: 1,
		parameters: [
			{
				name: 'temperature',
				type: 'number',
				default: 0.7,
				min: 0,
				max: 1,
				step: 0.1,
				description: 'Temperature (higher = more creative)'
			},
			{
				name: 'maxTokens',
				type: 'number',
				default: 2048,
				min: 1,
				max: 8192,
				step: 128,
				description: 'Maximum output tokens',
				advanced: true
			}
		],
		defaultWidth: 0,
		defaultHeight: 0,
		maxResolution: 0,
		outputFormat: 'png',
		icon: 'MessageSquare',
		category: 'quality'
	}
];

// =============================================================================
// All Models Combined
// =============================================================================

/**
 * All image generation models
 */
export const imageModels: ModelSchema[] = [
	...fluxModels,
	...sdModels,
	...googleImageModels,
	...falModels,
	...openAIImageModels
];

/**
 * All models (image + edit + LLM + vision)
 */
export const allModels: ModelSchema[] = [
	...fluxModels,
	...sdModels,
	...editModels,
	...googleImageModels,
	...geminiModels,
	...falModels,
	...falEditModels,
	...openAIImageModels,
	...openAIModels,
	...claudeModels
];

/**
 * Get all models for a specific provider
 */
export function getModelsForProvider(provider: string): ModelSchema[] {
	return allModels.filter((m) => m.provider === provider);
}

/**
 * Get default model for a capability
 */
export function getDefaultModel(capability: 'generate' | 'inpaint' | 'llm' | 'vision'): string {
	switch (capability) {
		case 'generate':
			return 'flux-schnell';
		case 'inpaint':
			return 'flux-fill';
		case 'llm':
			return 'gemini-1.5-flash';
		case 'vision':
			return 'gemini-1.5-flash';
		default:
			return 'flux-schnell';
	}
}
