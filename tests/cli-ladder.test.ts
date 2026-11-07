/**
 * Ladder, pick, lock: his selection loop is three to five options side by
 * side and a lock at the moment one is approved.
 *
 * What these pin: the contact sheet node lays images out the same way every
 * time and runs headless; a ladder writes one image per variant, a labelled
 * sheet and a record; a pick writes the lock from that record without cooking
 * again; and a replay of the lock, with no worktree, gives the pixels of the
 * variant image that was approved, even after the project's code moved on.
 */
import { afterEach, describe, expect, it, type TestContext } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { contactSheetLayout } from '../packages/runtime/src/builtins/image/index.js';
import { canvasAvailable } from '@/cli/headlessCanvas';
import { cookNode } from '@/cli/locks/cook';
import { createLadder, parseValues, pickVariant, readLadder, variantPlan, withVariant } from '@/cli/locks/ladder';
import { readLock, replayLock } from '@/cli/locks/lock';
import { MAX_CHOICE_OPTIONS, checkCardSize, choiceFence, choiceLabel, parsePickValue, pickValue, writeLadderCard } from '@/cli/locks/ladderCard';
import { runLockCommand } from '@/cli/locks/commands';
import { captureEnvelope } from '@/cli/jsonEnvelope';
import { handle, type McpContext } from '@/cli/mcp';
import type { JsonEnvelope } from '@/cli/jsonEnvelope';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

async function needsCanvas(context: TestContext): Promise<void> {
  if (!(await canvasAvailable())) context.skip();
}

/** A swatch whose pixels depend on a prop, the graph seed and a constant in a sibling module. */
const swatchSource = `
import { BLUE } from './blue';
export const definition = {
  apiVersion: 1,
  runsOn: 'portable',
  capabilities: ['assets'],
  inputs: {},
  outputs: { image: { kind: 'data', type: 'image' } },
  props: {
    level: { type: 'float', default: 0.5 },
    size: { type: 'int', default: 24 },
  }
} as const;
export async function execute(context) {
  const size = context.props.size;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgb(' + Math.round(context.props.level * 255) + ', ' + (context.seed % 256) + ', ' + BLUE + ')';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(2, 2, Math.max(1, Math.round(size * context.props.level)), 4);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const asset = await context.capabilities.assets.write(bytes, { suggestedName: 'swatch.png', mediaType: 'image/png' }, { signal: context.signal });
  context.outputs.image.set({ path: asset.path, size: [size, size], channels: 'rgba', depth: 'u8', space: 'srgb' });
}
`;

function project() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-ladder-')));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'nodes', 'Swatch'), { recursive: true });
  fs.writeFileSync(path.join(root, 'nodes', 'Swatch', 'index.ts'), swatchSource);
  fs.writeFileSync(path.join(root, 'nodes', 'Swatch', 'blue.ts'), 'export const BLUE = 80;\n');
  const document = {
    version: '0.2',
    nodes: [{ id: 'swatch', module: 'project.Swatch', props: { level: 0.5 } }],
    connections: [],
  };
  const file = path.join(root, 'piece.cascade');
  fs.writeFileSync(file, JSON.stringify(document, null, 2));
  return { root, file };
}

async function pixels(file: string): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

