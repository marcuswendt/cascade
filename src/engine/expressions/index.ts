/**
 * Expression Engine Module
 *
 * Provides expression evaluation for Cascade parameters with:
 * - Channel functions (ch, chs, chv)
 * - Time variables (time, frame, fps)
 * - Math utilities (fit, clamp, lerp, noise, etc.)
 */

export { ExpressionEngine, expressionEngine } from './ExpressionEngine.js';
export type { ExpressionContext, CompiledExpression, PathWarning } from './ExpressionEngine.js';
