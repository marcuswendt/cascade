/**
 * The one place that decides how a compiled node module supplies `execute`.
 *
 * Studio has always wired a project or embedded module the same way — hand the
 * compiled `execute` Studio's own `(node, graph)` — which is correct for a
 * legacy dynamic module and wrong for a definition-v1 one. A v1 `execute`
 * expects a `NodeExecutionContext`, so it got Studio's `Node`, whose `outputs`
 * is an ARRAY, and the first `context.outputs.<name>.set(...)` threw
 * "Cannot read properties of undefined (reading 'set')" with nothing in the log.
 * That was the node `cascade node <Name>` scaffolds, so the generator's own
 * output was the one shape Studio could not cook.
 *
 * This dispatches on what the module actually exports, and routes a v1 module
 * through `attachDefinition` — the SAME adapter the built-in libraries use.
 * There is deliberately no second implementation of definition-to-Studio
 * mapping: ports, variadics, triggers, props and the context are built once,
 * in DefinitionNode.ts, for every host.
 *
 * Why the dispatch is lazy rather than a registry entry: a project module is
 * compiled on demand and hot-reloaded (see invalidateProjectModule), so its
 * definition is only knowable after a fetch, and a class registered at startup
 * would go stale on the next file save. Ports therefore appear when the module
 * resolves, which is the same moment a dynamic module's ports appear today.
 */
import { validateNodeDefinition } from '../../../packages/contracts/src/index.js';
import type { NodeDefinition, NodeExecute } from '../../../packages/contracts/src/index.js';
import type { DefinitionNodeRegistration, RuntimeCapabilities } from '../../../packages/runtime/src/types.js';
import type { LoadedModule } from '../../engine/nodeModuleLoader.js';
import type { NodeFunction } from '../../utils/nodeTypeUtils.js';
import type { Graph } from '../Graph.js';
import type { Node } from '../Node.js';
import { attachDefinition } from './DefinitionNode.js';
import { browserAssetCapability } from './browserCapabilities.js';
import { browserShellCapability, shellRouteAvailable } from './browserShellCapability.js';
import { createStudioGpuCapability, type StudioGpuHost } from './gpuCapability.js';

/**
 * What a project module may reach for when Studio is the host.
 *
 * The same set the geo library is registered with. A definition naming a
 * capability that is not in here fails with the adapter's own
 * "requires the Studio <name> capability" message rather than a stray
 * undefined, which is the point of declaring them.
 */
export const studioCapabilities: RuntimeCapabilities = {
  assets: browserAssetCapability,
  // Installed only where the browser has WebGPU, and absent rather than
  // stubbed otherwise. That is what makes the failure a sentence: the preflight
  // reports `runtime/missing-capability` and the adapter throws "requires the
  // Studio gpu capability", both naming what is missing. A stub that threw on
  // first use would name nothing.
  ...gpuCapabilityIfAvailable(),
  /**
   * Shell is present up front and withdrawn if the route turns out not to be
   * there, which is the opposite way round from gpu and worth the sentence.
   *
   * `navigator.gpu` is a synchronous check, so gpu can be absent from the map
   * before anything reads it. Whether the shell route exists takes a fetch, and
   * this object is a module-level const read by three default parameters — so
   * the choice is between delaying Studio's boot on a request, racing the
   * probe, or installing and withdrawing. Installing is the one where the
   * common case (a loopback server, where the route is always there) has no
   * race at all and no cost.
   *
   * What it costs: on a server that does NOT offer the route, a cook in the
   * first few milliseconds after boot sees the capability present and fails at
   * the fetch instead of at the gate. That failure still names itself — *"the
   * shell capability is disabled on this server"* — so it is a worse-shaped
   * error rather than a silent one, and once the probe lands the preflight is
   * correct from then on.
   */
  shell: browserShellCapability,
};

// Withdrawn rather than never added: see the note on `shell` above.
void shellRouteAvailable().then((available) => {
  if (!available) delete (studioCapabilities as { shell?: unknown }).shell;
});

