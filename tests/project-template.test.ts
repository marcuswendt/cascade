import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createNode, createProject } from '../server/src/projectTemplate.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function projectsRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-project-template-'));
  roots.push(root);
  return root;
}

describe('project templates', () => {
  it('creates the documented deterministic project shape', () => {
    const directory = createProject(projectsRoot(), 'my-artwork');

    expect(fs.readdirSync(directory).sort()).toEqual([
      '.gitignore', 'AGENTS.md', 'assets', 'cascade.json', 'index.cascade', 'nodes', 'package.json', 'tsconfig.json',
    ]);
    expect(JSON.parse(fs.readFileSync(path.join(directory, 'cascade.json'), 'utf8'))).toEqual({ name: 'my-artwork' });
    expect(JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')).devDependencies).toHaveProperty('cascade');
  });

  it('rejects path traversal and invalid project names', () => {
    const root = projectsRoot();
    expect(() => createProject(root, '../outside')).toThrow(/Project names/);
    expect(() => createProject(root, 'Uppercase')).toThrow(/Project names/);
  });

  it('creates a typed deterministic node module', () => {
    const project = createProject(projectsRoot(), 'nodes-test');
    const directory = createNode(project, 'Multiply');
    const source = fs.readFileSync(path.join(directory, 'index.ts'), 'utf8');

    expect(source).toContain('satisfies NodeDefinition');
    expect(source).toContain('NodeExecutionContext<typeof definition>');
    expect(source).not.toContain('node.in(');
    expect(() => createNode(project, '../escape')).toThrow(/Node names/);
  });
});
