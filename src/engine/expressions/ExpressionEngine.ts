/**
 * Expression Engine for Cascade
 *
 * Evaluates TypeScript expressions in parameter fields with access to:
 * - Channel functions: ch(), chs(), chv()
 * - Time variables: time, frame, fps
 * - Math utilities: fit(), clamp(), lerp(), noise(), etc.
 * - Node queries: opexist(), opinput()
 */

import type { Node } from '../../nodes/Node.js';
import type { Graph } from '../../nodes/Graph.js';

/**
 * Expression context passed to evaluated expressions
 */
export interface ExpressionContext {
  // Time globals
  time: number;
  frame: number;
  fps: number;

  // Current node reference
  self: Node;

  // Channel functions
  ch: (path: string) => number;
  chs: (path: string) => string;
  chv: (path: string) => number[];

  // Node queries
  opexist: (path: string) => 0 | 1;
  opinput: (index: number) => Node | null;

  // Math utilities
  fit: (value: number, oldMin: number, oldMax: number, newMin: number, newMax: number) => number;
  fit01: (value: number, newMin: number, newMax: number) => number;
  clamp: (value: number, min: number, max: number) => number;
  lerp: (a: number, b: number, t: number) => number;
  smooth: (value: number, min: number, max: number) => number;

  // Noise functions
  noise: (...coords: number[]) => number;
  random: (seed: number) => number;

  // String utilities
  padzero: (digits: number, value: number) => string;

  // Math object (standard JS Math)
  Math: typeof Math;
}

/**
 * Compiled expression ready for evaluation
 */
export interface CompiledExpression {
  source: string;
  evaluate: (context: ExpressionContext) => unknown;
  dependencies: string[];  // Referenced paths for dirty tracking
  isTimeDependent: boolean;  // True if uses time/frame/fps
  error?: string;
}

/**
 * Warning about a broken path in an expression
 */
export interface PathWarning {
  nodeId: string;           // ID of the node with the broken expression
  nodePath: string;         // Full path of the node (e.g., "/effects/blur1")
  propName: string;         // Name of the parameter with the expression
  expression: string;       // The full expression text
  brokenPath: string;       // The specific path that couldn't be resolved
}

/**
 * Expression Engine - compiles and evaluates TypeScript expressions
 */
export class ExpressionEngine {
  private compiledCache: Map<string, CompiledExpression> = new Map();
  private graph: Graph | null = null;

  // Time state
  private _frame: number = 1;
  private _fps: number = 30;

  /**
   * Set the graph reference for node lookups
   */
  setGraph(graph: Graph): void {
    this.graph = graph;
  }

  /**
   * Set current frame
   */
  setFrame(frame: number): void {
    this._frame = Math.max(1, Math.floor(frame));
  }

  /**
   * Set FPS
   */
  setFps(fps: number): void {
    this._fps = Math.max(1, fps);
  }

  /**
   * Get current time in seconds
   */
  get time(): number {
    return this._frame / this._fps;
  }

  /**
   * Get current frame
   */
  get frame(): number {
    return this._frame;
  }

  /**
   * Get FPS
   */
  get fps(): number {
    return this._fps;
  }

  /**
   * Compile an expression string into a reusable function
   */
  compile(expression: string): CompiledExpression {
    // Check cache
    const cached = this.compiledCache.get(expression);
    if (cached) return cached;

    // Extract dependencies (paths referenced in ch/chs/chv calls)
    const dependencies = this.extractDependencies(expression);

    // Check for time references
    const isTimeDependent = this.hasTimeReference(expression);

    try {
      // Create evaluation function
      // The expression is wrapped to return its value
      const fnBody = `
        with (context) {
          return (${expression});
        }
      `;

      const evaluator = new Function('context', fnBody) as (context: ExpressionContext) => unknown;

      const compiled: CompiledExpression = {
        source: expression,
        evaluate: evaluator,
        dependencies,
        isTimeDependent
      };

      this.compiledCache.set(expression, compiled);
      return compiled;
    } catch (err) {
      const compiled: CompiledExpression = {
        source: expression,
        evaluate: () => undefined,
        dependencies,
        isTimeDependent,
        error: err instanceof Error ? err.message : String(err)
      };
      return compiled;
    }
  }