describe('cascade.image.ContactSheet', () => {
  it('lays out a grid as square as the count allows, fitting each image in its cell', () => {
    const layout = contactSheetLayout([[100, 50], [100, 100], [50, 100], [100, 100], [100, 100]], { gap: 10, labelHeight: 20 });
    expect(layout).toMatchObject({ columns: 3, rows: 2, cell: [100, 100], labelHeight: 20, width: 340, height: 270 });
    // At their own size, centred: the wide one vertically, the tall one across.
    expect(layout.cells[0]).toEqual({ x: 10, y: 35, width: 100, height: 50, labelX: 10, labelY: 110 });
    expect(layout.cells[2]).toEqual({ x: 255, y: 10, width: 50, height: 100, labelX: 230, labelY: 110 });
    expect(layout.cells[3]).toMatchObject({ x: 10, y: 140 });
    // A cell width scales every image to fit it.
    const scaled = contactSheetLayout([[100, 50], [50, 100]], { gap: 0, cellWidth: 200 });
    expect(scaled).toMatchObject({ cell: [200, 400], width: 400, height: 400 });
    expect(scaled.cells[0]).toMatchObject({ width: 200, height: 100, y: 150 });
    expect(scaled.cells[1]).toMatchObject({ width: 200, height: 400, x: 200 });
    expect(contactSheetLayout([[10, 10], [10, 10]], { columns: 5, gap: 0 })).toMatchObject({ columns: 2, width: 20, height: 10 });
    expect(() => contactSheetLayout([])).toThrow(/at least one image/);
  });

  it('runs headless: wired images and a list in, one labelled sheet out', async (context) => {
    await needsCanvas(context);
    const { root, file } = project();
    fs.mkdirSync(path.join(root, 'assets'));
    await sharp({ create: { width: 16, height: 16, channels: 4, background: '#ff0000' } }).png().toFile(path.join(root, 'assets', 'extra.png'));
    const document = {
      version: '0.2',
      nodes: [
        { id: 'a', module: 'project.Swatch', props: { level: 0.2 } },
        { id: 'b', module: 'project.Swatch', props: { level: 0.8, size: 48 } },
        {
          id: 'sheet', module: 'cascade.image.ContactSheet',
          inputs: { list: ['assets/extra.png'] },
          props: { columns: 3, gap: 4, cellWidth: 32, labels: 'a\nb\nextra', background: [0, 0, 0, 1] },
        },
      ],
      connections: [
        [['a', 0, 'image'], ['sheet', 0, 'input_0']],
        [['b', 0, 'image'], ['sheet', 0, 'input_1']],
      ],
    };
    const { outputs } = await cookNode(file, document, 'sheet');
    const image = outputs.get('image') as { path: string; size: [number, number] };
    // Three 32 px cells in one row, a 4 px gap round each, a label line of round(14 * 1.8).
    expect(image.size).toEqual([4 + 3 * 36, 4 + 32 + 25 + 4]);
    const sheet = await pixels(path.join(root, image.path));
    expect([sheet.width, sheet.height]).toEqual(image.size);
    // The gap is the background; the first cell is the first swatch, the last the listed file.
    expect([...sheet.data.subarray(0, 4)]).toEqual([0, 0, 0, 255]);
    expect(sheet.data[(24 * sheet.width + 20) * 4]).toBe(Math.round(0.2 * 255));
    expect([...sheet.data.subarray((20 * sheet.width + 4 + 2 * 36 + 16) * 4, (20 * sheet.width + 4 + 2 * 36 + 16) * 4 + 3)]).toEqual([255, 0, 0]);
  }, 60_000);
});

