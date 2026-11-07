/**
 * `cascade share`: a graph's editor, or a finished static page, as one link.
 *
 * The point is that the output reaches people as a URL, not as a tool to
 * install. A graph is exported exactly as `cascade export` does (the same
 * allowlist and leak scan) into a scratch directory; a directory is copied
 * there and scanned the same way. The scratch site is deployed to its own
 * Vercel project, `cascade-<slug>`, and the stable production URL is printed
 * and recorded in the project's `shares.json`, so a shelf or an agent can find
 * what has been shared. The deploy sits behind a `Deployer`, so tests stub it.
 *
 * A share is public by default: that is what a link for the team is. The
 * export boundary is the gate. `--protected` instead requires Vercel
 * Authentication, as `cascade export --deploy vercel` does.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deployVercel, exportEditor, scanForLeaks, vercelConfig, type Deployer } from './editorExport.js';

export const SHARE_USAGE = 'cascade share <graph-file | site-directory> [--name <slug>] [--scope <team>] [--protected] [--json]';

export interface ShareOptions {
  /** The slug; the Vercel project is `cascade-<slug>`. Defaults to the editor id or the directory name. */
  readonly name?: string;
  readonly scope?: string;
  /** Require Vercel Authentication instead of a public link. */
  readonly protected?: boolean;
  readonly log?: (line: string) => void;
  /** Replaces `vercel deploy` (tests). */
  readonly deploy?: Deployer;
  /** Fixes `sharedAt` (tests). */
  readonly now?: () => Date;
}

export interface ShareRecord {
  /** The graph or directory shared, relative to the project. */
  readonly source: string;
  readonly name: string;
  readonly project: string;
  readonly url: string;
  readonly deployment: string;
  readonly sharedAt: string;
}

export interface ShareResult extends ShareRecord {
  /** The `shares.json` the share was recorded in, if the source sits in a project. */
  readonly shares?: string;
}

export interface SharesFile {
  readonly format: 'cascade.shares';
  readonly version: 1;
  readonly shares: readonly ShareRecord[];
}

/** A Vercel project name part: lower-case letters, digits and single hyphens. */
export function shareSlug(text: string): string {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^cascade-/, '').slice(0, 80).replace(/-+$/, '');
  if (!slug) throw new Error(`"${text}" makes no usable name; pass --name <slug>`);
  return slug;
}

export async function share(target: string, options: ShareOptions = {}): Promise<ShareResult> {
  const log = options.log ?? ((line: string) => console.log(line));
  const source = path.resolve(target);
  const stat = await fs.stat(source).catch(() => undefined);
  if (!stat) throw new Error(`${target} does not exist`);
  const isGraph = stat.isFile() && source.endsWith('.cascade');
  if (!isGraph && !stat.isDirectory()) throw new Error(`cascade share takes a .cascade graph or a directory with an index.html (got ${target})`);

  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'cascade-share-'));
  try {
    const site = path.join(scratch, 'site');
    let name: string;
    let projectRoot: string | undefined;
    if (isGraph) {
      const { plan } = await exportEditor(source, { out: site, log });
      name = shareSlug(options.name ?? plan.editor.id);
      projectRoot = path.dirname(source);
    } else {
      if (!(await fs.stat(path.join(source, 'index.html')).catch(() => undefined))?.isFile())
        throw new Error(`${target} has no index.html to share`);
      await copySite(source, site);
      if (!(await fs.stat(path.join(site, 'vercel.json')).catch(() => undefined)))
        await fs.writeFile(path.join(site, 'vercel.json'), `${JSON.stringify(vercelConfig(), null, 2)}\n`);
      projectRoot = await findProjectRoot(source);
      await scanForLeaks(site, projectRoot ?? source);
      name = shareSlug(options.name ?? path.basename(source));
    }
    const project = `cascade-${name}`;
    const deploy = options.deploy ?? deployVercel;
    const deployed = await deploy(site, { project, scope: options.scope, public: options.protected !== true, log });
    const record: ShareRecord = {
      source: projectRoot ? path.relative(projectRoot, source).split(path.sep).join('/') || '.' : path.basename(source),
      name,
      project,
      url: deployed.url,
      deployment: deployed.deployment,
      sharedAt: (options.now?.() ?? new Date()).toISOString(),
    };
    const shares = projectRoot ? await recordShare(projectRoot, record) : undefined;
    return { ...record, ...(shares ? { shares } : {}) };
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
}

/** Write or replace the record for this source in `<project>/shares.json`. */
export async function recordShare(projectRoot: string, record: ShareRecord): Promise<string> {
  const file = path.join(projectRoot, 'shares.json');
  const existing = await readShares(projectRoot);
  const shares = [...existing.shares.filter((item) => item.source !== record.source), record]
    .sort((a, b) => a.source.localeCompare(b.source));
  const next: SharesFile = { format: 'cascade.shares', version: 1, shares };
  await fs.writeFile(file, `${JSON.stringify(next, null, 2)}\n`);
  return file;
}

export async function readShares(projectRoot: string): Promise<SharesFile> {
  const text = await fs.readFile(path.join(projectRoot, 'shares.json'), 'utf8').catch(() => undefined);
  if (!text) return { format: 'cascade.shares', version: 1, shares: [] };
  const parsed = JSON.parse(text) as Partial<SharesFile>;
  if (parsed.format !== 'cascade.shares' || !Array.isArray(parsed.shares)) throw new Error(`${path.join(projectRoot, 'shares.json')} is not a cascade.shares file`);
  return { format: 'cascade.shares', version: 1, shares: parsed.shares };
}

/** The nearest directory at or above `start` with a cascade.json: the project a shared directory belongs to. */
async function findProjectRoot(start: string): Promise<string | undefined> {
  for (let directory = start; ; directory = path.dirname(directory)) {
    if (await fs.stat(path.join(directory, 'cascade.json')).catch(() => undefined)) return directory;
    if (path.dirname(directory) === directory) return undefined;
  }
}

/** Copy a static site, leaving out dotfiles (a `.vercel` link, `.env`) and anything under `licensed/`. */
async function copySite(from: string, to: string): Promise<void> {
  await fs.cp(from, to, {
    recursive: true,
    dereference: true,
    filter: (file) => {
      const relative = path.relative(from, file);
      return !relative || relative.split(path.sep).every((part) => !part.startsWith('.') && part !== 'licensed');
    },
  });
}

/** `cascade share …` from the command line. */
export async function runShareCommand(args: readonly string[]): Promise<void> {
  const rest = args.slice(1);
  const json = rest.includes('--json');
  let target: string | undefined;
  const values: Record<string, string> = {};
  let isProtected = false;
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index]!;
    if (arg === '--json') continue;
    if (arg === '--protected') { isProtected = true; continue; }
    if (arg === '--name' || arg === '--scope') {
      const value = rest[++index];
      if (!value || value.startsWith('--')) throw new Error(`${arg} needs a value`);
      values[arg.slice(2)] = value;
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}\nUsage: ${SHARE_USAGE}`);
    if (target) throw new Error(`cascade share takes one graph or directory\nUsage: ${SHARE_USAGE}`);
    target = arg;
  }
  if (!target) throw new Error(`Usage: ${SHARE_USAGE}`);
  const result = await share(target, {
    ...(values.name ? { name: values.name } : {}),
    ...(values.scope ? { scope: values.scope } : {}),
    protected: isProtected,
    log: json ? () => {} : (line) => console.log(line),
  });
  if (json) console.log(JSON.stringify(result));
  else console.log(`\nShared: ${result.url}${result.shares ? `\nRecorded in ${result.shares}` : ''}`);
}
