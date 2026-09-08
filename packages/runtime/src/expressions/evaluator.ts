/**
 * The neutral expression evaluator.
 *
 * Compiles parameter expressions and evaluates them against a time state and a
 * host-supplied scope. It imports nothing from Studio and touches no platform
 * API, so a headless cook can resolve `sin($T)` on a parameter exactly as the
 * editor does.
 *
 * Determinism: an expression is a parameter resolved *before* execute runs, so
 * the node receives a plain number and stays pure. Same graph plus same frame
 * gives the same output.
 */

import { clamp, fit, fit01, lerp, MATH_SCOPE, noise, padzero, random, smooth } from "./math.js";
import { hasTimeReference, preprocessExpression } from "./preprocess.js";
import type { ExpressionScope, Node as NodeShape } from "./scope.js";
import { TimeState } from "./time.js";
import type {
  CompiledExpression,
  ExpressionContext,
  ExpressionResult
} from "./types.js";

const DEPENDENCY_PATTERN = /\b(?:ch|chs|chv)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

export class ExpressionEvaluator<TNode extends NodeShape = NodeShape> {
  protected readonly timeState = new TimeState();
  private readonly compiledCache = new Map<string, CompiledExpression<TNode>>();
  private scope: ExpressionScope<TNode> | null;

  constructor(scope: ExpressionScope<TNode> | null = null) {
    this.scope = scope;
  }

  /** Bind (or rebind) the host scope. Clears nothing: compilation is scope-free. */
  setScope(scope: ExpressionScope<TNode> | null): void {
    this.scope = scope;
  }

  getScope(): ExpressionScope<TNode> | null {
    return this.scope;
  }

  // ============ Time ============

  /** Set the current frame. Fractional frames are preserved. */
  setFrame(frame: number): void {
    this.timeState.setFrame(frame);
  }

  /** Set the current time in seconds, keeping the sub-frame remainder. */
  setTime(seconds: number): void {
    this.timeState.setTime(seconds);
  }

  setFps(fps: number): void {
    this.timeState.setFps(fps);
  }

  /** seconds — $T */
  get time(): number {
    return this.timeState.time;
  }

  /** integer frame — $F */
  get frame(): number {
    return this.timeState.frame;
  }

  /** fractional frame — $FF */
  get fframe(): number {
    return this.timeState.frameFraction;
  }

  /** rate — $FPS */
  get fps(): number {
    return this.timeState.fps;
  }

  // ============ Compile / evaluate ============

  compile(expression: string): CompiledExpression<TNode> {
    const cached = this.compiledCache.get(expression);
    if (cached) return cached;

    const dependencies = this.extractDependencies(expression);
    const isTimeDependent = hasTimeReference(expression);
    const compiledSource = preprocessExpression(expression);

    try {
      const fnBody = `
        with (context) {
          return (${compiledSource});
        }
      `;
      const evaluator = new Function("context", fnBody) as (
        context: ExpressionContext<TNode>
      ) => unknown;

      const compiled: CompiledExpression<TNode> = {
        source: expression,
        compiledSource,
        evaluate: evaluator,
        dependencies,
        isTimeDependent
      };

      this.compiledCache.set(expression, compiled);
      return compiled;
    } catch (err) {
      return {
        source: expression,
        compiledSource,
        evaluate: () => undefined,
        dependencies,
        isTimeDependent,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }

  evaluate(expression: string, node: TNode): ExpressionResult {
    const compiled = this.compile(expression);
    if (compiled.error) return { value: undefined, error: compiled.error };

    try {
      return { value: compiled.evaluate(this.createContext(node)) };
    } catch (err) {
      return {
        value: undefined,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }

  /** Build the context an expression sees. */
  createContext(node: TNode): ExpressionContext<TNode> {
    return {
      time: this.timeState.time,
      frame: this.timeState.frame,
      fframe: this.timeState.frameFraction,
      fps: this.timeState.fps,

      self: node,

      ch: (path: string) => this.ch(node, path),
      chs: (path: string) => this.chs(node, path),
      chv: (path: string) => this.chv(node, path),

      opexist: (path: string) => (this.scope?.nodeExists(node, path) ? 1 : 0),
      opinput: (index: number) => this.scope?.inputNode(node, index) ?? null,

      fit,
      fit01,
      clamp,
      lerp,
      smooth,
      noise,
      random,
      padzero,

      // Bare maths — `sin($FF * 0.5)` rather than `Math.sin(...)`. Spread
      // before `Math` so nothing here can shadow the namespace itself.
      ...MATH_SCOPE,

      Math
    };
  }

  // ============ Channel functions ============

  ch(node: TNode, path: string): number {
    const resolved = this.resolveParam(node, path);
    if (!resolved) return 0;

    const value = resolved.value;
    if (typeof value === "number") return value;
    if (typeof value === "string") return parseFloat(value) || 0;
    if (typeof value === "boolean") return value ? 1 : 0;
    return 0;
  }

  chs(node: TNode, path: string): string {
    const resolved = this.resolveParam(node, path);
    if (!resolved) return "";
    return String(resolved.value ?? "");
  }

  chv(node: TNode, path: string): number[] {
    const resolved = this.resolveParam(node, path);
    if (!resolved) return [];

    const value = resolved.value;
    if (Array.isArray(value)) {
      return value.map((v) => (typeof v === "number" ? v : parseFloat(String(v)) || 0));
    }
    if (typeof value === "number") return [value];
    return [];
  }

  private resolveParam(node: TNode, path: string): { value: unknown } | null {
    return this.scope?.resolveParam(node, path) ?? null;
  }

  /** True if a referenced path resolves from this node. */
  validatePath(fromNode: TNode, path: string): boolean {
    return this.resolveParam(fromNode, path) !== null;
  }

  /** Parameter paths referenced through ch/chs/chv. */
  extractDependencies(expression: string): string[] {
    const deps: string[] = [];
    DEPENDENCY_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = DEPENDENCY_PATTERN.exec(expression)) !== null) {
      deps.push(match[1]);
    }
    return deps;
  }

  /** True if the expression references time, in either the bare or `$` spelling. */
  hasTimeReference(expression: string): boolean {
    return hasTimeReference(expression);
  }

  clearCache(): void {
    this.compiledCache.clear();
  }
}