  /**
   * Evaluate an expression in the context of a node
   */
  evaluate(expression: string, node: Node): { value: unknown; error?: string } {
    const compiled = this.compile(expression);

    if (compiled.error) {
      return { value: undefined, error: compiled.error };
    }

    try {
      const context = this.createContext(node);
      const value = compiled.evaluate(context);
      return { value };
    } catch (err) {
      return {
        value: undefined,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }

  /**
   * Create the expression context for a node
   */
  private createContext(node: Node): ExpressionContext {
    const self = this;

    return {
      // Time globals
      time: this.time,
      frame: this._frame,
      fps: this._fps,

      // Current node
      self: node,

      // Channel functions
      ch: (path: string) => self.ch(node, path),
      chs: (path: string) => self.chs(node, path),
      chv: (path: string) => self.chv(node, path),

      // Node queries
      opexist: (path: string) => self.opexist(node, path),
      opinput: (index: number) => self.opinput(node, index),

      // Math utilities
      fit: this.fit,
      fit01: this.fit01,
      clamp: this.clamp,
      lerp: this.lerp,
      smooth: this.smooth,

      // Noise functions
      noise: this.noise,
      random: this.random,

      // String utilities
      padzero: this.padzero,

      // Standard Math
      Math
    };
  }

  // ============ Channel Functions ============

  /**
   * Get parameter value as number
   */
  private ch(node: Node, path: string): number {
    const resolved = this.resolvePath(node, path);
    if (!resolved) return 0;

    const value = resolved.value;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return parseFloat(value) || 0;
    if (typeof value === 'boolean') return value ? 1 : 0;
    return 0;
  }

  /**
   * Get parameter value as string
   */
  private chs(node: Node, path: string): string {
    const resolved = this.resolvePath(node, path);
    if (!resolved) return '';
    return String(resolved.value ?? '');
  }

  /**
   * Get parameter value as vector (array of numbers)
   */
  private chv(node: Node, path: string): number[] {
    const resolved = this.resolvePath(node, path);
    if (!resolved) return [];

    const value = resolved.value;
    if (Array.isArray(value)) {
      return value.map(v => typeof v === 'number' ? v : parseFloat(v) || 0);
    }
    if (typeof value === 'number') return [value];
    return [];
  }

  /**
   * Resolve a path to get the parameter value
   */
  private resolvePath(fromNode: Node, path: string): { value: any } | null {
    // Parse path: could be node path or node/param path
    const lastSlash = path.lastIndexOf('/');

    if (lastSlash === -1 || path.startsWith('./')) {
      // Relative to current node - it's a param name
      const paramName = path.replace('./', '');
      const prop = fromNode.props[paramName];
      return prop ? { value: prop.value } : null;
    }

    // Try to resolve as node/param
    const nodePath = path.substring(0, lastSlash) || '.';
    const paramName = path.substring(lastSlash + 1);

    const targetNode = fromNode.node(nodePath);
    if (!targetNode) return null;

    const prop = targetNode.props[paramName];
    return prop ? { value: prop.value } : null;
  }

  /**
   * Validate a path from a node (public for validation)
   * Returns true if the path resolves to a valid target
   */
  validatePath(fromNode: Node, path: string): boolean {
    return this.resolvePath(fromNode, path) !== null;
  }

  /**
   * Validate all expression paths in the graph
   * Returns list of broken paths with their locations
   */
  validateAllPaths(): PathWarning[] {
    if (!this.graph) return [];

    const warnings: PathWarning[] = [];

    for (const node of this.graph.nodes) {
      for (const [propKey, prop] of Object.entries(node.props)) {
        if (!prop.expression) continue;

        // Extract paths from expression
        const paths = this.extractDependencies(prop.expression);

        for (const path of paths) {
          if (!this.validatePath(node, path)) {
            warnings.push({
              nodeId: node.id,
              nodePath: node.path(),
              propName: propKey,
              expression: prop.expression,
              brokenPath: path
            });
          }
        }
      }
    }

    return warnings;
  }

  // ============ Node Queries ============

  /**
   * Check if a node exists at path (returns 0 or 1)
   */
  private opexist(node: Node, path: string): 0 | 1 {
    return node.node(path) ? 1 : 0;
  }

  /**
   * Get input node by index
   */
  private opinput(node: Node, index: number): Node | null {
    if (!this.graph) return null;

    const inputPort = node.inputs[index];
    if (!inputPort || inputPort.connections.length === 0) return null;

    const conn = inputPort.connections[0];
    return this.graph.getNode(conn.from.nodeId);
  }

  // ============ Math Utilities ============

  /**
   * Remap value from one range to another
   */
  private fit(value: number, oldMin: number, oldMax: number, newMin: number, newMax: number): number {
    if (oldMax === oldMin) return newMin;
    const t = (value - oldMin) / (oldMax - oldMin);
    return newMin + t * (newMax - newMin);
  }

  /**
   * Remap value from 0-1 to new range
   */
  private fit01(value: number, newMin: number, newMax: number): number {
    return newMin + value * (newMax - newMin);
  }

  /**
   * Clamp value to range
   */
  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  /**
   * Linear interpolation
   */
  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  /**
   * Smooth hermite interpolation (smoothstep)
   */
  private smooth(value: number, min: number, max: number): number {
    if (value <= min) return 0;
    if (value >= max) return 1;
    const t = (value - min) / (max - min);
    return t * t * (3 - 2 * t);
  }

  // ============ Noise Functions ============

  /**
   * Perlin-like noise function (-1 to 1)
   * Simple implementation using sine waves
   */
  private noise(...coords: number[]): number {
    if (coords.length === 0) return 0;

    // Simple noise using sine waves (not true Perlin, but deterministic)
    let result = 0;
    const frequencies = [1, 2.3, 4.7, 8.1];
    const amplitudes = [1, 0.5, 0.25, 0.125];

    for (let i = 0; i < frequencies.length; i++) {
      let sum = 0;
      for (let j = 0; j < coords.length; j++) {
        sum += Math.sin(coords[j] * frequencies[i] * (j + 1) * 1.7 + j * 3.14159);
      }
      result += sum * amplitudes[i];
    }

    // Normalize to -1 to 1 range
    return Math.sin(result * 0.5);
  }

  /**
   * Deterministic random based on seed (0 to 1)
   */
  private random(seed: number): number {
    // Simple hash function for deterministic randomness
    const x = Math.sin(seed * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  }

  // ============ String Utilities ============

  /**
   * Zero-pad a number to specified digits
   */
  private padzero(digits: number, value: number): string {
    return String(Math.floor(value)).padStart(digits, '0');
  }

  // ============ Dependency Extraction ============

  /**
   * Extract path dependencies from an expression
   */
  private extractDependencies(expression: string): string[] {
    const deps: string[] = [];
    const pattern = /\b(?:ch|chs|chv)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

    let match;
    while ((match = pattern.exec(expression)) !== null) {
      deps.push(match[1]);
    }

    return deps;
  }

  /**
   * Check if an expression references time variables
   */
  hasTimeReference(expression: string): boolean {
    return /\b(time|frame|fps)\b/.test(expression);
  }

  /**
   * Clear the compiled expression cache
   */
  clearCache(): void {
    this.compiledCache.clear();
  }
}

// Global singleton instance
export const expressionEngine = new ExpressionEngine();
