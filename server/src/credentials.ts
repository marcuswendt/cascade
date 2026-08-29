import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface CredentialDefinition {
  readonly name: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly hosts: readonly string[];
  readonly header?: string;
  readonly scheme?: string;
  readonly field?: string;
  readonly env?: string;
}

export class CredentialStore {
  constructor(readonly file = process.env.CASCADE_CREDENTIALS || path.join(os.homedir(), '.cascade', 'credentials.yaml')) {}

  has(name: string): boolean {
    const definition = this.read().get(name);
    return !!definition && Object.keys(definition.fields).length > 0;
  }

  get(name: string): CredentialDefinition | null { return this.read().get(name) ?? null; }

  environment(names: readonly string[]): Record<string, string> {
    const definitions = this.read();
    const env: Record<string, string> = {};
    for (const name of names) {
      const definition = definitions.get(name);
      if (!definition) continue;
      const normalizedName = envName(name);
      for (const [field, value] of Object.entries(definition.fields)) {
        env[`CASCADE_CREDENTIAL_${normalizedName}_${envName(field)}`] = value;
      }
      const secret = secretValue(definition);
      if (secret) env[safeEnvName(definition.env) ?? `CASCADE_CREDENTIAL_${normalizedName}`] = secret;
    }
    return env;
  }

  private read(): Map<string, CredentialDefinition> {
    let source: string;
    try { source = fs.readFileSync(this.file, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map(); throw error; }
    return parseCredentials(source);
  }
}

export function secretValue(definition: CredentialDefinition): string | null {
  const key = definition.field;
  if (key && definition.fields[key]) return definition.fields[key];
  for (const candidate of ['value', 'api_key', 'apiKey', 'access_token', 'token', 'key']) {
    if (definition.fields[candidate]) return definition.fields[candidate];
  }
  return null;
}

function parseCredentials(source: string): Map<string, CredentialDefinition> {
  const json = source.trim().startsWith('{') ? JSON.parse(source) : null;
  const raw = json && typeof json === 'object' ? json as Record<string, unknown> : parseSimpleYaml(source);
  const result = new Map<string, CredentialDefinition>();
  for (const [name, value] of Object.entries(raw)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name) || !value || typeof value !== 'object' || Array.isArray(value)) continue;
    const record = value as Record<string, unknown>;
    const fields = Object.fromEntries(Object.entries(record).filter(([key, item]) => typeof item === 'string' && !['header', 'scheme', 'field', 'env'].includes(key)));
    const hosts = Array.isArray(record.hosts) ? record.hosts.filter((item): item is string => typeof item === 'string').map(normalizeHost).filter(Boolean) : [];
    result.set(name, Object.freeze({ name, fields: Object.freeze(fields as Record<string, string>), hosts: Object.freeze(hosts),
      ...(typeof record.header === 'string' ? { header: record.header } : {}),
      ...(typeof record.scheme === 'string' ? { scheme: record.scheme } : {}),
      ...(typeof record.field === 'string' ? { field: record.field } : {}),
      ...(typeof record.env === 'string' ? { env: record.env } : {}) }));
  }
  return result;
}

function parseSimpleYaml(source: string): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  let current: Record<string, unknown> | null = null;
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '');
    if (!line.trim()) continue;
    const top = line.match(/^([A-Za-z0-9][A-Za-z0-9._-]*):\s*$/);
    if (top) { current = {}; result[top[1]] = current; continue; }
    const field = line.match(/^\s{2,}([A-Za-z0-9_-]+):\s*(.*?)\s*$/);
    if (!current || !field) throw new Error(`Unsupported credentials.yaml syntax near ${JSON.stringify(rawLine)}`);
    const value = unquote(field[2]);
    current[field[1]] = value.startsWith('[') && value.endsWith(']')
      ? value.slice(1, -1).split(',').map((item) => unquote(item.trim())).filter(Boolean)
      : value;
  }
  return result;
}

function unquote(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
  return value;
}

function normalizeHost(value: string): string {
  try { return value.includes('://') ? new URL(value).hostname.toLowerCase() : value.toLowerCase(); } catch { return ''; }
}

function envName(value: string): string { return value.replace(/[^A-Za-z0-9]/g, '_').toUpperCase(); }

function safeEnvName(value: string | undefined): string | null {
  return value && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value) && !/^(?:PATH|NODE_OPTIONS|PYTHONPATH|LD_.*|DYLD_.*)$/i.test(value)
    ? value
    : null;
}
