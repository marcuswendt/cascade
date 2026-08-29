import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

const name = process.argv[2];
if (!['contracts', 'runtime'].includes(name)) {
  throw new Error('Expected package name: contracts or runtime');
}

rmSync(resolve(import.meta.dirname, '..', 'packages', name, 'dist'), {
  recursive: true,
  force: true,
});