describe('a ladder', () => {
  it('plans variants by zipping value lists, broadcasting a single value, and checks targets', () => {
    const document = { nodes: [{ id: 'ink', props: { width: 1 } }] };
    expect(variantPlan(document, { 'ink.width': [1, 2, 3], 'ink.colour': ['red'] }).map((step) => step.set))
      .toEqual([{ 'ink.width': 1, 'ink.colour': 'red' }, { 'ink.width': 2, 'ink.colour': 'red' }, { 'ink.width': 3, 'ink.colour': 'red' }]);
    expect(variantPlan(document, {}, [4, 5]).map((step) => step.seed)).toEqual([4, 5]);
    expect(() => variantPlan(document, { 'ink.width': [1, 2], 'ink.height': [1, 2, 3] })).toThrow(/needs 3/);
    expect(() => variantPlan(document, { 'paper.width': [1, 2] })).toThrow(/no node "paper"/);
    expect(() => variantPlan(document, {})).toThrow(/--vary/);
    expect(withVariant(document, { 'ink.width': 2 }, 0)).toEqual({ nodes: [{ id: 'ink', props: { width: 2 } }] });
    expect(withVariant(document, {}, 7).seed).toBe(7);
    expect(document.nodes[0]!.props.width).toBe(1);
    expect(parseValues('0.25,0.5,1')).toEqual([0.25, 0.5, 1]);
    expect(parseValues('[1,2],[3,4]')).toEqual([[1, 2], [3, 4]]);
    expect(parseValues('soft,hard')).toEqual(['soft', 'hard']);
  });

  it('writes one image per variant, a labelled sheet and a record in ladders/', async (context) => {
    await needsCanvas(context);
    const { root, file } = project();
    const { ladder, file: written } = await createLadder({
      graph: file, node: 'swatch', name: 'Level dial', vary: { 'swatch.level': [0.1, 0.3, 0.5, 0.7, 0.9] },
    });
    expect(path.relative(root, written)).toBe(path.join('ladders', 'level-dial.json'));
    expect(ladder.variants.map((variant) => variant.image)).toEqual([1, 2, 3, 4, 5].map((n) => `ladders/level-dial/0${n}.png`));
    expect(ladder.variants[1]).toMatchObject({ index: 2, label: '2  swatch.level=0.3', set: { 'swatch.level': 0.3 }, params: { 'swatch.level': 0.3 } });
    expect(ladder.vary).toEqual({ 'swatch.level': [0.1, 0.3, 0.5, 0.7, 0.9] });
    expect(ladder.host.cooked).toBe('snapshot');
    expect(ladder.code.files).toBe(2);
    // Five 24 px swatches in one row, labelled.
    const sheet = await pixels(path.join(root, ladder.sheet.file));
    expect(ladder.sheet.columns).toBe(5);
    // A 16 px gap; the label line is round(16 * 1.8).
    expect([sheet.width, sheet.height]).toEqual([16 + 5 * (24 + 16), 16 + 24 + 29 + 16]);
    // Each variant is its own value, and the record is never rewritten.
    const reds = await Promise.all(ladder.variants.map(async (variant) => (await pixels(path.join(root, variant.image))).data[(10 * 24 + 10) * 4]));
    expect(reds).toEqual([0.1, 0.3, 0.5, 0.7, 0.9].map((level) => Math.round(level * 255)));
    await expect(createLadder({ graph: file, node: 'swatch', name: 'Level dial', vary: { 'swatch.level': [0.1, 0.2] } })).rejects.toThrow(/never rewritten/);
    // Its record is not code: a later lock does not store it.
    expect((await readLadder(root, 'level-dial')).ladder.id).toBe('level-dial');
  }, 60_000);

  it('varies the graph seed', async (context) => {
    await needsCanvas(context);
    const { root, file } = project();
    const { ladder } = await createLadder({ graph: file, node: 'swatch', name: 'seeds', seeds: [1, 2, 3], live: true });
    expect(ladder.variants.map((variant) => variant.seed)).toEqual([1, 2, 3]);
    expect(ladder.variants.map((variant) => variant.seeds.graph)).toEqual([1, 2, 3]);
    expect(ladder.variants[0]!.label).toBe('1  seed 1');
    const greens = await Promise.all(ladder.variants.map(async (variant) => (await pixels(path.join(root, variant.image))).data[(10 * 24 + 10) * 4 + 1]));
    expect(new Set(greens).size).toBe(3);
  }, 60_000);
});

describe('pick and replay', () => {
  it('locks the picked variant without cooking, and replays it to the same pixels after the code moved on', async (context) => {
    await needsCanvas(context);
    const { root, file } = project();
    await createLadder({ graph: file, node: 'swatch', name: 'dial', vary: { 'swatch.level': [0.2, 0.4, 0.6] }, seeds: [11, 12, 13] });

    const picked = await pickVariant(root, 'dial', 2, { note: 'the middle one' });
    expect(path.relative(root, picked.file)).toBe(path.join('locks', 'dial-2.json'));
    expect(picked.lock).toMatchObject({
      status: 'approved', note: 'the middle one',
      params: { 'swatch.level': 0.4 }, seeds: { graph: 12 },
      ladder: { id: 'dial', variant: 2, image: 'ladders/dial/02.png', sheet: 'ladders/dial/sheet.png' },
      graph: { file: 'piece.cascade', node: 'swatch' },
      host: { cooked: 'snapshot' },
    });
    expect(fs.existsSync(path.join(root, picked.lock.preview!.file))).toBe(true);
    expect((await readLadder(root, 'dial')).ladder.picks).toEqual([{ variant: 2, lock: 'dial-2', at: picked.lock.created }]);
    await expect(pickVariant(root, 'dial', 2)).rejects.toThrow(/never rewritten/);
    await expect(pickVariant(root, 'dial', 4)).rejects.toThrow(/no 4/);

    // The project moves on: the code and the graph file both change.
    fs.writeFileSync(path.join(root, 'nodes', 'Swatch', 'blue.ts'), 'export const BLUE = 200;\n');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"level": 0.5', '"level": 0.9'));

    const out = path.join(root, 'delivery');
    const replayed = await replayLock(root, (await readLock(root, 'dial-2')).lock, { out });
    expect(replayed.status).toBe('match');
    expect(replayed.codeSinceLock.changed).toEqual(['nodes/Swatch/blue.ts']);
    const approved = await pixels(path.join(root, 'ladders', 'dial', '02.png'));
    const reproduced = await pixels(replayed.files[0]!);
    expect(reproduced.data.equals(approved.data)).toBe(true);

    // And with today's code it is a different picture, said so.
    expect((await replayLock(root, picked.lock, { live: true })).status).toBe('mismatch');
  }, 90_000);

  it('refuses to lock a variant whose image changed after the ladder', async (context) => {
    await needsCanvas(context);
    const { root, file } = project();
    await createLadder({ graph: file, node: 'swatch', name: 'dial', vary: { 'swatch.level': [0.2, 0.4] }, live: true });
    await sharp({ create: { width: 24, height: 24, channels: 4, background: '#ff00ff' } }).png().toFile(path.join(root, 'ladders', 'dial', '01.png'));
    await expect(pickVariant(root, 'dial', 1)).rejects.toThrow(/no longer the image the ladder recorded/);
  }, 60_000);
});

