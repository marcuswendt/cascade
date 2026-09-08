import { describe, expect, it, vi } from 'vitest';

import { asError, describeThrown } from '@/utils/thrownError';
import { Graph } from '@/nodes/Graph';

/**
 * `Error executing node volume: {}` — what Marcus saw when a WebGPU node
 * failed, and the empty object was the whole fault.
 *
 * `GPUPipelineError`, `GPUValidationError` and `DOMException` carry `message`
 * on the prototype and have **no enumerable own properties**, so anything that
 * serialises them produces `{}`. A WebGPU failure was invisible by
 * construction. Reported by MW-OBSERVATORY-ART as its own item rather than
 * waiting for the underlying cause, which was the right call: every GPU node
 * from here on depends on being able to read its own failures.
 */
describe('describing what was thrown', () => {
  it('reads a message that lives on the prototype', () => {
    // The exact shape of the WebGPU errors: a getter, nothing enumerable.
    class GPUPipelineError {
      get message() { return 'entry point main not found'; }
      get reason() { return 'validation'; }
    }
    const thrown = new GPUPipelineError();
    expect(JSON.stringify(thrown)).toBe('{}');

    expect(describeThrown(thrown)).toBe('GPUPipelineError: entry point main not found, reason: validation');
  });

  it('prefers a name property, which is where a DOMException puts its kind', () => {
    const thrown = { name: 'AbortError', message: 'The operation was aborted' };
    expect(describeThrown(thrown)).toBe('AbortError: The operation was aborted');
  });

  it('says something about a value with no message at all', () => {
    expect(describeThrown({ code: 7 })).toBe('Object: {"code":7}');
    expect(describeThrown({})).toBe('Object was thrown with no message');
    expect(describeThrown(null)).toBe('null was thrown');
    expect(describeThrown(undefined)).toBe('undefined was thrown');
    expect(describeThrown('plain string')).toBe('plain string');
    expect(describeThrown(42)).toBe('42 was thrown');
  });

  it('survives a value that cannot be serialised', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(describeThrown(circular)).toBe('Object was thrown with no message');
  });

  it('passes a real Error through untouched, and keeps the original as cause', () => {
    const real = new Error('already fine');
    expect(asError(real)).toBe(real);

    const thrown = { name: 'GPUValidationError', message: 'bind group mismatch' };
    const wrapped = asError(thrown);
    expect(wrapped).toBeInstanceOf(Error);
    expect(wrapped.message).toBe('GPUValidationError: bind group mismatch');
    expect((wrapped as Error & { cause?: unknown }).cause).toBe(thrown);
  });
});

describe('a node that throws a non-Error', () => {
  it('records a readable message rather than an empty object', async () => {
    // The end-to-end half: the node's own `error` field was assigned the raw
    // thrown value while typed `Error`, so every reader of `.message` got
    // `undefined` and the gap propagated past the log line.
    const graph = new Graph();
    const node = graph.addNode('cascade.core.Freeze', { x: 0, y: 0 });
    node.setFunction(() => {
      throw { name: 'GPUPipelineError', message: 'shader module invalid', reason: 'validation' };
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    await graph.execute(node);

    expect(node.error).toBeInstanceOf(Error);
    expect(node.error?.message).toBe('GPUPipelineError: shader module invalid, reason: validation');
    // And the log line carries the text, not just an object a forwarder can flatten.
    expect(errors.mock.calls.map((call) => String(call[0])).join('\n')).toContain('shader module invalid');
    errors.mockRestore();
  });
});
