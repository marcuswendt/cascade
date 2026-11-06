/**
 * The verb table (src/cli/verbs.ts) is the one place a `cascade` verb is
 * spelled. These hold the table to the docs and the MCP tools to the table,
 * and pin the dispatch decisions existing callers depend on.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { VERBS, graphCommandsHelp, isGraphCommand, mainHelp, verbFor } from '../src/cli/verbs.js';
import { TOOLS, handle, type McpContext } from '../src/cli/mcp.js';
import { runGraphCommand } from '../src/cli/graphCommands.js';
import type { JsonEnvelope } from '../src/cli/jsonEnvelope.js';

const listed = VERBS.filter((verb) => verb.section !== 'internal');
const mentions = (text: string, verb: string) => new RegExp(`cascade ${verb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\`]`).test(text);

describe('the verb table', () => {
  it('has one row per verb', () => {
    const names = VERBS.flatMap((verb) => [verb.name, ...(verb.aliases ?? [])]);
    expect(new Set(names).size).toBe(names.length);
  });

  it('documents every verb in doc/CLI_REFERENCE.md', async () => {
    const reference = await fs.readFile(path.resolve('doc/CLI_REFERENCE.md'), 'utf8');
    expect(listed.filter((verb) => !mentions(reference, verb.name)).map((verb) => verb.name)).toEqual([]);
  });

  it('lists every verb in --help', () => {
    const help = mainHelp();
    expect(listed.filter((verb) => !mentions(help, verb.name)).map((verb) => verb.name)).toEqual([]);
    expect(VERBS.filter((verb) => verb.section === 'graph').every((verb) => graphCommandsHelp().includes(`cascade ${verb.name}`))).toBe(true);
  });

  it('shows every option a graph verb accepts in its usage', () => {
    for (const verb of VERBS.filter((candidate) => candidate.handler === 'graph')) {
      for (const option of Object.keys(verb.options ?? {})) expect(verb.usage, `${verb.name} --${option}`).toContain(`--${option}`);
    }
  });

  it('routes as the CLI always has', () => {
    expect(verbFor(['node', 'add', 'g.cascade', 'Circle'])?.name).toBe('node add');
    expect(verbFor(['node', 'remove', 'g.cascade', 'x'])?.name).toBe('node rm');
    expect(verbFor(['node', 'Multiply'])?.handler).toBe('studio');
    expect(verbFor(['lock', 'verify'])?.name).toBe('lock verify');
    expect(verbFor(['lock', 'g.cascade', 'n'])?.name).toBe('lock');
    expect(verbFor(['graph'])?.handler).toBe('graph');
    expect(verbFor(['subnet', 'nonsense'])?.handler).toBe('graph');
    expect(verbFor(['.'])).toBeUndefined();
    expect(verbFor(['my-artwork'])).toBeUndefined();
    expect(verbFor([])).toBeUndefined();
    expect(isGraphCommand(['set', 'g.cascade', 'a.b', '1'])).toBe(true);
    expect(isGraphCommand(['node', 'Multiply'])).toBe(false);
    // Verbs that print their own JSON keep --json; the rest are wrapped.
    expect(VERBS.filter((verb) => verb.json === 'keep').map((verb) => verb.name).sort())
      .toEqual(['help node', 'ladder', 'lock', 'lock verify', 'locks', 'parity', 'pick', 'render', 'replay', 'run', 'serve']);
    expect(VERBS.filter((verb) => verb.json === 'studio').map((verb) => verb.name)).toEqual(['new', '__render-worker']);
  });
});

describe('MCP tools from the verb table', () => {
  it('maps every tool to a verb and documents it in doc/MCP.md', async () => {
    const doc = await fs.readFile(path.resolve('doc/MCP.md'), 'utf8');
    for (const tool of TOOLS) {
      expect(VERBS.some((verb) => verb.name === tool.verb), tool.name).toBe(true);
      expect(doc, tool.name).toContain(`\`${tool.name}\``);
    }
  });

  it('serves the twenty tools from before the table, plus ladder, pick and node_help', async () => {
    expect(TOOLS.map((tool) => tool.name).sort()).toEqual([
      'check', 'connect', 'cook', 'disconnect', 'edit', 'export', 'graph_create', 'graph_list', 'graph_read',
      'inspect', 'ladder', 'lock', 'locks', 'node_add', 'node_help', 'node_remove', 'pick', 'render', 'replay', 'set',
      'subnet_create', 'subnet_dissolve', 'subnet_move',
    ]);
  });

  it('runs a lock tool as one child process, with no --help probe first', async () => {
    const calls: (readonly string[])[] = [];
    const context: McpContext = {
      root: '/project',
      resolve: (file) => path.resolve('/project', file),
      cli: async (args): Promise<JsonEnvelope> => {
        calls.push(args);
        return { ok: true, data: { locks: [] }, warnings: [] };
      },
    };
    for (const [name, args] of [['locks', {}], ['replay', { lock: 'abc' }], ['lock', { graph: 'g.cascade', node: 'n', name: 'x' }]] as const) {
      calls.length = 0;
      const response = await handle({ method: 'tools/call', params: { name, arguments: args } }, context, 'test') as { result: { isError: boolean } };
      expect(response.result.isError).toBe(false);
      expect(calls.map((call) => call[0])).toEqual([name]);
    }
  });
});

describe('graph list', () => {
  it('skips renders/ and out/ frame trees', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cascade-list-'));
    try {
      const graph = JSON.stringify({ metadata: { name: 'g' }, nodes: [], connections: [] });
      await fs.mkdir(path.join(directory, 'renders', 'take-1'), { recursive: true });
      await fs.mkdir(path.join(directory, 'out'), { recursive: true });
      await fs.mkdir(path.join(directory, 'sub'), { recursive: true });
      await fs.writeFile(path.join(directory, 'index.cascade'), graph);
      await fs.writeFile(path.join(directory, 'sub', 'other.cascade'), graph);
      await fs.writeFile(path.join(directory, 'renders', 'take-1', 'copy.cascade'), graph);
      await fs.writeFile(path.join(directory, 'out', 'copy.cascade'), graph);
      const listing = await runGraphCommand(['graph', 'list', directory], { json: true }) as { graphs: { file: string }[] };
      expect(listing.graphs.map((entry) => path.relative(directory, path.resolve(entry.file)))).toEqual(['index.cascade', path.join('sub', 'other.cascade')]);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});

describe('the cascade executable', () => {
  const cli = (args: string[]) => {
    try {
      return { status: 0, stdout: execFileSync(process.execPath, ['--import', 'tsx', path.resolve('src/cli/index.ts'), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
    } catch (error) {
      const failed = error as { status: number; stdout: string };
      return { status: failed.status, stdout: failed.stdout };
    }
  };

  it('prints its version and help without a project', () => {
    expect(cli(['--version']).stdout).toMatch(/^Cascade CLI v\d+\.\d+\.\d+/);
    const help = JSON.parse(cli(['--help', '--json']).stdout) as { ok: boolean; data: { output: string[] } };
    expect(help.ok).toBe(true);
    expect(help.data.output.join('\n')).toContain('cascade locks');
  }, 60_000);

  it('refuses --json for a command that opens Studio', () => {
    const result = cli(['some-project', '--json']);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, error: { message: expect.stringContaining('opens Studio') } });
  }, 60_000);
});