describe('a ladder as a Cairn choice card (--cairn)', () => {
  /** The JSON inside a ```cairn:choice fence; throws when the fence is malformed. */
  function fenceJson(fence: string): { prompt: string; options: { label: string; value: string; image: string }[] } {
    const match = /^```cairn:choice\n(.+)\n```$/s.exec(fence);
    expect(match, fence).not.toBeNull();
    return JSON.parse(match![1]!);
  }

  it('labels say what varied, values round-trip to cascade pick, and more than 8 is refused', () => {
    expect(choiceLabel({ set: {}, seed: 42 }, true)).toBe('seed 42');
    expect(choiceLabel({ set: { 'ink.hue': 0.3 }, seed: 1 }, false)).toBe('ink.hue=0.3');
    expect(choiceLabel({ set: { 'ink.mode': 'soft' }, seed: 7 }, true)).toBe('ink.mode=soft, seed 7');
    expect(pickValue('level-dial', 3)).toBe('pick:level-dial:3');
    expect(parsePickValue('pick:level-dial:3')).toEqual({ ladder: 'level-dial', variant: 3 });
    expect(parsePickValue('seed 3')).toBeUndefined();
    expect(() => checkCardSize(MAX_CHOICE_OPTIONS)).not.toThrow();
    expect(() => checkCardSize(9)).toThrow(/at most 8/);
    expect(fenceJson(choiceFence({ prompt: 'p', options: [{ label: 'a', value: 'pick:x:1', image: 'a.png' }] })).options).toHaveLength(1);
  });

  it('refuses a ladder of more than 8 before cooking anything', async () => {
    const { root, file } = project();
    const vault = path.join(root, 'vault');
    const envelope = await captureEnvelope(() => runLockCommand([
      'ladder', file, 'swatch', '--name', 'nine', '--seeds', '1,2,3,4,5,6,7,8,9', '--cairn', path.join(vault, 'x'), '--json',
    ]));
    expect(envelope).toMatchObject({ ok: false, error: { message: expect.stringMatching(/at most 8/) } });
    expect(fs.existsSync(path.join(root, 'ladders'))).toBe(false);
  });

  it('copies each variant into the vault and returns a valid fence with vault-relative images', async (context) => {
    await needsCanvas(context);
    const { root, file } = project();
    const vault = path.join(root, 'Substrate');
    fs.mkdirSync(path.join(vault, '.obsidian'), { recursive: true });
    const attachments = path.join(vault, 'Work', 'Projects', 'Cascade', '_attachments', 'ladders', 'seeds');
    const laddered = await captureEnvelope(() => runLockCommand([
      'ladder', file, 'swatch', '--name', 'seeds', '--seeds', '4,5,6', '--live', '--cairn', attachments, '--json',
    ])) as JsonEnvelope & { data: { cairnChoice: string; variants: { image: string }[]; cairn: { vault: string } } };
    expect(laddered).toMatchObject({ ok: true, data: { status: 'laddered', cairn: { vault } } });
    const card = fenceJson(laddered.data.cairnChoice);
    expect(card.prompt).toMatch(/seeds/);
    expect(card.options.length).toBeLessThanOrEqual(MAX_CHOICE_OPTIONS);
    expect(card.options).toEqual([4, 5, 6].map((seed, index) => ({
      label: `seed ${seed}`,
      value: `pick:seeds:${index + 1}`,
      image: `Work/Projects/Cascade/_attachments/ladders/seeds/seeds-0${index + 1}.png`,
    })));
    for (const [index, option] of card.options.entries()) {
      expect(path.isAbsolute(option.image)).toBe(false);
      const copied = path.join(vault, option.image);
      expect(fs.readFileSync(copied).equals(fs.readFileSync(laddered.data.variants[index]!.image))).toBe(true);
    }
    // The tap's value is what cascade pick takes.
    const { ladder, variant } = parsePickValue(card.options[1]!.value)!;
    const picked = await captureEnvelope(() => runLockCommand(['pick', ladder, String(variant), '--project', root, '--json']));
    expect(picked).toMatchObject({ ok: true, data: { status: 'locked', ladder: 'seeds', variant: 2, lock: { seeds: { graph: 5 } } } });
    // Outside the vault named with --vault is refused.
    await expect(writeLadderCard(root, (await readLadder(root, 'seeds')).ladder, path.join(root, 'elsewhere'), vault)).rejects.toThrow(/not inside the vault/);
  }, 60_000);
});

