import type {
  NodeDefinition,
  NodeExecutionContext,
  ProgressReporter,
} from '../../../packages/contracts/src/index.js';
import type {
  DefinitionNodeRegistration,
  RuntimeCapabilities,
} from '../../../packages/runtime/src/types.js';
import type { DataType, ParamOptions } from '../../types/node.types.js';
import { packagePathToType, registerNodeClasses, registerNodeMetadata, type NodeClass, type NodeFunction } from '../../utils/nodeTypeUtils.js';
import type { Graph } from '../Graph.js';
import { Node } from '../Node.js';
import type { StudioGpuHost } from './gpuCapability';

const silentProgress: ProgressReporter = { report: () => {} };

function parameterOptions(definition: {
  readonly label?: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly options?: readonly unknown[];
  readonly expression?: string;
}): ParamOptions {
  return {
    ...(definition.label ? { label: definition.label } : {}),
    ...(definition.expression ? { defaultExpression: definition.expression } : {}),
    ...(definition.min === undefined ? {} : { min: definition.min }),
    ...(definition.max === undefined ? {} : { max: definition.max }),
    ...(definition.step === undefined ? {} : { step: definition.step }),
    ...(definition.options ? {
      choices: definition.options.map(value => ({ value, label: String(value) })),
    } : {}),
    promotable: false,
  };
}

/**
 * Build a node's ports, parameters and triggers from a definition literal, and
 * return the cook that runs its `execute` with a real NodeExecutionContext.
 *
 * Separated from `configureNode` so a caller that does not own the node's
 * function can still use the whole adapter. A library definition is known
 * synchronously, so `configureNode` sets the function itself; a PROJECT module
 * is compiled on demand and hot-reloaded, so its definition only arrives after
 * a fetch — the node already has a function by then, and that function is the
 * one that awaits this. One adapter, two arrival times.
 */
/**
 * Is this installed `gpu` the Studio host, rather than a bare capability?
 *
 * The host carries `ensure` and `forNode`, which a node must never see: the
 * device is created asynchronously and a node is handed a resolved one, so the
 * cook has to await readiness first. A test or another host may install a
 * plain `GpuCapability`, and that still works — it simply has nothing to
 * prepare and no per-node scoping to do.
 */
function asGpuHost(value: unknown): StudioGpuHost | null {
  return value
    && typeof (value as StudioGpuHost).ensure === 'function'
    && typeof (value as StudioGpuHost).forNode === 'function'
    ? value as StudioGpuHost
    : null;
}

