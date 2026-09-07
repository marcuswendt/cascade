/**
 * Expression types.
 *
 * These live in the runtime rather than in contracts because a compiled
 * expression carries a function, so it is runtime machinery rather than a
 * serializable DTO. Contracts stays dependency-free and data-only.
 */

import type { Node as NodeShape } from "./scope.js";

/**
 * The context an expression is evaluated against. Everything an expression can
 * see is on this object — there is no ambient global, and in particular no
 * clock: the time variables are values placed here by the caller.
 */
export interface ExpressionContext<TNode = NodeShape> {
  // Time variables. `$T`, `$F`, `$FF`, `$FPS` rewrite to these.
  /** seconds — $T */
  time: number;
  /** integer frame — $F */
  frame: number;
  /** fractional frame — $FF */
  fframe: number;
  /** rate — $FPS */
  fps: number;

  /** The node whose parameter is being evaluated. */
  self: TNode;

  // Channel functions
  ch: (path: string) => number;
  chs: (path: string) => string;
  chv: (path: string) => number[];

  // Node queries
  opexist: (path: string) => 0 | 1;
  opinput: (index: number) => TNode | null;

  // Math utilities
  fit: (value: number, oldMin: number, oldMax: number, newMin: number, newMax: number) => number;
  fit01: (value: number, newMin: number, newMax: number) => number;
  clamp: (value: number, min: number, max: number) => number;
  lerp: (a: number, b: number, t: number) => number;
  smooth: (value: number, min: number, max: number) => number;

  // Noise
  noise: (...coords: number[]) => number;
  random: (seed: number) => number;

  // String utilities
  padzero: (digits: number, value: number) => string;

  // Standard JS Math
  Math: typeof Math;
}

/** A compiled, cached expression ready to evaluate against a context. */
export interface CompiledExpression<TNode = NodeShape> {
  /** The expression as authored, `$` spellings intact. */
  source: string;
  /** The expression after `$` preprocessing — what was actually compiled. */
  compiledSource: string;
  evaluate: (context: ExpressionContext<TNode>) => unknown;
  /** Parameter paths referenced through ch/chs/chv, for dirty tracking. */
  dependencies: string[];
  /** True if the expression references any time variable, in either spelling. */
  isTimeDependent: boolean;
  error?: string;
}

/** Result of evaluating one expression. */
export interface ExpressionResult {
  value: unknown;
  error?: string;
}

/** A referenced path that does not resolve. */
export interface PathWarning {
  nodeId: string;
  nodePath: string;
  propName: string;
  expression: string;
  brokenPath: string;
}
