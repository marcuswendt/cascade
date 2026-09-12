/**
 * The `files` capability on the CLI host.
 *
 * Reported by MW-OBSERVATORY-ART on 2026-09-12: `FileCapability` is in the
 * contract and `'files'` is valid for the server locus, but the CLI host
 * installed only `shell`, `assets` and `gpu` — so a node declaring `files` ran
 * with `undefined`, and the workaround that worked was an **undeclared**
 * `node:fs` import. The system rewarded the invisible version of the thing
 * declarations exist to make visible.
 *
 * What is worth testing is the containment, not the reading and writing. A
 * `files` capability that can reach outside its project, or write next to the
 * source material, is a worse thing to have than none — and both are one
 * relaxation away at every call site.
 */
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createNodeFileCapability } from '../src/cli/nodeFiles';

const signal = { aborted: false, addEventListener() {}, removeEventListener() {} } as never;
const options = { signal };

let root: string;
let files: ReturnType<typeof createNodeFileCapability>;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'cascade-files-'));
  // The two methods this capability uses off ProjectRoot, and nothing else.
  files = createNodeFileCapability({
    resolve: (relative: string) => path.join(root, relative),
  } as never);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('reading', () => {
  it('reads a file inside the project', async () => {
    await writeFile(path.join(root, 'note.txt'), 'hello');
    expect(new TextDecoder().decode(await files.read('note.txt', options))).toBe('hello');
  });

  it('accepts a leading ./ or / as project-relative', async () => {
    await writeFile(path.join(root, 'note.txt'), 'hello');
    for (const spelling of ['./note.txt', '/note.txt'])
      expect((await files.read(spelling, options)).byteLength).toBe(5);
  });

  it('refuses to escape the project', async () => {
    // A graph is a document that can arrive from anywhere. This is the whole
    // reason the capability is scoped rather than being `node:fs`.
    await expect(files.read('../outside.txt', options)).rejects.toThrow(
      /outside the project is refused/,
    );
    await expect(files.read('nested/../../outside.txt', options)).rejects.toThrow(
      /outside the project is refused/,
    );
  });

  it('treats an absolute path as project-relative, so it cannot read the machine', async () => {
    // `/etc/hosts` becomes `<project>/etc/hosts` — the same leading-slash rule
    // `cascade/io` uses, so a node behaves identically under both hosts. The
    // claim worth asserting is the security one: it does not reach the real
    // file. It fails as absent rather than as refused, which is a slightly
    // worse message for a slightly better property.
    await expect(files.read('/etc/hosts', options)).rejects.toThrow(/ENOENT/);
    await mkdir(path.join(root, 'etc'), { recursive: true });
    await writeFile(path.join(root, 'etc/hosts'), 'inside');
    expect(new TextDecoder().decode(await files.read('/etc/hosts', options))).toBe('inside');
  });
});

