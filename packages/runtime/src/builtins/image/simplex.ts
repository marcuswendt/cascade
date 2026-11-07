/**
 * 2D simplex noise: `createNoise2D` and `buildPermutationTable` from
 * simplex-noise 4.0.3 by Jonas Wagner (MIT), copied rather than depended on.
 *
 * The class `Noise` node loaded simplex-noise@latest from esm.sh at cook time,
 * so it needed a network and could not run headless. The runtime depends on
 * contracts alone, so the two functions it used live here, unchanged, and a
 * seeded noise image is the same pixels it always was.
 *
 * Copyright (c) 2024 Jonas Wagner. Permission is hereby granted, free of
 * charge, to any person obtaining a copy of this software and associated
 * documentation files (the "Software"), to deal in the Software without
 * restriction, including without limitation the rights to use, copy, modify,
 * merge, publish, distribute, sublicense, and/or sell copies of the Software,
 * and to permit persons to whom the Software is furnished to do so, subject to
 * the following conditions: The above copyright notice and this permission
 * notice shall be included in all copies or substantial portions of the
 * Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
 */

const SQRT3 = Math.sqrt(3.0);
const F2 = 0.5 * (SQRT3 - 1.0);
const G2 = (3.0 - SQRT3) / 6.0;

const fastFloor = (x: number) => Math.floor(x) | 0;

const grad2 = new Float64Array([1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 1, 0, -1, 0, 0, 1, 0, -1, 0, 1, 0, -1]);

export type NoiseFunction2D = (x: number, y: number) => number;

function buildPermutationTable(random: () => number): Uint8Array {
  const tableSize = 512;
  const p = new Uint8Array(tableSize);
  for (let i = 0; i < tableSize / 2; i++) p[i] = i;
  for (let i = 0; i < tableSize / 2 - 1; i++) {
    const r = i + ~~(random() * (256 - i));
    const aux = p[i]!;
    p[i] = p[r]!;
    p[r] = aux;
  }
  for (let i = 256; i < tableSize; i++) p[i] = p[i - 256]!;
  return p;
}

export function createNoise2D(random: () => number): NoiseFunction2D {
  const perm = buildPermutationTable(random);
  const permGrad2x = new Float64Array(perm).map((v) => grad2[(v % 12) * 2]!);
  const permGrad2y = new Float64Array(perm).map((v) => grad2[(v % 12) * 2 + 1]!);
  return function noise2D(x: number, y: number): number {
    let n0 = 0;
    let n1 = 0;
    let n2 = 0;
    const s = (x + y) * F2;
    const i = fastFloor(x + s);
    const j = fastFloor(y + s);
    const t = (i + j) * G2;
    const X0 = i - t;
    const Y0 = j - t;
    const x0 = x - X0;
    const y0 = y - Y0;
    let i1: number, j1: number;
    if (x0 > y0) {
      i1 = 1;
      j1 = 0;
    } else {
      i1 = 0;
      j1 = 1;
    }
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1.0 + 2.0 * G2;
    const y2 = y0 - 1.0 + 2.0 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      const gi0 = ii + perm[jj]!;
      t0 *= t0;
      n0 = t0 * t0 * (permGrad2x[gi0]! * x0 + permGrad2y[gi0]! * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      const gi1 = ii + i1 + perm[jj + j1]!;
      t1 *= t1;
      n1 = t1 * t1 * (permGrad2x[gi1]! * x1 + permGrad2y[gi1]! * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      const gi2 = ii + 1 + perm[jj + 1]!;
      t2 *= t2;
      n2 = t2 * t2 * (permGrad2x[gi2]! * x2 + permGrad2y[gi2]! * y2);
    }
    return 70.0 * (n0 + n1 + n2);
  };
}
