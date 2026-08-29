/**
 * Node Code Compilation Utilities
 * Extracted from CodeEditor.svelte for testability
 */

import ts from 'typescript';
import type { Node } from '@/nodes/Node';
import type { Graph } from '@/nodes/Graph';

export type NodeFunction = (node: Node, graph: Graph) => Promise<void>;

export interface CompileResult {
  /** The transpiled JavaScript code */
  jsCode: string;
  /** The compiled async function, or null if compilation failed */
  fn: NodeFunction | null;
  /** Error message if compilation failed */
  error: string | null;
}

/**
 * Transpile TypeScript code to JavaScript
 * Strips type annotations, generics, interfaces, etc.
 */
export function transpileTypeScript(code: string): string {
  const result = ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      removeComments: false,
      noEmitHelpers: true,
      allowJs: true,
    }
  });
  return result.outputText;
}

/**
 * Compile node code into an executable function
 *
 * @param sourceCode - TypeScript or JavaScript source code
 * @returns CompileResult with transpiled code and function, or error
 */
export function compileNodeCode(sourceCode: string): CompileResult {
  try {
    // Transpile TypeScript to JavaScript
    const jsCode = transpileTypeScript(sourceCode);

    // Wrap in async function that receives node and graph
    const wrappedCode = `return (async function(node, graph) {\n${jsCode}\n})(node, graph);`;

    // Create the function
    const fn = new Function('node', 'graph', wrappedCode) as NodeFunction;

    return {
      jsCode,
      fn,
      error: null,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      jsCode: '',
      fn: null,
      error: message,
    };
  }
}

/**
 * Execute compiled code on a node, handling state preservation and port cleanup
 *
 * @param node - The node to execute code on
 * @param graph - The graph context
 * @param fn - The compiled node function
 * @param sourceCode - Original source code to store on node
 */
export async function executeNodeCode(
  node: Node,
  graph: Graph,
  fn: NodeFunction,
  sourceCode: string
): Promise<{ success: boolean; error: string | null }> {
  try {
    // Preserve current state
    const oldState = node.preserveState();

    // Clean up old lifecycle
    if (node.onDestroy) {
      try {
        node.onDestroy();
      } catch (err) {
        console.warn('Error in node.onDestroy:', err);
      }
    }

    // Reset port tracking for this execution
    node.resetPortTracking();

    // Store source code and set function
    node.code = sourceCode;
    node.setFunction(fn);

    // Temporarily disable bypass to ensure code runs
    const wasBypassed = node.bypass;
    if (wasBypassed) {
      node.setBypass(false);
    }

    // Force execution
    node.markDirty();
    await graph.execute(node);

    // Restore bypass state
    if (wasBypassed) {
      node.setBypass(true);
    }

    // Clean up ports that weren't registered during execution
    node.cleanupUnusedPorts();

    // Restore previous state (prop values, etc.)
    node.restoreState(oldState);

    // Call onReady hook
    if (node.onReady) {
      try {
        node.onReady();
      } catch (err) {
        console.warn('Error in node.onReady:', err);
      }
    }

    return { success: true, error: null };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    node.error = error instanceof Error ? error : new Error(message);
    return { success: false, error: message };
  }
}

/**
 * Full compile-and-execute pipeline
 * Compiles source code and executes it on the node
 */
export async function compileAndExecute(
  node: Node,
  graph: Graph,
  sourceCode: string
): Promise<{ success: boolean; error: string | null }> {
  const compiled = compileNodeCode(sourceCode);

  if (compiled.error || !compiled.fn) {
    return { success: false, error: compiled.error || 'Compilation failed' };
  }

  return executeNodeCode(node, graph, compiled.fn, sourceCode);
}
