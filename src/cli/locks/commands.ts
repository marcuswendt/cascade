/**
 * `cascade lock`, `cascade locks`, `cascade replay`, `cascade lock verify`,
 * `cascade ladder` and `cascade pick`.
 *
 * Argument parsing and printing only; what each command does lives in
 * `lock.ts` and `ladder.ts`. Every command takes `--json`: the result is printed as JSON and
 * becomes the `data` of the CLI's envelope (`jsonEnvelope.ts`), cook logs go
 * to stderr, and, as with `parity`, the verdict is in the data (`status`) and
 * the exit code says only whether the command ran. Without `--json` a replay
 * that does not match exits 1.
 */
import path from 'node:path';
import { createLock, listLocks, readLock, replayLock, type LockFile, type ReplayResult } from './lock.js';
import { short } from './store.js';
import { createLadder, parseValues, pickVariant } from './ladder.js';
import { checkCardSize, writeLadderCard } from './ladderCard.js';

export const LOCK_COMMANDS = ['lock', 'locks', 'replay', 'ladder', 'pick'] as const;

export const LOCK_HELP = `
Locks: this exact render, from this code, these parameters and this seed.

  cascade lock <graph> <node> --name <name> [--note <text>] [--status approved]
               [--supersedes <id>] [--scene <scene.json>] [--seed <n>] [--input <file>]...
               [--port <output>]... [--preview <image>] [--live] [--json]
      Cook <node> and write locks/<id>.json: the graph, parameters, seeds,
      input hashes, versions, the project's source code (stored in
      .cascade/objects/) and a fingerprint of every output. --seed sets the
      graph seed for this render. Cooks from the stored code in a fresh copy
      of the project unless --live.

  cascade replay <id | locks/<id>.json> [--out <dir>] [--live] [--keep]
                 [--allow-input-change] [--project <dir>] [--json]
      Rebuild the lock's code in a throwaway copy, cook the stored graph and
      compare fingerprints. --live cooks with the project's code as it is now.
      Exits 1 when the output differs.

  cascade lock verify [<id>...] [--live] [--project <dir>] [--json]
      Replay every lock (or the named ones) and report which still match.

  cascade locks [<project-dir>] [--json]
      List the project's locks.

Ladders: three to five options side by side, and a lock at approval.

  cascade ladder <graph> <node> --name <name> [--vary <node.prop>=<a,b,c>]...
                 [--seeds <a,b,c>] [--columns N] [--port <output>]... [--input <file>]...
                 [--note <text>] [--live] [--cairn <vault dir> [--vault <dir>]] [--json]
      Cook <node> once per variant and write ladders/<id>/<n>.png, a labelled
      contact sheet ladders/<id>/sheet.png, and the record ladders/<id>.json
      (per variant: graph, params, seed, inputs, output fingerprint; the
      stored code and git commit once). Values are a JSON list without its
      brackets (0.5,1,2 or [1,2],[3,4]); lists are zipped, one value applies
      to every variant. Cooks from the stored code in a fresh copy unless --live.
      --cairn copies each variant to <dir>/<id>-<nn>.png (a space's
      _attachments/ladders/<id>/) and prints a cairn:choice card (--json:
      data.cairnChoice) whose images are relative to the vault (the nearest
      .obsidian or .git above, or --vault); at most 8 variants. A tap answers
      "Picked: <label> (pick:<id>:<n>)": run cascade pick <id> <n>.

  cascade pick <ladder-id | ladders/<id>.json> <n> [--name <lock name>] [--note <text>]
               [--status approved] [--supersedes <id>] [--project <dir>] [--json]
      Write locks/<id>.json for variant <n> from the ladder's record, without
      cooking again: its fingerprint is the image that was approved, so
      cascade replay reproduces that image. Default name: "<ladder> <n>".
`;

interface Parsed {
  readonly positional: string[];
  readonly values: Map<string, string[]>;
  readonly switches: Set<string>;
}

// `--verify` is accepted and changes nothing: a replay always compares.
const SWITCHES = new Set(['--json', '--live', '--keep', '--allow-input-change', '--verify', '--verbose', '-v']);

function parse(args: readonly string[]): Parsed {
  const positional: string[] = [];
  const values = new Map<string, string[]>();
  const switches = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (SWITCHES.has(arg)) switches.add(arg === '-v' ? '--verbose' : arg);
    else if (arg.startsWith('--')) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
      values.set(arg, [...(values.get(arg) ?? []), value]);
      index += 1;
    } else positional.push(arg);
  }
  return { positional, values, switches };
}