describe('end to end, as an agent drives it', () => {
  it('a ladder of five makes a sheet, a pick makes a lock, and replay reproduces it', async (context) => {
    await needsCanvas(context);
    const { root, file } = project();
    const laddered = await captureEnvelope(() => runLockCommand([
      'ladder', file, 'swatch', '--name', 'five', '--vary', 'swatch.level=0.1,0.3,0.5,0.7,0.9', '--seeds', '3', '--json',
    ])) as JsonEnvelope & { data: { sheet: string; variants: { index: number; image: string }[] } };
    expect(laddered).toMatchObject({ ok: true, data: { status: 'laddered' } });
    expect(laddered.data.variants).toHaveLength(5);
    expect(fs.existsSync(laddered.data.sheet)).toBe(true);

    const picked = await captureEnvelope(() => runLockCommand(['pick', 'five', '4', '--project', root, '--json']));
    expect(picked).toMatchObject({ ok: true, data: { status: 'locked', ladder: 'five', variant: 4, lock: { id: 'five-4', seeds: { graph: 3 } } } });

    const out = path.join(root, 'out');
    const replayed = await captureEnvelope(() => runLockCommand(['replay', 'five-4', '--project', root, '--out', out, '--json'])) as JsonEnvelope & { data: { status: string; files: string[] } };
    expect(replayed).toMatchObject({ ok: true, data: { status: 'match', cooked: 'snapshot' } });
    const seen = await pixels(laddered.data.variants[3]!.image);
    expect((await pixels(replayed.data.files[0]!)).data.equals(seen.data)).toBe(true);
    process.exitCode = 0;
  }, 90_000);

  it('the MCP tools call the CLI with the same arguments', async () => {
    const calls: (readonly string[])[] = [];
    const mcp: McpContext = {
      root: '/project',
      resolve: (target) => path.resolve('/project', target),
      cli: async (args): Promise<JsonEnvelope> => {
        calls.push(args);
        return { ok: true, data: {}, warnings: [] };
      },
    };
    await handle({ method: 'tools/call', params: { name: 'ladder', arguments: { graph: 'g.cascade', node: 'ink', name: 'x', vary: { 'ink.width': [1, 2.5], 'ink.mode': ['soft', 'hard'] }, seeds: [1, 2] } } }, mcp, 'test');
    await handle({ method: 'tools/call', params: { name: 'pick', arguments: { ladder: 'x', variant: 2, note: 'yes' } } }, mcp, 'test');
    expect(calls[0]).toEqual(expect.arrayContaining(['ladder', '/project/g.cascade', 'ink', '--name', 'x', '--vary', 'ink.width=1,2.5', '--vary', 'ink.mode="soft","hard"', '--seeds', '1,2']));
    expect(parseValues('"soft","hard"')).toEqual(['soft', 'hard']);
    expect(calls[1]).toEqual(expect.arrayContaining(['pick', 'x', '2', '--project', '/project', '--note', 'yes']));
    // The vault is outside the project, so `cairn` passes as given.
    await handle({ method: 'tools/call', params: { name: 'ladder', arguments: { graph: 'g.cascade', node: 'ink', name: 'x', seeds: [1, 2], cairn: '/vault/Space/_attachments/ladders/x' } } }, mcp, 'test');
    expect(calls[2]).toEqual(expect.arrayContaining(['--cairn', '/vault/Space/_attachments/ladders/x']));
  });
});
