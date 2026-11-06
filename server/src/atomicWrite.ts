/**
 * Write through a temporary file beside the target and rename it into place,
 * so a reader (Studio's file watch, a second CLI process, a cache lookup)
 * never sees half a file. The one copy for the server and the CLI.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';

const temporaryFor = (file: string) => `${file}.${process.pid}.tmp`;

export async function writeFileAtomic(file: string, data: string | Uint8Array, options: { mode?: number } = {}): Promise<void> {
  const temporary = temporaryFor(file);
  await fsp.writeFile(temporary, data, options.mode === undefined ? undefined : { mode: options.mode });
  await fsp.rename(temporary, file);
}

export function writeFileAtomicSync(file: string, data: string | Uint8Array): void {
  const temporary = temporaryFor(file);
  fs.writeFileSync(temporary, data);
  fs.renameSync(temporary, file);
}
