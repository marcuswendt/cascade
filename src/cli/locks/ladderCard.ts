/**
 * A ladder as a Cairn choice card: Marcus picks a variant on his phone by
 * tapping its picture, and the tap locks it.
 *
 * `cascade ladder --cairn <dir>` copies each variant image into a directory
 * inside the Substrate vault (a space's `_attachments/ladders/<id>/`) and
 * returns the fence Cairn's web chat renders as tappable options:
 *
 *     ```cairn:choice
 *     {"prompt":"…","options":[{"label":"seed 42","value":"pick:<id>:<n>","image":"<vault path>"}]}
 *     ```
 *
 * Cairn resolves `image` like an Obsidian `![[…]]` embed, against the vault,
 * so the path is vault-relative. A tap comes back to the agent as
 * "Picked: <label> (pick:<id>:<n>)", which is `cascade pick <id> <n>`.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { LadderFile, LadderVariant } from './ladder.js';

/** Cairn shows at most this many options on a choice card. */
export const MAX_CHOICE_OPTIONS = 8;

export interface CairnChoiceOption {
  readonly label: string;
  readonly value: string;
  readonly image: string;
}

export interface CairnChoice {
  readonly prompt: string;
  readonly options: readonly CairnChoiceOption[];
}

export interface LadderCard {
  /** The `cairn:choice` card as data. */
  readonly choice: CairnChoice;
  /** The fenced block to post in the chat, as is. */
  readonly fence: string;
  /** The vault the image paths are relative to. */
  readonly vault: string;
  /** The copied images, absolute. */
  readonly files: readonly string[];
}

/** Refused before cooking: a card holds at most eight pictures. */
export function checkCardSize(count: number): void {
  if (count > MAX_CHOICE_OPTIONS) {
    throw new Error(`--cairn shows at most ${MAX_CHOICE_OPTIONS} options on a choice card (this ladder has ${count}); ladder fewer variants`);
  }
}

/** The `value` an option carries, and what the agent receives back: `pick:<ladder id>:<n>`. */
export function pickValue(ladderId: string, index: number): string {
  return `pick:${ladderId}:${index}`;
}

/** `pick:<id>:<n>` back to `cascade pick <id> <n>` arguments, or undefined. */
export function parsePickValue(value: string): { ladder: string; variant: number } | undefined {
  const match = /^pick:(.+):(\d+)$/.exec(value.trim());
  return match ? { ladder: match[1]!, variant: Number(match[2]) } : undefined;
}

/** What a variant changed, without its number: "seed 42", "hue=0.3", "hue=0.3, seed 42". */
export function choiceLabel(variant: Pick<LadderVariant, 'set' | 'seed'>, seedVaried: boolean): string {
  const parts = Object.entries(variant.set).map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`);
  if (seedVaried) parts.push(`seed ${variant.seed}`);
  return parts.join(', ');
}

/**
 * Copy each variant image into `directory` as `<ladder id>-<nn>.<ext>` (stable,
 * and unique across the vault, as Obsidian-style lookup wants) and build the card.
 * `vault` defaults to the nearest ancestor holding `.obsidian`, then `.git`.
 */
export async function writeLadderCard(root: string, ladder: LadderFile, directory: string, vault?: string): Promise<LadderCard> {
  checkCardSize(ladder.variants.length);
  const target = path.resolve(directory);
  const vaultRoot = vault ? path.resolve(vault) : await findVault(target);
  const relative = path.relative(vaultRoot, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`--cairn ${target} is not inside the vault ${vaultRoot}`);
  await fs.mkdir(target, { recursive: true });

  const seedVaried = Boolean(ladder.seeds);
  const files: string[] = [];
  const options: CairnChoiceOption[] = [];
  for (const variant of ladder.variants) {
    const file = path.join(target, `${ladder.id}-${String(variant.index).padStart(2, '0')}${path.extname(variant.image).toLowerCase()}`);
    await fs.copyFile(path.join(root, variant.image), file);
    files.push(file);
    options.push({
      label: choiceLabel(variant, seedVaried) || `variant ${variant.index}`,
      value: pickValue(ladder.id, variant.index),
      image: path.relative(vaultRoot, file).split(path.sep).join('/'),
    });
  }
  const choice: CairnChoice = { prompt: `${ladder.name}: which one? (ladder ${ladder.id}, ${ladder.graph.file} ${ladder.graph.node})`, options };
  return { choice, fence: choiceFence(choice), vault: vaultRoot, files };
}

export function choiceFence(choice: CairnChoice): string {
  return `\`\`\`cairn:choice\n${JSON.stringify(choice)}\n\`\`\``;
}

async function findVault(start: string): Promise<string> {
  for (const marker of ['.obsidian', '.git']) {
    for (let directory = start; ; directory = path.dirname(directory)) {
      if (await exists(path.join(directory, marker))) return directory;
      if (path.dirname(directory) === directory) break;
    }
  }
  throw new Error(`--cairn ${start}: no vault above it (no .obsidian or .git); name it with --vault <dir>`);
}

async function exists(file: string): Promise<boolean> {
  try { await fs.access(file); return true; } catch { return false; }
}
