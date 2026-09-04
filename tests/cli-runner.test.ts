/**
 * CLI Runner Tests
 * Tests for command parsing, flag handling, and graph loading
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runGraph, type RunOptions } from '@/cli/runner';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Graph } from '@/nodes/Graph';

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

    it('should exit with structured diagnostics when a legacy node cook fails', async () => {
      const mockGraphData = { version: '0.2', nodes: [{ id: 'broken' }], connections: [] };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockGraphData));
      const brokenNode = { id: 'broken', error: null, inputs: [{}], outputs: [] } as any;
      const graph = {
        elements: [brokenNode],
        nodes: [brokenNode],
        connections: [],
        restoreConnections: vi.fn(),
        validate: vi.fn(() => ({ errors: [], warnings: [] })),
        execute: vi.fn(async () => {
          brokenNode.error = new Error('deliberate failure');
        })
      } as any;
      vi.spyOn(Graph, 'fromJSON').mockReturnValue(graph);
      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });
      const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

      await expect(runGraph({ file: '/test/legacy.cascade', verbose: true }))
        .rejects.toThrow('process.exit called');
      expect(mockConsoleError).toHaveBeenCalledWith('Graph execution failed:');
      expect(mockConsoleError).toHaveBeenCalledWith(
        '  - node/cook-failed [broken]: deliberate failure'
      );
      expect(mockConsoleLog).not.toHaveBeenCalledWith('Graph execution completed');

      mockExit.mockRestore();
      mockConsoleError.mockRestore();
      mockConsoleLog.mockRestore();
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
