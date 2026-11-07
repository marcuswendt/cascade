/**
 * Dead files and copied code, as ratchets. A source file nothing imports is
 * either an entry point (listed below, with what loads it) or dead. The
 * duplicated-lines ceiling only goes down: lower it to the new measurement
 * when a cleanup lands, never raise it.
 */
import { describe, expect, it } from 'vitest';
import { duplicatedLines, importGraph, unimportedFiles } from '../scripts/architecture.mjs';

/** Loaded by something other than an import: a build entry, an export-map
 *  entry or a bin. `main.ts` and `index.ts` files are entries by name. */
const ENTRY_POINTS = [
  'packages/contracts/src/schema.ts', // cascade/contracts/schema
  'packages/kit/src/cli.ts', // cascade-kit bin
  'packages/kit/src/video.ts', // @field/cascade-kit/video
  'server/src/cli.ts', // server dev entry (npm --prefix server run dev)
  'server/src/runtime/gpu.ts', // cascade/gpu
  'server/src/runtime/net.ts', // cascade/net
  'server/src/runtime/shell.ts', // cascade/shell
  'src/player/editor.ts', // player build entry (scripts/build-cli.mjs)
  'src/player/embed.ts', // cascade/player
];

/** Lines in a repeated 10-line window across src, packages and server/src.
 *  2,360 on 2026-11-06 before the formatter and dead components went. */
const DUPLICATED_LINES_CEILING = 1487;

describe('architecture: dead code', () => {
  it('has no source file that nothing imports', () => {
    const dead = unimportedFiles(importGraph()).filter((file) => !ENTRY_POINTS.includes(file));
    expect(dead, 'nothing imports these: delete them, or list a real entry point with what loads it').toEqual([]);
  });

  it('lists only entry points that exist and are still unimported', () => {
    const unimported = new Set(unimportedFiles(importGraph()));
    expect(ENTRY_POINTS.filter((file) => !unimported.has(file))).toEqual([]);
  });

  it(`keeps duplicated lines at or under ${DUPLICATED_LINES_CEILING}`, () => {
    const { total, byFile } = duplicatedLines();
    const worst = Object.entries(byFile as Record<string, number>).sort((a, b) => b[1] - a[1]).slice(0, 8);
    expect(total, `duplicated lines rose; the most copied files: ${JSON.stringify(worst)}`).toBeLessThanOrEqual(DUPLICATED_LINES_CEILING);
  });
});
