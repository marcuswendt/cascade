/**
 * Parameter expressions, neutral runtime.
 *
 * Compilation, `$` time variables, math utilities and the host scope binding.
 * Depends on nothing outside this folder, so both Studio and a headless host
 * evaluate parameters with the same engine.
 */

export { ExpressionEvaluator } from "./evaluator.js";
export {
  clamp,
  fit,
  fit01,
  lerp,
  noise,
  padzero,
  random,
  smooth
} from "./math.js";
export {
  TIME_IDENTIFIERS,
  TIME_TOKENS,
  hasTimeReference,
  preprocessExpression
} from "./preprocess.js";
export { DEFAULT_FPS, MIN_FRAME, TimeState } from "./time.js";
export type { TimeVariables } from "./time.js";
export type { ExpressionScope, Node as ExpressionNode } from "./scope.js";
export type {
  CompiledExpression,
  ExpressionContext,
  ExpressionResult,
  PathWarning
} from "./types.js";
