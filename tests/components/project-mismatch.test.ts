import { describe, expect, it } from 'vitest';
import {
  missingProjectModules,
  projectModulesOf,
} from '@/editor/projectMismatch';

const document = {
  nodes: [
    { id: 'a', module: 'project.curvature-field' },
    { id: 'b', module: 'project.stream-trace' },
    { id: 'c', module: 'cascade.geo.Merge' },
    { id: 'd', module: 'project.curvature-field' },
    { id: 'e', type: 'project.legacy-typed' },
  ],
};

describe('projectModulesOf', () => {
  it('collects project modules once each and ignores built-ins', () => {
    expect(projectModulesOf(document)).toEqual([
      'project.curvature-field',
      'project.stream-trace',
      'project.legacy-typed',
    ]);
  });

  it('reads the legacy type field as well as module, since old documents use it', () => {
    expect(projectModulesOf({ nodes: [{ id: 'a', type: 'project.old' }] })).toEqual(['project.old']);
  });

  it('is empty for a document with no nodes, rather than throwing', () => {
    expect(projectModulesOf({})).toEqual([]);
    expect(projectModulesOf(null)).toEqual([]);
  });
});

describe('missingProjectModules', () => {
  it('names what the server cannot compile', () => {
    // The server's list carries folder names, without the prefix.
    expect(missingProjectModules(document, ['stream-trace'])).toEqual([
      'project.curvature-field',
      'project.legacy-typed',
    ]);
  });

  it('is empty when the server has everything, which is the normal case', () => {
    const available = ['curvature-field', 'stream-trace', 'legacy-typed'];
    expect(missingProjectModules(document, available)).toEqual([]);
  });

  it('reports every project node when the server has none of them', () => {
    // Opening cascade-logo's graph in cloud-posters' Studio.
    expect(missingProjectModules(document, ['marker-body', 'destroy-erode'])).toHaveLength(3);
  });

  it('does not report a graph that uses no project nodes at all', () => {
    expect(missingProjectModules({ nodes: [{ id: 'a', module: 'cascade.geo.Circle' }] }, [])).toEqual([]);
  });
});
