/**
 * Where Cascade keeps its projects, and how a bare project name resolves.
 *
 * `cascade ./` scoping to the current directory stays the primary way in — this
 * only adds a default home so `cascade new <name>` has somewhere to put things
 * and `cascade <name>` can find a project without a path. Marcus's own call:
 * one folder for all Cascade projects.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const CONFIG_DIR = path.join(os.homedir(), '.cascade');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const DEFAULT_PROJECTS_ROOT = path.join(os.homedir(), 'Documents', 'Cascade');

export interface CascadeConfig {
  projectsRoot: string;
}

export function loadConfig(): CascadeConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    if (typeof raw?.projectsRoot === 'string' && raw.projectsRoot.trim()) {
      // A leading ~ is what anyone hand-editing this file will write.
      const expanded = raw.projectsRoot.replace(/^~(?=\/|$)/, os.homedir());
      return { projectsRoot: path.resolve(expanded) };
    }
  } catch {
    // No config yet, or an unreadable one — the default is the right answer
    // either way, and this must never be a reason the CLI won't start.
  }
  return { projectsRoot: DEFAULT_PROJECTS_ROOT };
}

export function saveConfig(config: CascadeConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

export function configPath(): string {
  return CONFIG_FILE;
}
