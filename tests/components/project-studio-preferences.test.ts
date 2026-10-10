import { describe, expect, it } from 'vitest';
import { projectStudioPreferences } from '@/editor/stores/nodePreview';

describe('project Studio preferences', () => {
  it('keeps node previews opt-in and accepts a serialized workspace suggestion', () => {
    const workspace = { grid: { width: 1000 }, panels: {} };
    expect(projectStudioPreferences({ nodePreviews: true, workspace })).toEqual({
      nodePreviews: true,
      workspace,
    });
  });

  it('fails closed for absent or malformed settings', () => {
    expect(projectStudioPreferences({})).toEqual({ nodePreviews: false, workspace: null });
    expect(projectStudioPreferences({ nodePreviews: 'yes', workspace: 'wide' })).toEqual({
      nodePreviews: false,
      workspace: null,
    });
  });
});