const one = (parsed: Parsed, flag: string) => parsed.values.get(flag)?.slice(-1)[0];

export async function runLockCommand(args: readonly string[]): Promise<void> {
  const json = args.includes('--json');
  // With --json, stdout carries the result alone; anything a node logs goes to stderr.
  const log = console.log;
  if (json) console.log = console.error;
  const print = (value: unknown) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  try {
    const [command, ...rest] = args;
    if (command === 'locks') await locksCommand(parse(rest), json, print);
    else if (command === 'replay') await replayCommand(parse(rest), json, print);
    else if (command === 'lock' && rest[0] === 'verify') await verifyCommand(parse(rest.slice(1)), json, print);
    else if (command === 'lock') await lockCommand(parse(rest), json, print);
    else if (command === 'ladder') await ladderCommand(parse(rest), json, print);
    else if (command === 'pick') await pickCommand(parse(rest), json, print);
    else throw new Error(`Unknown lock command: ${command}`);
  } catch (error) {
    // Under --json the envelope reports it as `ok: false`.
    if (json) throw error;
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    console.log = log;
  }
}

async function lockCommand(parsed: Parsed, json: boolean, print: (value: unknown) => void): Promise<void> {
  const [graph, node] = parsed.positional;
  const name = one(parsed, '--name');
  if (!graph || !node || !name) throw new Error('cascade lock needs <graph> <node> --name <name>');
  const { lock, file } = await createLock({
    graph,
    node,
    name,
    note: one(parsed, '--note'),
    status: one(parsed, '--status'),
    supersedes: one(parsed, '--supersedes'),
    scene: one(parsed, '--scene'),
    seed: seedValue(one(parsed, '--seed')),
    inputs: parsed.values.get('--input'),
    ports: parsed.values.get('--port'),
    preview: one(parsed, '--preview'),
    live: parsed.switches.has('--live'),
    verbose: parsed.switches.has('--verbose'),
  });
  if (json) return print({ status: 'locked', file, lock });
  console.log(`Locked ${lock.id} -> ${shown(file)}`);
  console.log(`  ${lock.graph.file} node ${lock.graph.node}, graph ${short(lock.graph.object)}, code ${short(lock.code.tree)} (${lock.code.files} files)`);
  console.log(`  ${Object.keys(lock.inputs).length} inputs, ${Object.keys(lock.seeds).length} seeds, cooked from the ${lock.host.cooked} in ${seconds(lock.output.durationMs)}`);
  for (const [port, fingerprint] of Object.entries(lock.output.ports)) console.log(`  ${port}: ${describePort(fingerprint)}`);
  if (lock.code.skipped?.length) console.log(`  not stored (over 2 MB): ${lock.code.skipped.join(', ')}`);
  if (lock.output.trace) console.log(`  trace ${lock.output.trace}`);
}

async function replayCommand(parsed: Parsed, json: boolean, print: (value: unknown) => void): Promise<void> {
  const target = parsed.positional[0];
  if (!target) throw new Error('cascade replay needs a lock id or file');
  const { lock, root } = await readLock(one(parsed, '--project') ?? process.cwd(), target);
  const result = await replayLock(root, lock, {
    out: one(parsed, '--out'),
    live: parsed.switches.has('--live'),
    keep: parsed.switches.has('--keep'),
    allowInputChange: parsed.switches.has('--allow-input-change'),
    verbose: parsed.switches.has('--verbose'),
  });
  if (json) return print(result);
  printReplay(result);
  if (lock.ladder) console.log(`  picked from ladder ${lock.ladder.id}, variant ${lock.ladder.label}: ${result.status === 'match' ? 'same pixels as' : 'differs from'} ${lock.ladder.image}`);
  if (result.status !== 'match') process.exitCode = 1;
}

