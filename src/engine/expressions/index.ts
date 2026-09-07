/**
 * Expression Engine Module
 *
 * Studio's binding of the neutral expression engine. Provides expression
 * evaluation for Cascade parameters with:
 * - Channel functions (ch, chs, chv)
 * - Time variables ($F, $FF, $T, $FPS; time, frame, fframe, fps as aliases)
 * - Math utilities (fit, clamp, lerp, noise, etc.)
 */

export { ExpressionEngine, expressionEngine } from './ExpressionEngine.js';
export type { ExpressionContext, CompiledExpression, PathWarning } from './ExpressionEngine.js';

// Re-exported from the neutral runtime so Studio code has one import site.
export { hasTimeReference, preprocessExpression, TimeState } from '@cascade/runtime/expressions';
export type { TimeVariables } from '@cascade/runtime/expressions';
