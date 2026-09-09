/**
 * What a geometry actually is, for a hover.
 *
 * Marcus, 2026-09-09: *"when the output of a node is geometry, i need a way to
 * see what exactly that is - add this to the mouseover mode."*
 *
 * The counts are the obvious half and the **attributes are the useful half.**
 * Every failure in a day of building the particle set was an attribute that
 * was absent or the wrong size — a solver refusing a geometry with no `id`, a
 * trail with no colour to promote, a `Cd` that was three components — and none
 * of them was visible without cooking.
 */
import { describe, expect, it } from 'vitest';

import { geometryFacts } from '@/editor/components/typePresentation';

function geometry(over: Record<string, unknown> = {}) {
  return {
    kind: 'geometry',
    pointCount: 2500, vertexCount: 2500, primitiveCount: 357,
    point: { P: {}, v: {}, age: {}, life: {}, id: {}, Cd: {} },
    vertex: {},
    primitive: { id: {}, Cd: {} },
    detail: { nextid: 4100 },
    pointGroups: {}, primitiveGroups: {},
    ...over,
  };
}

describe('geometryFacts', () => {
  it('names the counts and every attribute, by level', () => {
    const facts = geometryFacts(geometry());
    expect(facts[0]).toBe('2,500 points · 357 prims');
    expect(facts).toContain('point: P v age life id Cd');
    expect(facts).toContain('prim: id Cd');
  });

  /** Declaration order, not sorted: the order a node writes its attributes in
   *  is information — `P` first is the position, and what follows is what that
   *  node added. */
  it('keeps declaration order rather than sorting', () => {
    const facts = geometryFacts(geometry({ point: { P: {}, zeta: {}, alpha: {} } }));
    expect(facts).toContain('point: P zeta alpha');
  });

  /** Vertices only when they differ from points: for a point cloud they are
   *  the same number and saying it twice is noise. */
  it('omits a vertex count that equals the point count', () => {
    expect(geometryFacts(geometry())[0]).not.toContain('verts');
    expect(geometryFacts(geometry({ vertexCount: 714 }))[0]).toContain('714 verts');
  });

  /** `nextid` at a glance is what tells you a particle system has been stepped
   *  rather than merely built. */
  it('shows detail values, because they are short enough to show', () => {
    expect(geometryFacts(geometry())).toContain('detail: nextid=4100');
  });

  it('names groups', () => {
    const facts = geometryFacts(geometry({ pointGroups: { born: {} }, primitiveGroups: { long: {} } }));
    expect(facts).toContain('groups: @born @long');
  });

  it('says nothing for a value that is not geometry', () => {
    expect(geometryFacts(null)).toEqual([]);
    expect(geometryFacts(42)).toEqual([]);
    expect(geometryFacts({ kind: 'image', path: 'a.png' })).toEqual([]);
    expect(geometryFacts('a string')).toEqual([]);
  });

  /** An empty geometry is a real state — a source before its first birth — and
   *  it should read as empty rather than as broken. */
  it('handles an empty geometry without inventing counts', () => {
    const facts = geometryFacts(geometry({
      pointCount: 0, vertexCount: 0, primitiveCount: 0,
      point: {}, primitive: {}, detail: {},
    }));
    expect(facts).toEqual([]);
  });
});
