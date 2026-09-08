// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeCascadeClipboard, readCascadeClipboard } from '@/editor/clipboard';

/**
 * The clipboard write, and specifically its return value.
 *
 * `navigator.clipboard` is gated to secure contexts. Studio's sketch servers
 * serve over plain HTTP on a hostname — `kuro:3031` — which is not one, so the
 * modern API is absent exactly where this runs and `execCommand` is the path
 * that matters. It already worked; what it could not do was *say* whether it
 * worked, and a copy button that looks identical on success and failure is one
 * you find out about when you paste.
 */
let execCommand: ReturnType<typeof vi.fn>;

beforeEach(() => {
  execCommand = vi.fn(() => true);
  Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('writeCascadeClipboard', () => {
  it('reports success through the clipboard API when the context is secure', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    await expect(writeCascadeClipboard('hello')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('falls through to execCommand when the API is absent, as on an insecure origin', async () => {
    // No navigator.clipboard at all — the real state of the page this runs in.
    await expect(writeCascadeClipboard('hello')).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('falls through when the API exists but rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    await expect(writeCascadeClipboard('hello')).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('reports failure rather than claiming a copy that did not happen', async () => {
    execCommand.mockReturnValue(false);
    await expect(writeCascadeClipboard('hello')).resolves.toBe(false);
  });

  it('reports failure when execCommand throws', async () => {
    execCommand.mockImplementation(() => {
      throw new Error('not allowed');
    });
    await expect(writeCascadeClipboard('hello')).resolves.toBe(false);
  });

  it('still keeps the session copy, so node paste works without a real clipboard', async () => {
    execCommand.mockReturnValue(false);
    await writeCascadeClipboard('a node');
    // The write failed for the system clipboard and the in-page one still has
    // it — that split is why the return value had to be about the system one.
    await expect(readCascadeClipboard()).resolves.toBe('a node');
  });
});