export function attachDefinition(
  node: Node,
  registration: DefinitionNodeRegistration,
  capabilities: RuntimeCapabilities,
): NodeFunction {
  const definition = registration.definition;
  const pendingTriggers = new Map<string, unknown>();
  let triggerSequence = 0;

  for (const [name, input] of Object.entries(definition.inputs ?? {})) {
    if (input.kind === 'trigger') {
      const port = node.in(name, undefined, {
        type: 'any',
        ...(input.description ? { description: input.description } : {}),
      });
      port.portType = 'trigger';
      port.onTrigger = async (payload?: unknown) => {
        const sequence = triggerSequence++;
        pendingTriggers.set(name, {
          id: `${node.id}:${sequence}`,
          runId: `studio:${node.id}:${sequence}`,
          sequence,
          ...(payload === undefined ? {} : { payload }),
          source: { kind: 'external' },
        });
        node.markDirty();
        await node.execute();
      };
      continue;
    }
    if (input.variadic) {
      node.setVariadic(undefined, { type: input.type as DataType });
      continue;
    }
    node.in(name, input.default, {
      type: input.type as DataType,
      ...(input.min === undefined ? {} : { min: input.min }),
      ...(input.max === undefined ? {} : { max: input.max }),
      ...(input.step === undefined ? {} : { step: input.step }),
      ...(input.options ? {
        choices: input.options.map(value => ({ value, label: String(value) })),
      } : {}),
      ...(input.description ? { description: input.description } : {}),
    });
  }

  for (const [name, output] of Object.entries(definition.outputs ?? {})) {
    node.out(
      name,
      output.kind === 'trigger' ? 'trigger' : 'param',
      output.kind === 'data'
        ? { type: output.type as DataType, description: output.description }
        : { description: output.description },
    );
  }

  for (const [name, prop] of Object.entries(definition.props ?? {})) {
    const parameter = node.param(name, prop.default, {
      type: prop.type as DataType,
      ...parameterOptions(prop),
    });
    parameter.documentField = 'props';
  }

  const hasTriggerInputs = Object.values(definition.inputs ?? {})
    .some(input => input.kind === 'trigger');
  let executePromise: ReturnType<DefinitionNodeRegistration['loadExecute']> | undefined;
  return async () => {
    // Runtime trigger branches are dormant until an event reaches them. Studio
    // must not turn loading or an ordinary cook into an implicit trigger.
    if (hasTriggerInputs && pendingTriggers.size === 0) return;
    for (const name of definition.capabilities ?? []) {
      if (!capabilities[name]) {
        throw new Error(`${registration.moduleId} requires the Studio ${name} capability`);
      }
    }
    const execute = await (executePromise ??= registration.loadExecute('browser'));
    const inputValues: Record<string, unknown> = {};
    for (const [name, input] of Object.entries(definition.inputs ?? {})) {
      inputValues[name] = input.kind === 'trigger'
        ? pendingTriggers.get(name)
        : input.variadic
          ? node.getVariadicInputs().map(port => port.value ?? undefined)
          : node.inputs.find(port => port.name === name)?.value;
    }
    pendingTriggers.clear();

    const outputs = Object.fromEntries(Object.entries(definition.outputs ?? {}).map(([name, output]) => {
      const port = node.outputs.find(candidate => candidate.name === name);
      if (!port) throw new Error(`Missing output ${registration.moduleId}.${name}`);
      return [name, output.kind === 'trigger'
        ? { trigger: (payload?: unknown) => port.trigger(payload) }
        : { set: (value: unknown) => port.setValue(value) }];
    }));

    // A GPU node gets a device that is already up, and its own cache scope.
    // Both halves matter: `requestAdapter` is async while `context.capabilities
    // .gpu.device` is not, and a cache keyed per node is what replaces the
    // module-level Map that gave every node its own device.
    let nodeCapabilities = capabilities;
    const gpuHost = ((definition.capabilities ?? []) as readonly string[]).includes('gpu')
      ? asGpuHost(capabilities.gpu)
      : null;
    if (gpuHost) {
      await gpuHost.ensure();
      nodeCapabilities = { ...capabilities, gpu: gpuHost.forNode(node.id) };
    }

    const context = {
      nodeId: node.id,
      inputs: inputValues,
      outputs,
      props: Object.fromEntries(node.parameters.map(parameter => [parameter.name, parameter.value])),
      capabilities: nodeCapabilities,
      signal: new AbortController().signal,
      progress: silentProgress,
    } as unknown as NodeExecutionContext<NodeDefinition>;
    await execute(context);
  };
}

function configureNode(
  node: Node,
  registration: DefinitionNodeRegistration,
  capabilities: RuntimeCapabilities,
): void {
  node.setFunction(attachDefinition(node, registration, capabilities));
}

/** Register a definition-v1 module with the compatibility graph through one adapter. */
export function registerDefinitionNodes(
  registrations: readonly DefinitionNodeRegistration[],
  capabilities: RuntimeCapabilities = {},
): void {
  const libraries = new Map<string, Record<string, NodeClass>>();
  for (const registration of registrations) {
    const parts = registration.moduleId.split('.');
    if (parts.length !== 3 || parts[0] !== 'cascade') {
      throw new Error(`Studio built-ins require cascade.<library>.<node>: ${registration.moduleId}`);
    }
    const libraryId = parts[1];
    const nodeType = packagePathToType(registration.moduleId);
    const classes = libraries.get(libraryId) ?? {};
    classes[nodeType] = class extends Node {
      constructor(id: string, graph: Graph) {
        super(id, nodeType, graph);
      }

      protected setup(): void {
        configureNode(this, registration, capabilities);
      }
    };
    libraries.set(libraryId, classes);
    registerNodeMetadata({
      type: registration.moduleId,
      name: registration.definition.label ?? nodeType,
      icon: registration.definition.icon,
      description: registration.definition.description,
      category: libraryId,
    });
  }
  for (const [libraryId, classes] of libraries) registerNodeClasses(libraryId, classes);
}
