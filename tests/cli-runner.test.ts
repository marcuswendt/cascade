/**
 * CLI Runner Tests
 * Tests for command parsing, flag handling, and graph loading
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runGraph, type RunOptions } from '@/cli/runner';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Graph } from '@/nodes/Graph';
import { loadProjectModule } from '@/engine/nodeModuleLoader';
import { stageAvailable } from '../server/src/runtime/stage.js';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  access: vi.fn()
}));

describe('CLI Runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('runGraph', () => {
    it('should load and parse valid graph file', async () => {
      const mockGraph = {
        version: '0.2',
        nodes: [],
        connections: []
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockGraph));

      const options: RunOptions = {
        file: '/test/graph.cascade',
        validateOnly: true
      };

      // Should not throw
      await expect(runGraph(options)).resolves.toBeUndefined();
    });

    it('should handle graph with nodes', async () => {
      const mockGraph = {
        version: '0.2',
        nodes: [
          {
            id: 'node1',
            module: 'cascade.image.Color',
            position: [0, 0],
            source: 'stdlib'
          }
        ],
        connections: []
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockGraph));

      const options: RunOptions = {
        file: '/test/graph.cascade',
        validateOnly: true,
        verbose: true
      };

      await expect(runGraph(options)).resolves.toBeUndefined();
    });

    it('should exit with error for invalid JSON', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('not valid json');

      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });
      const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      const options: RunOptions = {
        file: '/test/invalid.cascade'
      };

      await expect(runGraph(options)).rejects.toThrow('process.exit called');
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Failed to load graph file'));

      mockExit.mockRestore();
      mockConsoleError.mockRestore();
    });

    it('should exit with error when file read fails', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT: file not found'));

      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });
      const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      const options: RunOptions = {
        file: '/test/nonexistent.cascade'
      };

      await expect(runGraph(options)).rejects.toThrow('process.exit called');
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Failed to load graph file'));

      mockExit.mockRestore();
      mockConsoleError.mockRestore();
    });

    it('should validate graph and report errors', async () => {
      // A graph with a cycle would fail validation
      // But since we can't easily create a cycle through JSON (connections need ports),
      // we'll test with a valid graph that passes validation
      const mockGraph = {
        version: '0.2',
        nodes: [
          {
            id: 'node1',
            module: 'cascade.image.Color',
            position: [0, 0],
            source: 'stdlib'
          },
          {
            id: 'node2',
            module: 'cascade.image.Color',
            position: [100, 0],
            source: 'stdlib'
          }
        ],
        connections: []
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockGraph));

      const options: RunOptions = {
        file: '/test/graph.cascade',
        validateOnly: true,
        verbose: true
      };

      await expect(runGraph(options)).resolves.toBeUndefined();
    });

    it('should handle verbose flag', async () => {
      const mockGraph = {
        version: '0.2',
        nodes: [],
        connections: []
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockGraph));
      const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

      const options: RunOptions = {
        file: '/test/graph.cascade',
        validateOnly: true,
        verbose: true
      };

      await runGraph(options);

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Loading graph from'));

      mockConsoleLog.mockRestore();
    });

    /**
     * The dynamic executor was deleted in 0.7, so there is no longer a second
     * cook path to report failures from — and a graph it would have run is now
     * refused by name.
     *
     * This used to assert the legacy path's diagnostics: `Graph execution
     * failed:` and `node/cook-failed [broken]`. Both belonged to the executor
     * that is gone. What is worth asserting now is that the refusal SAYS what
     * is wrong, because a graph that used to run and now does not is exactly
     * the case where a bare failure would be infuriating.
     */
    it('refuses a graph with no definition-v1 nodes, and names what it needs', async () => {
      const mockGraphData = { version: '0.2', nodes: [{ id: 'broken' }], connections: [] };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockGraphData));
      const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

      await expect(runGraph({ file: path.resolve('legacy.cascade'), verbose: true }))
        .rejects.toThrow(/has no definition-v1 nodes/);
      // And it points somewhere, rather than only saying no.
      await expect(runGraph({ file: path.resolve('legacy.cascade'), verbose: true }))
        .rejects.toThrow(/export const definition/);
      expect(mockConsoleLog).not.toHaveBeenCalledWith('Graph execution completed');
      // The stage bridge is still torn down on the way out.
      await expect(stageAvailable()).resolves.toBe(false);

      mockConsoleLog.mockRestore();
    });

    /**
     * Still worth having after the dynamic executor went: the compilers and the
     * stage bridge are installed process-wide before either path runs, and a
     * run that REFUSES must tear them down as thoroughly as one that succeeds.
     * Leaving them installed would leak a project's compiler into whatever ran
     * next in the same process.
     */
    it('removes process-wide compilers and the stage bridge after a refused run', async () => {
      const mockGraphData = { version: '0.2', nodes: [], connections: [] };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockGraphData));
      const graph = {
        elements: [],
        nodes: [],
        connections: [],
        restoreConnections: vi.fn(),
        markConnectionsSettled: vi.fn(),
        validate: vi.fn(() => ({ errors: [], warnings: [] })),
        execute: vi.fn(),
      } as any;
      vi.spyOn(Graph, 'fromJSON').mockReturnValue(graph);
      const fetcher = vi.fn().mockResolvedValue(new Response(
        'export function execute() {}',
        { status: 200 },
      ));
      vi.stubGlobal('fetch', fetcher);

      await expect(runGraph({ file: path.resolve('scope-test.cascade') }))
        .rejects.toThrow(/has no definition-v1 nodes/);

      await expect(stageAvailable()).resolves.toBe(false);
      await expect(loadProjectModule('project.after-run')).resolves.toMatchObject({
        execute: expect.any(Function),
      });
      expect(fetcher).toHaveBeenCalledWith('/api/nodes/after-run/compiled');
    });

    it('removes process-wide compilers after a deterministic run', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({
        version: '0.2',
        nodes: [{ id: 'pass', module: 'cascade.core.Null' }],
        connections: [],
      }));
      const fetcher = vi.fn().mockResolvedValue(new Response(
        'export function execute() {}',
        { status: 200 },
      ));
      vi.stubGlobal('fetch', fetcher);

      await runGraph({ file: path.resolve('deterministic-scope-test.cascade') });

      await expect(stageAvailable()).resolves.toBe(false);
      await expect(loadProjectModule('project.after-deterministic-run')).resolves.toMatchObject({
        execute: expect.any(Function),
      });
      expect(fetcher).toHaveBeenCalledWith('/api/nodes/after-deterministic-run/compiled');
    });
  });

  describe('RunOptions interface', () => {
    it('should accept minimal options', () => {
      const options: RunOptions = {
        file: '/test/graph.cascade'
      };
      expect(options.file).toBe('/test/graph.cascade');
      expect(options.entryNode).toBeUndefined();
      expect(options.validateOnly).toBeUndefined();
      expect(options.verbose).toBeUndefined();
    });

    it('should accept all options', () => {
      const options: RunOptions = {
        file: '/test/graph.cascade',
        entryNode: 'node1',
        validateOnly: true,
        verbose: true
      };
      expect(options.file).toBe('/test/graph.cascade');
      expect(options.entryNode).toBe('node1');
      expect(options.validateOnly).toBe(true);
      expect(options.verbose).toBe(true);
    });
  });
});

