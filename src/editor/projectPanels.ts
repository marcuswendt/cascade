import type { PanelContext } from './dockview/types';
import { mediaUrl } from './components/typePresentation';
import { setStudioParameter } from './StudioParameterController';
import type { ProjectPanelApi, ProjectPanelMeta, ProjectPanelModule } from '@/studio/panel';
export type { ProjectPanelApi, ProjectPanelMeta, ProjectPanelModule, ProjectValueRenderer, ProjectValueRendererInstance, ProjectValueRendererProps } from '@/studio/panel';

export async function discoverProjectPanels(fetcher: typeof fetch = fetch): Promise<ProjectPanelMeta[]> {
  const response = await fetcher('/api/panels');
  if (!response.ok) throw new Error(`Cannot list project panels (${response.status})`);
  const body = await response.json() as { panels?: ProjectPanelMeta[] };
  return Array.isArray(body.panels) ? body.panels : [];
}

export async function loadProjectPanel(name: string): Promise<ProjectPanelModule> {
  const module = await import(/* @vite-ignore */ `/api/panels/${encodeURIComponent(name)}/compiled`);
  if (typeof module.mount !== 'function') {
    throw new Error(`Project panel "${name}" must export mount(element, api)`);
  }
  return module as ProjectPanelModule;
}

let execCapabilityPromise: Promise<string> | undefined;

async function execCapability(): Promise<string> {
  execCapabilityPromise ??= fetch('/api/exec/capability', { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) throw new Error('Cascade project execution capability is unavailable');
      return (await response.json() as { capability: string }).capability;
    })
    .catch((error) => {
      execCapabilityPromise = undefined;
      throw error;
    });
  return execCapabilityPromise;
}

async function runStage<T = unknown>(stage: string, args: Record<string, unknown>): Promise<T> {
  const request = (capability: string) => fetch('/api/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Cascade-Exec-Capability': capability },
      body: JSON.stringify({ stage, args }),
    });
  let response = await request(await execCapability());
  if (response.status === 403) {
    execCapabilityPromise = undefined;
    response = await request(await execCapability());
  }
  const body = await response.json();
  if (!response.ok || !body.ok) {
    throw new Error(`Stage "${stage}" failed: ${body.stderr || body.error || 'unknown error'}`);
  }
  const lastLine = String(body.stdout).trim().split('\n').pop() ?? '{}';
  return JSON.parse(lastLine) as T;
}

export function createProjectPanelApi(options: {
  context: () => PanelContext | null;
  close: () => void;
  sourceNodeId?: string | null;
  signal?: AbortSignal;
  runStage?: ProjectPanelApi['runStage'];
}): ProjectPanelApi {
  const node = (nodeId: string) => options.context()?.graph?.getNode(nodeId) ?? null;
  return {
    runStage: options.runStage ?? runStage,
    mediaUrl,
    getParam(nodeId, name) {
      return node(nodeId)?.parameters.find(parameter => parameter.name === name)?.value;
    },
    getRawParam<T = unknown>(nodeId: string, name: string): T | undefined {
      return node(nodeId)?.rawParameterValue(name) as T | undefined;
    },
    setParam(nodeId, name, value) {
      const target = node(nodeId);
      const parameter = target?.parameters.find(candidate => candidate.name === name);
      if (!target || !parameter) throw new Error(`Unknown parameter ${nodeId}.${name}`);
      // A stored value nobody will ever read is not a successful write. See
      // `Node.parameterWriteShadowedBy` for what this cost when it was silent.
      const shadowedBy = target.parameterWriteShadowedBy(name);
      if (shadowedBy) {
        throw new Error(
          `${nodeId}.${name} is driven by a ${shadowedBy}, so writing its value would have no effect. `
          + `Clear the ${shadowedBy} first.`,
        );
      }
      setStudioParameter(target, name, value, options.context()?.onRecordHistory);
    },
    getOutput<T = unknown>(nodeId: string, outputName: string): T | undefined {
      return node(nodeId)?.outputs.find(port => port.name === outputName)?.value as T | undefined;
    },
    getOutputs(nodeId) {
      const target = node(nodeId);
      if (!target) return Object.freeze({});
      return Object.freeze(Object.fromEntries(
        target.outputs.map(port => [port.name, port.value]),
      ));
    },
    async cook(cookOptions = {}) {
      const graph = options.context()?.graph;
      if (!graph) return;
      const entry = cookOptions.nodeId ? graph.getNode(cookOptions.nodeId) : undefined;
      if (cookOptions.nodeId && !entry) {
        throw new Error(`Unknown node ${cookOptions.nodeId}`);
      }
      await graph.scheduler.flush(entry ?? undefined);
    },
    selectedNodeId() {
      return options.context()?.selectedNode?.id ?? null;
    },
    sourceNodeId: options.sourceNodeId ?? null,
    signal: options.signal ?? new AbortController().signal,
    close: options.close,
  };
}
