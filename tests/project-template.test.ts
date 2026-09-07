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
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
    // `expect.any(String)` was too loose to be a test: the bare name `cascade`
    // on npm belongs to an unrelated package, so a scaffolded project asking
    // for it by name would install a stranger's code. The dependency has to be
    // an alias onto the published scope, keeping `cascade/...` imports intact.
    expect(manifest.devDependencies).toMatchObject({ cascade: 'npm:@field/cascade@^0.2.0', typescript: '^6.0.0' });
    expect(manifest.devDependencies.cascade).toMatch(/^npm:@field\/cascade@/);
    expect(JSON.parse(fs.readFileSync(path.join(directory, 'tsconfig.json'), 'utf8')).compilerOptions).toMatchObject({
      module: 'ESNext',
      moduleResolution: 'Bundler',
    });
    const agentGuide = fs.readFileSync(path.join(directory, 'AGENTS.md'), 'utf8');
    expect(agentGuide).toContain('--host KURO --port 3030');
    expect(agentGuide).toContain('Do not start another Cascade process on an occupied port');
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