describe('symlinks', () => {
  it('refuses a symlink that leaves the project', async () => {
    /**
     * The first version checked containment with `path.resolve`, which
     * normalises `..` and does NOT follow symlinks — so a project containing
     * `cache -> /somewhere/else` passed the check and read outside. Measured
     * on 2026-09-12 against a file called `secret`: it came back.
     *
     * That defeats the only promise this capability makes, and the reason it
     * is scoped at all is that a graph is a document that can arrive from
     * anywhere. A project carrying a symlink to `~/.ssh` would have read it.
     */
    const outside = await mkdtemp(path.join(tmpdir(), 'cascade-outside-'));
    try {
      await writeFile(path.join(outside, 'secret.txt'), 'secret');
      await symlink(outside, path.join(root, 'cache'));
      await expect(files.read('cache/secret.txt', options)).rejects.toThrow(
        /outside the project is refused/,
      );
      await expect(files.list('cache', options)).rejects.toThrow(/outside the project is refused/);
      await expect(files.stat('cache/secret.txt', options)).rejects.toThrow(
        /outside the project is refused/,
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('allows a symlink that stays inside the project', async () => {
    // Containment, not a ban on symlinks. A link within the tree reaches
    // nothing the capability would not have reached anyway.
    await mkdir(path.join(root, 'real'), { recursive: true });
    await writeFile(path.join(root, 'real/note.txt'), 'inside');
    await symlink(path.join(root, 'real'), path.join(root, 'linked'));
    expect(new TextDecoder().decode(await files.read('linked/note.txt', options))).toBe('inside');
  });

  it('refuses a write through a symlink that leaves the project', async () => {
    // The write path resolves the nearest EXISTING ancestor, because the file
    // itself does not exist yet — resolving the target would fail on every
    // first write and leave exactly this case open.
    const outside = await mkdtemp(path.join(tmpdir(), 'cascade-outside-'));
    try {
      await mkdir(path.join(root, '.cascade-cache'), { recursive: true });
      await symlink(outside, path.join(root, '.cascade-cache/escape'));
      await expect(
        files.write('.cascade-cache/escape/out.bin', new Uint8Array([1]), options),
      ).rejects.toThrow(/outside the project is refused/);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe('writing', () => {
  it('writes into the cache', async () => {
    await files.write('.cascade-cache/out.bin', new Uint8Array([1, 2, 3]), options);
    expect((await readFile(path.join(root, '.cascade-cache/out.bin'))).byteLength).toBe(3);
  });

  it('creates the directory on the way', async () => {
    await files.write('.cascade-cache/deep/out.bin', new Uint8Array([1]), options);
    expect((await readFile(path.join(root, '.cascade-cache/deep/out.bin'))).byteLength).toBe(1);
  });

  it('refuses to write beside the source material', async () => {
    // The media route's rule, kept rather than relaxed offline. A node's output
    // is derived data a re-cook reproduces; a capability that writes anywhere
    // headlessly and nowhere in the page is two capabilities, and the sketch
    // built on the generous one breaks in Studio without saying why.
    await expect(files.write('note.txt', new Uint8Array([1]), options)).rejects.toThrow(
      /writes are confined to \.cascade-cache\//,
    );
  });

  it('refuses to escape the project through the cache', async () => {
    await expect(
      files.write('.cascade-cache/../../out.bin', new Uint8Array([1]), options),
    ).rejects.toThrow(/outside the project is refused/);
  });
});

describe('listing and stat', () => {
  it('lists, marking directories', async () => {
    await mkdir(path.join(root, 'assets'), { recursive: true });
    await writeFile(path.join(root, 'a.txt'), 'a');
    expect(await files.list('.', options)).toEqual(['a.txt', 'assets/']);
  });

  it('lists a missing directory as empty rather than throwing', async () => {
    // `.cascade-cache/` does not exist until something writes to it, and a node
    // asking what is in it before then is not making a mistake.
    expect(await files.list('.cascade-cache', options)).toEqual([]);
  });

  it('stats a file and returns null for one that is not there', async () => {
    await writeFile(path.join(root, 'note.txt'), 'hello');
    const stats = await files.stat('note.txt', options);
    expect(stats?.size).toBe(5);
    expect(typeof stats?.modifiedAt).toBe('number');
    // The contract's `| null` exists so a node asking whether a file exists
    // does not have to catch.
    expect(await files.stat('absent.txt', options)).toBeNull();
  });

  it('refuses to list or stat outside the project', async () => {
    await expect(files.list('..', options)).rejects.toThrow(/outside the project is refused/);
    await expect(files.stat('../outside.txt', options)).rejects.toThrow(
      /outside the project is refused/,
    );
  });
});

describe('cancellation', () => {
  it('every operation checks the signal first', async () => {
    // A cancelled cook already inside a directory walk would otherwise finish
    // it, and Studio's preemption exists so a superseded cook stops costing
    // something.
    const aborted = { signal: { aborted: true, addEventListener() {}, removeEventListener() {} } } as never;
    await writeFile(path.join(root, 'note.txt'), 'hello');
    await expect(files.read('note.txt', aborted)).rejects.toThrow(/cancelled/);
    await expect(files.write('.cascade-cache/x', new Uint8Array([1]), aborted)).rejects.toThrow(/cancelled/);
    await expect(files.list('.', aborted)).rejects.toThrow(/cancelled/);
    await expect(files.stat('note.txt', aborted)).rejects.toThrow(/cancelled/);
  });
});