async function verifyCommand(parsed: Parsed, json: boolean, print: (value: unknown) => void): Promise<void> {
  const root = path.resolve(one(parsed, '--project') ?? process.cwd());
  const locks: LockFile[] = parsed.positional.length
    ? await Promise.all(parsed.positional.map(async (id) => (await readLock(root, id)).lock))
    : await listLocks(root);
  if (!locks.length) throw new Error(`No locks in ${path.join(root, 'locks')}`);
  const results: (ReplayResult | { id: string; status: 'error'; error: string })[] = [];
  // One at a time: a cook installs process-wide bridges, and two at once would share them.
  for (const lock of locks) {
    try {
      const result = await replayLock(root, lock, {
        live: parsed.switches.has('--live'),
        allowInputChange: parsed.switches.has('--allow-input-change'),
        verbose: parsed.switches.has('--verbose'),
      });
      results.push(result);
      if (!json) printReplay(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ id: lock.id, status: 'error', error: message });
      if (!json) console.log(`${lock.id}: ERROR\n  ${message.split('\n').join('\n  ')}`);
    }
  }
  const failed = results.filter((result) => result.status !== 'match').length;
  if (json) return print({ status: failed ? 'failed' : 'ok', verified: results.length, failed, results });
  console.log(`\n${results.length - failed} of ${results.length} locks reproduce${failed ? `; ${failed} do not` : ''}.`);
  if (failed) process.exitCode = 1;
}

async function locksCommand(parsed: Parsed, json: boolean, print: (value: unknown) => void): Promise<void> {
  const root = path.resolve(parsed.positional[0] ?? one(parsed, '--project') ?? process.cwd());
  const locks = await listLocks(root);
  if (json) {
    return print({
      project: root,
      locks: locks.map((lock) => ({
        id: lock.id, name: lock.name, status: lock.status, created: lock.created,
        graph: lock.graph.file, node: lock.graph.node,
        ...(lock.note ? { note: lock.note } : {}),
        ...(lock.supersedes ? { supersedes: lock.supersedes } : {}),
        commit: lock.versions.project.commit ?? null,
        preview: lock.preview?.file ?? null,
      })),
    });
  }
  if (!locks.length) return console.log(`No locks in ${path.join(root, 'locks')}`);
  const width = Math.max(...locks.map((lock) => lock.id.length));
  for (const lock of locks) {
    const commit = lock.versions.project.commit ? ` @${lock.versions.project.commit.slice(0, 7)}${lock.versions.project.dirty ? '+' : ''}` : '';
    const supersedes = lock.supersedes ? `, supersedes ${lock.supersedes}` : '';
    console.log(`${lock.id.padEnd(width)}  ${lock.status.padEnd(9)} ${lock.created.slice(0, 16).replace('T', ' ')}  ${lock.graph.file} ${lock.graph.node}${commit}${supersedes}`);
  }
}

async function ladderCommand(parsed: Parsed, json: boolean, print: (value: unknown) => void): Promise<void> {
  const [graph, node] = parsed.positional;
  const name = one(parsed, '--name');
  if (!graph || !node || !name) throw new Error('cascade ladder needs <graph> <node> --name <name> and --vary or --seeds');
  const vary: Record<string, unknown[]> = {};
  for (const pair of parsed.values.get('--vary') ?? []) {
    const at = pair.indexOf('=');
    if (at <= 0) throw new Error(`--vary takes node.prop=a,b,c (got "${pair}")`);
    vary[pair.slice(0, at)] = parseValues(pair.slice(at + 1));
  }
  const seedsText = one(parsed, '--seeds');
  const seeds = seedsText === undefined ? undefined : seedsText.split(',').map((text) => seedValue(text.trim())!);
  const cairn = one(parsed, '--cairn');
  // Before cooking: a choice card holds at most eight pictures.
  if (cairn) checkCardSize(Math.max(0, ...Object.values(vary).map((values) => values.length), seeds?.length ?? 0));
  const columns = one(parsed, '--columns');
  const { ladder, file } = await createLadder({
    graph,
    node,
    name,
    note: one(parsed, '--note'),
    vary,
    seeds,
    columns: columns === undefined ? undefined : Number(columns),
    ports: parsed.values.get('--port'),
    inputs: parsed.values.get('--input'),
    live: parsed.switches.has('--live'),
    verbose: parsed.switches.has('--verbose'),
  });
  const root = path.dirname(path.dirname(file));
  const card = cairn ? await writeLadderCard(root, ladder, cairn, one(parsed, '--vault')) : undefined;
  if (json) {
    return print({
      status: 'laddered',
      file,
      sheet: path.join(root, ladder.sheet.file),
      variants: ladder.variants.map((variant) => ({ index: variant.index, label: variant.label, image: path.join(root, variant.image), set: variant.set, seed: variant.seed })),
      ...(card ? { cairnChoice: card.fence, cairn: { vault: card.vault, files: card.files, choice: card.choice } } : {}),
      ladder,
    });
  }
  console.log(`Ladder ${ladder.id} -> ${shown(file)}, cooked from the ${ladder.host.cooked}`);
  console.log(`  sheet ${shown(path.join(root, ladder.sheet.file))}`);
  for (const variant of ladder.variants) console.log(`  ${variant.label}  ${variant.image}  (${seconds(variant.output.durationMs)})`);
  console.log(`Pick one with: cascade pick ${ladder.id} <n> --project ${root}`);
  if (card) {
    console.log(`\nCairn choice card (images in ${shown(path.dirname(card.files[0]!))}); post it as is, and on "Picked: … (pick:${ladder.id}:<n>)" run cascade pick ${ladder.id} <n> --project ${root}:\n`);
    console.log(card.fence);
  }
}

