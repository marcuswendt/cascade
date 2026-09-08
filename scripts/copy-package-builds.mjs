import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

for (const name of ['contracts', 'runtime']) {
  const source = resolve('packages', name, 'dist');
  const destination = resolve('dist', name);
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  cpSync(source, destination, { recursive: true });
}

// Published runtime files resolve contracts through the root package's actual
// self-reference, including when consumers install it under the `cascade`
// alias or link the workspace during project development.
for (const file of filesUnder(resolve('dist', 'runtime'))) {
  if (!/\.(?:js|d\.ts|map)$/.test(file)) continue;
  const source = readFileSync(file, 'utf8');
  writeFileSync(file, source.replaceAll('@cascade/contracts', '@field/cascade/contracts'));
}

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = resolve(directory, entry.name);
    return entry.isDirectory() ? filesUnder(file) : [file];
  });
}
