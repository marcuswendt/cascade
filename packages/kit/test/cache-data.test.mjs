import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { createCache, decodeValue, encodeValue, hashText, hashValue } from '../dist/cache.js';
import { addDays, eventsByDay, painter, readCairnSnapshot, spaceEvents } from '../dist/cairn.js';
import { bestFrame, parseLocalTime, readMomentRecord, selectMomentImage } from '../dist/observatory.js';
import { KIT_VERSION } from '../dist/index.js';

test('cache values round-trip, typed arrays included', () => {
  const v = { a: 1, f32: Float32Array.from({ length: 300 }, (_, i) => i / 3), f64: Float64Array.from({ length: 300 }, (_, i) => Math.PI * i), list: Array.from({ length: 300 }, (_, i) => i * 0.1), small: [1, 2] };
  const back = decodeValue(encodeValue(v));
  assert.ok(back.f32 instanceof Float32Array && back.f64 instanceof Float64Array && Array.isArray(back.list));
  assert.deepEqual(back, v);
  assert.equal(hashValue({ b: 1, a: 2 }), hashValue({ a: 2, b: 1 }));
  assert.notEqual(hashText('a'), hashText('b'));
});

test('disk cache keys on inputs AND code; every call logs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kit-cache-'));
  await mkdir(join(root, 'lib'));
  await writeFile(join(root, 'stage.ts'), "import { x } from './lib/x';\nexport const y = x;\n");
  await writeFile(join(root, 'lib/x.ts'), 'export const x = 1;\n');
  const lines = [];
  let runs = 0;
  const compute = () => { runs++; return { n: runs, data: new Float64Array(400).fill(runs) }; };
  const make = () => createCache({ root: pathToFileURL(root + '/'), dir: 't', name: 'test cache', log: (l) => lines.push(l), offEnv: 'KIT_TEST_CACHE' });

  const a = await make().cached('s', 'one', { p: 1 }, ['stage.ts'], compute);
  assert.equal(a.info.state, 'miss');
  const b = await make().cached('s', 'one', { p: 1 }, ['stage.ts'], compute);
  assert.equal(b.info.state, 'hit'); assert.equal(b.info.why, 'disk');
  assert.equal(b.value.n, 1); assert.ok(b.value.data instanceof Float64Array);
  assert.equal(runs, 1);
  const c = await make().cached('s', 'one', { p: 2 }, ['stage.ts'], compute);
  assert.equal(c.info.state, 'miss', 'inputs change the key');
  await writeFile(join(root, 'lib/x.ts'), 'export const x = 2;\n');
  const d = await make().cached('s', 'one', { p: 1 }, ['stage.ts'], compute);
  assert.equal(d.info.state, 'miss', 'an imported file changing is a miss');
  assert.equal(lines.length, 4);
  assert.match(lines[1], /^\[test cache\] s one: hit \(disk\) key [0-9a-f]{12}, \d+ ms, 0\.0 MB$/);
  assert.equal((await readdir(join(root, '.cascade-cache/t'))).filter((f) => f.endsWith('.bin')).length, 3);

  process.env.KIT_TEST_CACHE = 'off';
  const e = await make().cached('s', 'one', { p: 1 }, ['stage.ts'], compute);
  delete process.env.KIT_TEST_CACHE;
  assert.equal(e.info.state, 'off');

  const mem = createCache({ log: () => {}, read: async (p) => readFile(join(root, p)) });
  assert.equal((await mem.cached('s', 'm', {}, ['stage.ts'], compute)).info.why, 'no disk on this host: memory only');
  assert.equal((await mem.cached('s', 'm', {}, ['stage.ts'], compute)).info.why, 'memory');
  assert.equal(await mem.codeFingerprint('missing.ts'), null);
});

test('Cairn snapshot: painters, deduped events, errors that name the choices', async () => {
  const files = {
    'data/spaces.json': JSON.stringify({ _doc: 'note', FIELD: { name: 'FIELD', spaces: ['FIELD.IO', 'Studio'] } }),
    'data/events.json': JSON.stringify({ today: '2026-11-03', spaces: {
      'FIELD.IO': { events: [{ id: 'a', k: 'time', d: '2026-11-02' }, { id: 'b', k: 'file', d: '2026-11-01' }], tasks: [{ id: 't1' }] },
      Studio: { events: [{ id: 'a', k: 'time', d: '2026-11-02' }, { id: 'c', k: 'done', d: '2026-11-02' }] },
    } }),
  };
  const { spaces, events } = await readCairnSnapshot(async (p) => files[p]);
  const p = painter(spaces, 'FIELD');
  const { events: evs, tasks } = spaceEvents(events, p.spaces);
  assert.deepEqual(evs.map((e) => e.id), ['a', 'b', 'c']);
  assert.deepEqual(tasks.map((t) => t.id), ['t1']);
  assert.deepEqual([...eventsByDay(evs).keys()], ['2026-11-01', '2026-11-02']);
  assert.throws(() => painter(spaces, 'Family'), /unknown space "Family" \(data\/spaces.json has FIELD\)/);
  assert.throws(() => painter(spaces, '_doc'), /unknown space/);
  assert.equal(addDays('2026-11-03', -3), '2026-10-31');
});

test('Observatory moment records and photo selection', async () => {
  const fixture = { id: 'aoos', label: 'Lake Aoos', columns: { slices: 1, stops: 1, columns: [[[0.1, 0.2, 0.3]]] }, meanHue: 210, seam: 0.4, facts: {} };
  const read = async (p) => { assert.equal(p, 'assets/moments/aoos.json'); return new TextEncoder().encode(JSON.stringify(fixture)); };
  assert.deepEqual(await readMomentRecord(read, 'aoos'), fixture);
  await assert.rejects(readMomentRecord(async () => new TextEncoder().encode('{}'), 'x'), /moment x carries no colour columns/);
  const photos = [{ path: 'a.jpg', width: 4, height: 3 }, { path: 'b.jpg', width: 8, height: 6 }];
  const m = selectMomentImage({ id: 'm' }, photos, 'b.jpg');
  assert.deepEqual(m.selectedImage, { path: 'b.jpg', size: [8, 6], channels: 'rgb', depth: 'u8', space: 'srgb' });
  assert.equal(selectMomentImage({ id: 'm' }, photos, 5), null);
  assert.equal(bestFrame({ photos }).path, 'a.jpg');
  assert.deepEqual(parseLocalTime('2025-12-08T09:17:17+01:00'), { year: 2025, month: 12, day: 8, hour: 9, minute: 17 });
});

test('KIT_VERSION matches package.json', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(KIT_VERSION, pkg.version);
});
