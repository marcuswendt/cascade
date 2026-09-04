/**
 * Identifies the build the server is currently serving.
 *
 * A Studio tab left open across a rebuild keeps running the code it loaded,
 * and the way that surfaced was File > Save quietly downloading a file
 * instead of writing to the project — which reads as a missing feature
 * rather than a stale page. Studio can only notice if it can ask what is
 * being served now and compare it with what it loaded.
 *
 * The id comes from `index.html` rather than the package version, because it
 * is the file that names the hashed asset bundles: a rebuild changes it, and
 * a version bump without a rebuild does not change what the browser runs.
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';

export function buildId(distDir: string): string | null {
  try {
    const contents = fs.readFileSync(`${distDir}/index.html`);
    return createHash('sha256').update(contents).digest('hex').slice(0, 16);
  } catch {
    // Running API-only against no build at all, which the server already warns
    // about at startup. No id is honest here; a fabricated one would make
    // Studio claim it was up to date.
    return null;
  }
}
