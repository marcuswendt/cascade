/**
 * Engine - Core runtime infrastructure (headless)
 *
 * This package runs without DOM/browser dependencies:
 * - cascade: Global API (node(), ch(), time(), frame()...)
 * - expressions: Expression evaluation engine
 * - AssetManager: Asset loading
 * - GraphValidator: Graph structure validation
 * - ModuleResolver: Module/import resolution
 * - PackageManager: NPM package loading
 *
 * For editor-specific features (UI, file watching, code history),
 * see src/editor/ instead.
 */

export { AssetManager, NodeAssetLoader, type Asset } from './AssetManager.js';
export { PackageManager } from './PackageManager.js';
export { ModuleResolver, createModuleResolver } from './ModuleResolver.js';
export { GraphValidator, type ValidationResult } from './GraphValidator.js';

// Expression engine
export { ExpressionEngine, expressionEngine } from './expressions/index.js';
export type { ExpressionContext, CompiledExpression } from './expressions/index.js';

// Cascade global API
export { cascade, CascadeContext } from './cascade.js';
