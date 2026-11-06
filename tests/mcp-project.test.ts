/**
 * MCP: the project directory chosen per call. A server started in one
 * project (commons) serves a call in another, and every path in that call is
 * contained in the project it names.
 */
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TOOLS, createMcpContext, handle, type McpContext } from '@/cli/mcp';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const temp = () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-mcp-project-')));
  roots.push(root);
  return root;
};

async function call(context: McpContext, name: string, args: Record<string, unknown>) {
  const response = await handle({ method: 'tools/call', params: { name, arguments: args } }, context, 'test') as { result: { structuredContent: any } };
  return response.result.structuredContent;
}

describe('MCP project per call', () => {
  it('offers project on every tool', () => {
    for (const tool of TOOLS) expect((tool.inputSchema.properties as Record<string, unknown>).project, tool.name).toBeDefined();
  });

  it('defaults to the server directory and switches with project', async () => {
    const home = temp();
    const other = temp();
    const context = createMcpContext(home);
    expect((await call(context, 'graph_create', { graph: 'a.cascade' })).ok).toBe(true);
    expect(fs.existsSync(path.join(home, 'a.cascade'))).toBe(true);

    expect((await call(context, 'graph_create', { graph: 'b.cascade', project: other })).ok).toBe(true);
    expect(fs.existsSync(path.join(other, 'b.cascade'))).toBe(true);
    expect(fs.existsSync(path.join(home, 'b.cascade'))).toBe(false);

    const added = await call(context, 'node_add', { graph: 'b.cascade', type: 'Null', id: 'n', project: other });
    expect(added.ok).toBe(true);
    const read = await call(context, 'graph_read', { graph: 'b.cascade', project: other });
    expect(JSON.stringify(read.data)).toContain('"n"');
  });

  it('keeps paths inside the chosen project', async () => {
    const home = temp();
    const other = temp();
    fs.writeFileSync(path.join(home, 'secret.cascade'), JSON.stringify({ version: '0.2', nodes: [], connections: [] }));
    const context = createMcpContext(home);
    const escaped = await call(context, 'graph_read', { graph: path.join(path.relative(other, home), 'secret.cascade'), project: other });
    expect(escaped.ok).toBe(false);
    expect(escaped.error.message).toMatch(/outside the project directory/);
    const absolute = await call(context, 'graph_read', { graph: path.join(home, 'secret.cascade'), project: other });
    expect(absolute.ok).toBe(false);
  });

  it('refuses a project that is not a directory', async () => {
    const context = createMcpContext(temp());
    const missing = await call(context, 'graph_list', { project: '/no/such/cascade/project' });
    expect(missing).toMatchObject({ ok: false, error: { message: expect.stringMatching(/is not a directory/) } });
  });

  it('runs a CLI tool in the chosen project', async () => {
    const home = temp();
    const other = temp();
    const seen: { root: string; args: readonly string[] }[] = [];
    const contextAt = (root: string): McpContext => ({
      ...createMcpContext(root),
      cli: async (args) => { seen.push({ root, args }); return { ok: true, data: {}, warnings: [] }; },
      forProject: (next) => contextAt(next),
    });
    await call(contextAt(home), 'cook', { graph: 'g.cascade', project: other, out: 'stills' });
    expect(seen).toEqual([{ root: other, args: ['run', path.join(other, 'g.cascade'), '--out', path.join(other, 'stills')] }]);
  });
});
