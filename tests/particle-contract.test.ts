/**
 * The attribute contract a particle system reads and writes.
 *
 * Step 1 of `PLAN particles.md`, and first on purpose: **renaming an attribute
 * after three operators read it is the expensive change.** So this pins the
 * names, levels and storage before any operator exists — there is nothing to
 * simulate yet, and that is the point.
 *
 * Marcus's ruling that shaped it, 2026-09-09: trails are geometry rather than a
 * faded canvas. Which means there is no particle *type*: points carrying these
 * attributes are what a solver reads, and every geometry node already
 * understands them. A fifth name for one concept would be worse than the four
 * `PLAN geometry` is busy retiring.
 */
import { describe, expect, it } from 'vitest';

import {
  PARTICLE_ATTRIBUTES,
  checkParticleContract,
  isParticleGeometry,
  particleAttribute,
  requiredParticleAttributes,
} from '@cascade/contracts';
import type { Geometry } from '@cascade/contracts';

function geometry(over: {
  point?: Record<string, { storage: string; size: number; data: ArrayLike<number> } | { storage: 'string'; size: 1; table: string[]; data: Int32Array }>;
  detail?: Record<string, unknown>;
} = {}): Geometry {
  const count = 2;
  return {
    kind: 'geometry',
    pointCount: count,
    vertexCount: 0,
    primitiveCount: 0,
    topology: { primitives: [] },
    point: {
      P: { storage: 'f64', size: 2, data: new Float64Array(count * 2) },
      v: { storage: 'f32', size: 2, data: new Float32Array(count * 2) },
      age: { storage: 'f32', size: 1, data: new Float32Array(count) },
      life: { storage: 'f32', size: 1, data: new Float32Array(count) },
      id: { storage: 'i32', size: 1, data: new Int32Array(count) },
      ...(over.point ?? {}),
    },
    vertex: {},
    primitive: {},
    detail: { nextid: count, ...(over.detail ?? {}) },
    pointGroups: {},
    primitiveGroups: {},
  } as unknown as Geometry;
}

describe('the contract itself', () => {
  it('uses Houdini\'s names', () => {
    const names = PARTICLE_ATTRIBUTES.map(spec => spec.name);
    expect(names).toContain('P');
    expect(names).toContain('v');
    expect(names).toContain('age');
    expect(names).toContain('life');
    expect(names).toContain('id');
    expect(names).toContain('nextid');
  });

  /** `age` in seconds is the one deliberate departure from the sketch this is
   *  modelled on, which counts frames. A frame count changes meaning with fps,
   *  and particles that die at a different point at 60 are not deterministic. */
  it('measures age and life in seconds rather than frames', () => {
    expect(particleAttribute('age')!.units).toBe('seconds');
    expect(particleAttribute('life')!.units).toBe('seconds');
  });

  /** `f64` for position because the Python bridge is lossless there; `f32` for
   *  velocity because a velocity is not a coordinate. */
  it('stores position wider than velocity', () => {
    expect(particleAttribute('P')!.storage).toBe('f64');
    expect(particleAttribute('v')!.storage).toBe('f32');
  });

  /** `nextid` is detail and not point: it is the counter, not a per-particle
   *  value, and putting it at point level would give every particle its own. */
  it('keeps nextid at the detail level', () => {
    expect(particleAttribute('nextid')!.level).toBe('detail');
    expect(particleAttribute('id')!.level).toBe('point');
  });

  /** `pscale` and `N` are optional because they are not POP attributes at all —
   *  they exist so `CopyToPoints` can draw oriented marks without a new node. */
  it('requires the solver attributes and no more', () => {
    const required = requiredParticleAttributes().map(spec => spec.name).sort();
    expect(required).toEqual(['P', 'age', 'id', 'life', 'nextid', 'v']);
    expect(particleAttribute('pscale')!.required).toBe(false);
    expect(particleAttribute('Cd')!.required).toBe(false);
  });
});

describe('checking a geometry against it', () => {
  it('passes a geometry carrying everything required', () => {
    expect(checkParticleContract(geometry())).toEqual([]);
    expect(isParticleGeometry(geometry())).toBe(true);
  });

  it('accepts 3D positions and velocities as well as 2D', () => {
    expect(checkParticleContract(geometry({
      point: {
        P: { storage: 'f64', size: 3, data: new Float64Array(6) },
        v: { storage: 'f32', size: 3, data: new Float32Array(6) },
      },
    }))).toEqual([]);
  });

  /**
   * Every violation, not the first. The answer a caller wants is *what is
   * wrong with this geometry*, and a source node missing three attributes
   * should say so once rather than three cooks running.
   */
  it('reports every missing attribute at once', () => {
    const bare = {
      kind: 'geometry', pointCount: 1, vertexCount: 0, primitiveCount: 0,
      topology: { primitives: [] },
      point: { P: { storage: 'f64', size: 2, data: new Float64Array(2) } },
      vertex: {}, primitive: {}, detail: {}, pointGroups: {}, primitiveGroups: {},
    } as unknown as Geometry;

    const names = checkParticleContract(bare).map(v => v.attribute).sort();
    expect(names).toEqual(['age', 'id', 'life', 'nextid', 'v']);
  });

  it('carries the reason, so the message is the note rather than a code', () => {
    const bare = { ...geometry() } as any;
    bare.point = { ...bare.point };
    delete bare.point.id;
    const [violation] = checkParticleContract(bare);
    expect(violation!.attribute).toBe('id');
    expect(violation!.reason).toMatch(/reorders on every kill/);
  });

  /** A string where a number belongs is the failure that would otherwise reach
   *  arithmetic and produce NaN with nothing said. */
  it('refuses a string attribute where a solver reads a number', () => {
    const violations = checkParticleContract(geometry({
      point: { id: { storage: 'string', size: 1, table: ['a'], data: new Int32Array([0]) } },
    }));
    expect(violations).toHaveLength(1);
    expect(violations[0]!.reason).toMatch(/is a string attribute/);
  });

  it('refuses a wrong component count and says what it expected', () => {
    const violations = checkParticleContract(geometry({
      point: { life: { storage: 'f32', size: 3, data: new Float32Array(6) } },
    }));
    expect(violations[0]!.reason).toMatch(/has size 3; expected 1/);
  });

  it('refuses a Cd that is not four components', () => {
    const violations = checkParticleContract(geometry({
      point: { Cd: { storage: 'f32', size: 3, data: new Float32Array(6) } },
    }));
    expect(violations[0]!.attribute).toBe('Cd');
  });

  it('refuses a nextid that is not a number', () => {
    const violations = checkParticleContract(geometry({ detail: { nextid: 'seven' } }));
    expect(violations[0]!.reason).toMatch(/must be a number, not string/);
  });

  /** An optional attribute that is simply absent is not a violation — most
   *  particle systems never write `N`. */
  it('says nothing about an absent optional attribute', () => {
    expect(checkParticleContract(geometry())).toEqual([]);
  });
});
