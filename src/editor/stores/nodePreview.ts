import { readable } from 'svelte/store';
import type { SerializedDockview } from 'dockview';
import { loadProjectSettings } from '../projectSettingsApi';

let enabled = false;
let publish: (value: boolean) => void = () => {};
let loading: Promise<ProjectStudioPreferences> | null = null;

export interface ProjectStudioPreferences {
  nodePreviews: boolean;
  workspace: SerializedDockview | null;
}

export function projectStudioPreferences(settings: Record<string, unknown>): ProjectStudioPreferences {
  const candidate = settings.workspace;
  const projectWorkspace = candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate)
    ? candidate as SerializedDockview
    : null;
  return {
    nodePreviews: settings.nodePreviews === true,
    workspace: projectWorkspace,
  };
}

/**
 * Whether cooked node values should be shown directly on the graph.
 *
 * This is project policy rather than a user preference: a graph authored as a
 * compact computational network should not become a board just because one
 * person opened a different project before it. Missing or unavailable project
 * settings therefore mean false.
 */
export const nodePreviews = readable(false, (set) => {
  publish = set;
  set(enabled);
  return () => {
    publish = () => {};
  };
});

export function ensureProjectStudioPreferences(): Promise<ProjectStudioPreferences> {
  loading ??= loadProjectSettings()
    .then((state) => {
      const preferences = projectStudioPreferences(state.manifest.settings);
      enabled = preferences.nodePreviews;
      publish(enabled);
      return preferences;
    })
    .catch(() => {
      enabled = false;
      publish(false);
      return { nodePreviews: false, workspace: null };
    });
  return loading;
}

export async function ensureNodePreviewSetting(): Promise<void> {
  await ensureProjectStudioPreferences();
}