function gpuCapabilityIfAvailable(): { gpu?: StudioGpuHost } {
  const gpu = createStudioGpuCapability();
  return gpu ? { gpu } : {};
}

/**
 * Whether an export is a definition-v1 literal, by its own declaration.
 *
 * `apiVersion: 1` is the test and the only test. A module exporting something
 * else called `definition` is not a v1 node and must keep its legacy wiring —
 * guessing from the presence of `inputs` or `outputs` would silently re-route a
 * dynamic node that happens to describe itself in a const.
 */
export function declaresDefinitionV1(value: unknown): boolean {
  return typeof value === 'object'
    && value !== null
    && (value as { apiVersion?: unknown }).apiVersion === 1;
}

/**
 * The reason a v1 definition cannot be adapted, or null when it can.
 *
 * Validation failures are reported, never worked around. A definition that
 * declares `apiVersion: 1` and is malformed used to fall through to the legacy
 * path and throw somewhere unrelated; the diagnostics say what is wrong.
 */
export function definitionAdapterError(value: unknown): string | null {
  const diagnostics = validateNodeDefinition(value);
  if (!diagnostics.length) return null;
  return diagnostics.map((item) => `${item.code}: ${item.message}`).join('\n');
}

/**
 * The capabilities a definition declares that this host cannot supply.
 *
 * This is the real "Studio cannot cook this node" condition, and the reason the
 * Definition panel's warning was rewritten around it. The adapter throws
 * "requires the Studio <name> capability" at cook time; naming it in the panel
 * turns that into something readable before the cook rather than after.
 */
export function missingStudioCapabilities(
  definition: unknown,
  capabilities: RuntimeCapabilities = studioCapabilities,
): string[] {
  const declared = (definition as { capabilities?: unknown })?.capabilities;
  if (!Array.isArray(declared)) return [];
  return declared
    .filter((name): name is string => typeof name === 'string')
    .filter((name) => !(capabilities as Record<string, unknown>)[name]);
}

/**
 * The node function for a module that is still compiling.
 *
 * Returned synchronously so the caller can wire the node immediately, exactly
 * as the old `modulePromise.then((m) => m.execute(n, g))` wrapper did. The
 * dispatch runs once, on the first resolution, and the chosen function is what
 * every later cook calls.
 */
export function moduleNodeFunction(
  node: Node,
  moduleId: string,
  modulePromise: Promise<LoadedModule>,
  capabilities: RuntimeCapabilities = studioCapabilities,
): NodeFunction {
  // Started eagerly, not on the first cook: a v1 module's ports come from its
  // definition, and the graph restores connections shortly after wiring. The
  // earlier the ports exist, the fewer of them have to be reconciled later.
  const prepared = modulePromise.then((module) => adaptModule(node, moduleId, module, capabilities));
  // The caller keeps its own .catch on modulePromise for the compile failure;
  // this one only stops an unhandled rejection from the adapt step.
  prepared.catch(() => {});
  return (n: Node, g: Graph) => prepared.then((fn) => fn(n, g));
}

/** The dispatch itself, exported for the direct callers that already hold a resolved module. */
export function adaptModule(
  node: Node,
  moduleId: string,
  module: LoadedModule,
  capabilities: RuntimeCapabilities = studioCapabilities,
): NodeFunction {
  if (!declaresDefinitionV1(module.definition)) {
    return (n: Node, g: Graph) => module.execute(n, g) as void | Promise<void>;
  }
  const invalid = definitionAdapterError(module.definition);
  if (invalid) throw new Error(`${moduleId} exports an invalid definition-v1 literal:\n${invalid}`);
  const registration: DefinitionNodeRegistration = {
    kind: 'definition-v1',
    moduleId,
    definition: module.definition as NodeDefinition,
    loadExecute: async () => module.execute as unknown as NodeExecute<NodeDefinition>,
  };
  return attachDefinition(node, registration, capabilities);
}