async function pickCommand(parsed: Parsed, json: boolean, print: (value: unknown) => void): Promise<void> {
  const [ladder, variant] = parsed.positional;
  const index = Number(variant);
  if (!ladder || !Number.isInteger(index)) throw new Error('cascade pick needs <ladder> <variant number>');
  const result = await pickVariant(one(parsed, '--project') ?? process.cwd(), ladder, index, {
    name: one(parsed, '--name'),
    note: one(parsed, '--note'),
    status: one(parsed, '--status'),
    supersedes: one(parsed, '--supersedes'),
  });
  for (const warning of result.warnings) console.error(`Warning: ${warning}`);
  if (json) return print({ status: 'locked', file: result.file, ladder: result.ladder, variant: result.variant.index, warnings: result.warnings, lock: result.lock });
  const commit = result.lock.versions.project.commit;
  console.log(`Locked ${result.lock.id} -> ${shown(result.file)}: ${result.ladder} variant ${result.variant.label}`);
  console.log(`  graph seed ${result.lock.seeds.graph}, code ${short(result.lock.code.tree)}${commit ? `, commit ${commit.slice(0, 7)}${result.lock.versions.project.dirty ? '+' : ''}` : ''}`);
  console.log(`  image ${result.variant.image}${result.lock.preview ? `, preview ${result.lock.preview.file}` : ''}`);
  console.log(`Reproduce it with: cascade replay ${result.lock.id}`);
}

function printReplay(result: ReplayResult): void {
  const verdict = result.status === 'match' ? 'match' : 'MISMATCH';
  const from = result.cooked === 'live' ? "the project's current code" : "the lock's code";
  console.log(`${result.id}: ${verdict}, replayed from ${from} in ${seconds(result.durationMs)}`);
  for (const difference of result.differences) {
    console.log(`  ${difference.port}: locked ${difference.expected}`);
    console.log(`  ${' '.repeat(difference.port.length)}  replay ${difference.actual}`);
  }
  if (result.status === 'match') {
    for (const [port, fingerprint] of Object.entries(result.ports)) console.log(`  ${port}: ${describePort(fingerprint)}`);
  }
  const code = result.codeSinceLock;
  const drift = code.changed.length + code.added.length + code.removed.length;
  if (drift) {
    console.log(`  project code since the lock: ${code.changed.length} changed, ${code.added.length} added, ${code.removed.length} removed`);
    for (const name of code.changed.slice(0, 10)) console.log(`    changed ${name}`);
    if (code.changed.length > 10) console.log(`    ... and ${code.changed.length - 10} more`);
  }
  for (const change of result.inputsChanged) console.log(`  input changed: ${change.path}`);
  for (const warning of result.warnings) console.log(`  note: ${warning}`);
  for (const file of result.files) console.log(`  wrote ${shown(file)}`);
  if (result.trace) console.log(`  trace ${result.trace}`);
  if (result.kept) console.log(`  replay copy kept at ${result.kept}`);
}

function describePort(fingerprint: ReplayResult['ports'][string]): string {
  if (fingerprint.kind === 'value') return `value ${short(fingerprint.sha256)}`;
  const size = fingerprint.width ? ` ${fingerprint.width}x${fingerprint.height}` : '';
  return `${fingerprint.path}${size} ${short(fingerprint.pixels ?? fingerprint.sha256)}`;
}

/** Relative to where the command ran when that is shorter, absolute otherwise. */
function shown(file: string): string {
  const relative = path.relative(process.cwd(), file);
  return relative.startsWith('..') ? file : relative;
}

function seedValue(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const value = Number(text);
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new Error(`--seed must be an integer from 0 to 4294967295 (got "${text}")`);
  return value;
}

function seconds(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}