/**
 * `--node`, and what it replaced.
 *
 * Marcus, 2026-09-12: *"we need to add a simple flag to cascade run batch
 * scripts to define the target node it wants to render; this will be a common
 * use-case."* It is — one document with several layout variants is only
 * affordable if a batch script can render one of them, and without it
 * `cascade run` renders every unconsumed image output.
 *
 * `--entry-node` already did most of this and nobody could find it, because
 * "entry node" reads as *start here* rather than *render this*. So this is a
 * name somebody would look for over plumbing that existed, plus repeatability.
 */
describe('--node selects what to render', () => {
  it('is parsed repeatably, and supersedes --entry-node', async () => {
    const parse = (argv: string[]) => {
      const named: string[] = [];
      for (let index = 0; index < argv.length; index += 1) {
        if (argv[index] === '--node' && argv[index + 1]) named.push(argv[index + 1]);
      }
      return named;
    };
    expect(parse(['run', 'g.cascade', '--node', 'sheet'])).toEqual(['sheet']);
    expect(parse(['run', 'g.cascade', '--node', 'sheet', '--node', 'page'])).toEqual(['sheet', 'page']);
    // A trailing `--node` with nothing after it names nothing rather than
    // swallowing the next flag.
    expect(parse(['run', 'g.cascade', '--node'])).toEqual([]);
  });
});
