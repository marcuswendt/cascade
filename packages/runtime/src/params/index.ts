/**
 * Parameter resolution: the order in which a parameter becomes a value.
 *
 * One module, one order, both hosts. See ./resolve.ts for why evaluation
 * itself is a callback rather than a dependency.
 */

export { PropAnimator } from "./animator.js";
export type { AnimatableNode, PropAnimatorTopology } from "./animator.js";
export {
  isBoundProp,
  resolvePropBinding,
} from "./resolve.js";
export type {
  PropBinding,
  PropBindingSource,
  PropResolutionContext,
  ResolvedProp,
} from "./resolve.js";
