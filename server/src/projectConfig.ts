import fs from 'node:fs';
import path from 'node:path';

export interface ProjectManifest {
  readonly name: string;
  readonly commands: Readonly<Record<string, string>>;
  readonly credentials: readonly string[];
  readonly settings: Readonly<Record<string, unknown>>;
}

const CREDENTIAL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SECRET_KEY = /^(?:api[_-]?key|apiKey|secret|password|access[_-]?token|refresh[_-]?token|credential|credentials)$/i;

export function readProjectManifest(root: string): ProjectManifest {
  const raw = readRaw(root);
  return normalizeManifest(raw);
}

export function writeProjectManifest(root: string, input: unknown): ProjectManifest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('project manifest must be an object');
  const value = input as Record<string, unknown>;
  const current = readRaw(root);
  const next = {
    ...current,
    name: typeof value.name === 'string' ? value.name.trim() : '',
    commands: stringRecord(value.commands, 'commands'),
    credentials: credentialNames(value.credentials),
    settings: settingsRecord(value.settings),
  };
  fs.writeFileSync(path.join(root, 'cascade.json'), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return normalizeManifest(next);
}

function readRaw(root: string): Record<string, unknown> {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(root, 'cascade.json'), 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('root must be an object');
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error(`Cannot read cascade.json: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function normalizeManifest(raw: Record<string, unknown>): ProjectManifest {
  return Object.freeze({
    name: typeof raw.name === 'string' ? raw.name : '',
    commands: Object.freeze(stringRecord(raw.commands, 'commands')),
    credentials: Object.freeze(credentialNames(raw.credentials)),
    settings: Object.freeze(settingsRecord(raw.settings)),
  });
}

function stringRecord(input: unknown, label: string): Record<string, string> {
  if (input === undefined) return {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(`${label} must be an object of strings`);
  const entries = Object.entries(input);
  if (entries.some(([key, value]) => !CREDENTIAL_NAME.test(key) || typeof value !== 'string' || value.includes('\0'))) {
    throw new Error(`${label} must contain safe names and string values`);
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function credentialNames(input: unknown): string[] {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.some((name) => typeof name !== 'string' || !CREDENTIAL_NAME.test(name))) {
    throw new Error('credentials must be an array of safe names');
  }
  return [...new Set(input as string[])];
}

function settingsRecord(input: unknown): Record<string, unknown> {
  if (input === undefined) return {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('settings must be an object');
  assertSafeSettings(input, 0);
  return structuredClone(input as Record<string, unknown>);
}

function assertSafeSettings(value: unknown, depth: number): void {
  if (depth > 12) throw new Error('settings nesting is too deep');
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return;
  if (Array.isArray(value)) return value.forEach((item) => assertSafeSettings(item, depth + 1));
  if (!value || typeof value !== 'object') throw new Error('settings must contain JSON values');
  for (const [key, item] of Object.entries(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype' || SECRET_KEY.test(key)) {
      throw new Error(`settings key ${JSON.stringify(key)} looks secret or unsafe; credentials belong outside the project`);
    }
    assertSafeSettings(item, depth + 1);
  }
}
