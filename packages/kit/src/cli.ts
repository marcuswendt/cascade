// cascade-kit: the kit's one command.
//
//   cascade-kit nodes <provider-package> [node…] [--check] [--project <dir>]
//
// Writes `nodes/<name>/index.ts` stubs for another project's nodes (see nodes.ts).

import { resolve } from 'node:path';
import { syncNodeStubs } from './nodes.js';

const USAGE = 'usage: cascade-kit nodes <provider-package> [node...] [--check] [--project <dir>]';

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command !== 'nodes') { console.error(USAGE); return command === '--help' || command === '-h' ? 0 : 2; }
  let project = '.', check = false;
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--check') check = true;
    else if (rest[i] === '--project') project = rest[++i] ?? '.';
    else positional.push(rest[i]);
  }
  const [provider, ...names] = positional;
  if (!provider) { console.error(USAGE); return 2; }
  const r = await syncNodeStubs({ project: resolve(project), provider, names, check });
  for (const n of r.written) console.log(`wrote nodes/${n}/index.ts`);
  for (const n of r.skipped) console.log(`skipped nodes/${n}: a local node of that name exists and was not written by cascade-kit`);
  for (const n of r.drift) console.error(`drift: nodes/${n}/index.ts does not match ${provider}/nodes/${n}`);
  console.log(`${provider}: ${r.written.length} written, ${r.unchanged.length} unchanged, ${r.skipped.length} skipped${check ? `, ${r.drift.length} drifted` : ''}`);
  return r.drift.length ? 1 : 0;
}
